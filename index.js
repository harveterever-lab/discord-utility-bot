const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  REST,
  Routes,
} = require("discord.js");
require("dotenv").config();

const { commandDefinitions } = require("./commands");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

// --- AFK store (in-memory only; resets on restart) -------------------------
// Map<userId, { reason: string, timestamp: number }>
const afkUsers = new Map();

// --- Sticky message store (in-memory only; resets on restart) --------------
// Map<channelId, { messageId: string, content: string }>
const stickyMessages = new Map();

// --- Staff role store (in-memory only; resets on restart) -------------------
// Map<guildId, roleId>
const staffRoles = new Map();

// --- Quarantined role store (in-memory only; resets on restart) --------------
// Map<guildId, roleId>
const quarantinedRoles = new Map();

// --- Quarantine store (in-memory only; resets on restart) ------------------
// Map<guildId, Map<userId, string[]>>  (guild -> user -> saved role IDs)
const quarantineStore = new Map();

const ADMIN_PERMISSION = PermissionFlagsBits.Administrator;

const startTime = Date.now();

// --- Bot client ------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  // Auto-register slash commands so they appear in Discord without a manual
  // deploy step. Uses the bot application's own ID (the logged-in user).
  const clientId = readyClient.user.id;
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    console.log("Registering application (/) commands…");
    const data = await rest.put(Routes.applicationCommands(clientId), {
      body: commandDefinitions,
    });
    console.log(`Successfully registered ${data.length} application (/) commands.`);
  } catch (error) {
    console.error("Failed to register application commands:", error);
  }
});

// --- Slash command handler -------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  switch (commandName) {
    case "afk": {
      await handleAfk(interaction);
      break;
    }
    case "say": {
      await requireAdmin(interaction, () => handleSay(interaction));
      break;
    }
    case "embed": {
      await requireAdmin(interaction, () => handleEmbed(interaction));
      break;
    }
    case "react": {
      await requireAdmin(interaction, () => handleReact(interaction));
      break;
    }
    case "avatar": {
      await handleAvatar(interaction);
      break;
    }
    case "banner": {
      await handleBanner(interaction);
      break;
    }
    case "userinfo": {
      await handleUserInfo(interaction);
      break;
    }
    case "membercount": {
      await handleMemberCount(interaction);
      break;
    }
    case "slowmode": {
      await requireAdmin(interaction, () => handleSlowmode(interaction));
      break;
    }
    case "sticky": {
      await requireAdmin(interaction, () => handleSticky(interaction));
      break;
    }
    case "unsticky": {
      await requireAdmin(interaction, () => handleUnsticky(interaction));
      break;
    }
    case "role": {
      await requireAdmin(interaction, () => handleRole(interaction));
      break;
    }
    case "staff": {
      await requireAdmin(interaction, () => handleStaff(interaction));
      break;
    }
    case "quarantine": {
      await requireStaff(interaction, () => handleQuarantine(interaction));
      break;
    }
    case "unquarantine": {
      await requireStaff(interaction, () => handleUnquarantine(interaction));
      break;
    }
    case "purgeuser": {
      await requirePermission(
        interaction,
        PermissionFlagsBits.ManageMessages,
        "Manage Messages",
        () => handlePurgeUserSlash(interaction)
      );
      break;
    }
    case "info": {
      await handleInfo(interaction);
      break;
    }
    case "arcane-seal": {
      await requireAdmin(interaction, () => handleArcaneSeal(interaction));
      break;
    }
    default:
      break;
  }
});

// --- Message listener: AFK mention + self-message removal ------------------
client.on(Events.MessageCreate, async (message) => {
  // Ignore bots (including ourselves) and DMs.
  if (message.author.bot || !message.guild) return;

  // 1) If this author is AFK and sends a message, remove their AFK status.
  if (afkUsers.has(message.author.id)) {
    afkUsers.delete(message.author.id);
    try {
      const reply = await message.reply(
        "Welcome back! Your AFK status has been removed."
      );
      // Auto-delete the heads-up after a few seconds to keep chat clean.
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    } catch {
      /* ignore */
    }
  }

  // 2) If the message mentions any AFK user, show their reason.
  // message.mentions.users covers @mentions and <@id>/<@!id> patterns.
  if (message.mentions.users.size === 0) return;

  for (const [mentionedId] of message.mentions.users) {
    const afk = afkUsers.get(mentionedId);
    if (!afk) continue;

    const member = await message.guild.members
      .fetch(mentionedId)
      .catch(() => null);
    const name = member ? member.displayName : "That user";

    const ago = formatDuration(Date.now() - afk.timestamp);
    const reasonText = afk.reason ? afk.reason : "No reason provided.";

    const embed = new EmbedBuilder()
      .setColor("#006400")
      .setDescription(
        `${name} is currently AFK: **${reasonText}** (AFK for ${ago})`
      );

    try {
      await message.reply({ embeds: [embed] });
    } catch {
      /* ignore */
    }
  }
});

// --- Sticky message reposting -----------------------------------------------
// We use a separate listener so the logic stays self-contained. When a new
// message arrives in a channel that has a sticky, we delete the old sticky
// message and repost it at the bottom.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const sticky = stickyMessages.get(message.channelId);
  if (!sticky) return;

  // Delete the previous sticky message, then repost at the bottom.
  try {
    const oldMessage = await message.channel.messages
      .fetch(sticky.messageId)
      .catch(() => null);
    if (oldMessage) await oldMessage.delete().catch(() => {});
  } catch {
    /* old message may already be gone */
  }

  const stickyText = `📌 __Stickied Message__\n${sticky.content}`;

  try {
    const sent = await message.channel.send(stickyText);
    sticky.messageId = sent.id;
  } catch {
    /* ignore */
  }
});

// --- Prefix command handler (!u) -------------------------------------------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content;

  // Only respond to the "!u" prefix.
  if (!content.startsWith("!u ")) return;

  const args = content.slice(3).trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) return;

  switch (subcommand) {
    case "emoji":
      await prefixEmoji(message, args);
      break;
    default:
      break;
  }
});

// --- Command implementations ----------------------------------------------

async function handleAfk(interaction) {
  const reason = interaction.options.getString("reason") || "No reason provided.";
  const userId = interaction.user.id;

  afkUsers.set(userId, {
    reason,
    timestamp: Date.now(),
  });

  await interaction.reply({
    content: `You are now AFK: **${reason}**\nI'll let people know when they mention you, and remove your AFK status when you send a message.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSay(interaction) {
  const content = interaction.options.getString("message");

  await interaction.channel.send(content);
  await interaction.reply({
    content: "Message sent.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEmbed(interaction) {
  const description = interaction.options.getString("description");
  const embedColorRaw = interaction.options.getString("embed_color");
  const image = interaction.options.getString("image");
  const footer = interaction.options.getString("footer");

  let color = "#006400"; // dark green default
  if (embedColorRaw) {
    const parsed = parseHexColor(embedColorRaw);
    if (parsed === null) {
      await interaction.reply({
        content:
          "Invalid HEX color. Use a 6-digit hex code, e.g. `#006400` or `006400`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    color = parsed;
  }

  const embed = new EmbedBuilder().setDescription(description).setColor(color);

  if (image) {
    if (!isValidHttpUrl(image)) {
      await interaction.reply({
        content: "The image option must be a valid http(s) URL.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    embed.setImage(image);
  }

  if (footer) {
    embed.setFooter({ text: footer });
  }

  await interaction.channel.send({ embeds: [embed] });
  await interaction.reply({
    content: "Embed sent.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReact(interaction) {
  const messageId = interaction.options.getString("message_id");
  const emojisInput = interaction.options.getString("emojis");

  // Parse emoji tokens separated by spaces.
  const tokens = emojisInput.trim().split(/\s+/).filter(Boolean);

  // Fetch the target message.
  let targetMessage;
  try {
    targetMessage = await interaction.channel.messages.fetch(messageId);
  } catch {
    await interaction.reply({
      content:
        "Could not find that message in this channel. Make sure the message ID is correct and the message is in the current channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (tokens.length === 0) {
    await interaction.reply({
      content: "Please provide at least one emoji.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const added = [];
  const failed = [];

  for (const token of tokens) {
    // Discord custom emoji format: <:name:id> or <a:name:id>
    const customMatch = token.match(/^<(a)?:([a-zA-Z0-9_]+):(\d+)>$/);
    try {
      if (customMatch) {
        // react() accepts the full custom emoji string <a:name:id> or <name:id>.
        await targetMessage.react(token);
        added.push(token);
      } else {
        // Treat as a Unicode emoji.
        await targetMessage.react(token);
        added.push(token);
      }
    } catch {
      failed.push(token);
    }
  }

  let summary = `Added ${added.length} reaction(s).`;
  if (failed.length > 0) {
    summary += `\nFailed to add: ${failed.join(" ")}`;
  }

  await interaction.reply({
    content: summary,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAvatar(interaction) {
  // Defaults to the user who ran the command if no user is provided.
  const user = interaction.options.getUser("user") ?? interaction.user;

  // user.displayAvatarURL returns the highest-quality avatar available for
  // the user (guild avatar if set, otherwise global). size=4096 is the max.
  const avatarUrl = user.displayAvatarURL({ size: 4096, extension: "png" });
  const displayName = await resolveDisplayName(interaction, user);

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle(`${displayName}'s Avatar`)
    .setImage(avatarUrl)
    .setFooter({ text: `Requested by ${interaction.user.tag}` });

  const downloadButton = new ButtonBuilder()
    .setLabel("Download Avatar")
    .setStyle(ButtonStyle.Link)
    .setURL(avatarUrl);

  const row = new ActionRowBuilder().addComponents(downloadButton);

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleBanner(interaction) {
  // Defaults to the user who ran the command if no user is provided.
  const user = interaction.options.getUser("user") ?? interaction.user;

  // Banners are only exposed on the full User profile, not on the member or
  // the partial User from options. fetch() forces a fresh REST fetch.
  let fullUser;
  try {
    fullUser = await client.users.fetch(user.id, { force: true });
  } catch {
    await interaction.reply({
      content: "Could not fetch that user's profile. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const bannerUrl = fullUser.bannerURL({ size: 4096, extension: "png" });
  const displayName = await resolveDisplayName(interaction, user);

  if (!bannerUrl) {
    await interaction.reply({
      content: `**${displayName}** does not have a banner set.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle(`${displayName}'s Banner`)
    .setImage(bannerUrl)
    .setFooter({ text: `Requested by ${interaction.user.tag}` });

  const downloadButton = new ButtonBuilder()
    .setLabel("Download Banner")
    .setStyle(ButtonStyle.Link)
    .setURL(bannerUrl);

  const row = new ActionRowBuilder().addComponents(downloadButton);

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleUserInfo(interaction) {
  const user = interaction.options.getUser("user") ?? interaction.user;

  // Fetch the guild member for server-specific info (join date, roles).
  let member = null;
  if (interaction.guild) {
    member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);
  }

  const createdTimestamp = Math.floor(user.createdTimestamp / 1000);
  const avatarUrl = user.displayAvatarURL({ size: 4096, extension: "png" });

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle(`${user.tag}`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "User ID", value: `\`${user.id}\``, inline: true },
      { name: "Username", value: user.username, inline: true },
      {
        name: "Account Created",
        value: `<t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`,
        inline: false,
      }
    )
    .setFooter({ text: `Requested by ${interaction.user.tag}` });

  if (member) {
    const joinedTimestamp = Math.floor(member.joinedTimestamp / 1000);
    // Exclude @everyone and list up to 30 roles to avoid hitting field limits.
    const roles = member.roles.cache
      .filter((r) => r.id !== interaction.guild.id)
      .map((r) => `<@&${r.id}>`)
      .join(", ");
    embed.addFields(
      {
        name: "Server Join Date",
        value: `<t:${joinedTimestamp}:F> (<t:${joinedTimestamp}:R>)`,
        inline: false,
      },
      {
        name: `Roles [${member.roles.cache.size - 1}]`,
        value: roles || "None",
        inline: false,
      }
    );
  } else {
    embed.addFields({
      name: "Server Join Date",
      value: "Not a member of this server.",
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleMemberCount(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Force-fetch to get the most accurate count.
  const guild = await interaction.guild.fetch();
  const total = guild.memberCount;

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle("Server Member Count")
    .setDescription(`**${guild.name}** currently has **${total}** members.`)
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleSlowmode(interaction) {
  const seconds = interaction.options.getInteger("seconds");

  // Discord's API limit is 21600 seconds (6 hours). The command option also
  // enforces this via setMinValue/setMaxValue, but we validate again here.
  if (seconds < 0 || seconds > 21600) {
    await interaction.reply({
      content: "Seconds must be between 0 and 21600 (6 hours).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.channel.setRateLimitPerUser(seconds);
  } catch {
    await interaction.reply({
      content:
        "I couldn't change the slowmode for this channel. Make sure I have the Manage Channels permission.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setDescription(
      seconds === 0
        ? "Slowmode has been **disabled** for this channel."
        : `Slowmode set to **${seconds} second${seconds === 1 ? "" : "s"}** for this channel.`
    )
    .setFooter({ text: `Changed by ${interaction.user.tag}` });

  await interaction.reply({ embeds: [embed] });
}

async function handleSticky(interaction) {
  const content = interaction.options.getString("message");
  const channelId = interaction.channelId;

  // If there's already a sticky in this channel, delete the old message first.
  const existing = stickyMessages.get(channelId);
  if (existing) {
    try {
      const oldMessage = await interaction.channel.messages
        .fetch(existing.messageId)
        .catch(() => null);
      if (oldMessage) await oldMessage.delete().catch(() => {});
    } catch {
      /* old message may already be gone */
    }
  }

  const stickyText = `📌 __Stickied Message__\n${content}`;

  const sent = await interaction.channel.send(stickyText);

  stickyMessages.set(channelId, {
    messageId: sent.id,
    content,
  });

  await interaction.reply({
    content: "Sticky message has been set for this channel.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUnsticky(interaction) {
  const channelId = interaction.channelId;
  const sticky = stickyMessages.get(channelId);

  if (!sticky) {
    await interaction.reply({
      content: "There is no sticky message in this channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const oldMessage = await interaction.channel.messages
      .fetch(sticky.messageId)
      .catch(() => null);
    if (oldMessage) await oldMessage.delete().catch(() => {});
  } catch {
    /* old message may already be gone */
  }

  stickyMessages.delete(channelId);

  await interaction.reply({
    content: "Sticky message has been removed from this channel.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRole(interaction) {
  const targetUser = interaction.options.getUser("user");
  const role = interaction.options.getRole("role");

  // Fetch the full member objects for hierarchy checks.
  const targetMember = await interaction.guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "Could not find that user in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = await interaction.guild.members.fetchMe();

  // Check bot role hierarchy: the bot's highest role must be above the target role.
  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: `I can't manage **${role.name}** because it is at or above my highest role. Move my role above it in the server settings.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check target hierarchy: the bot must be above the target member too.
  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: `I can't modify roles for **${targetUser.tag}** because their highest role is at or above mine.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const hasRole = targetMember.roles.cache.has(role.id);

  try {
    if (hasRole) {
      await targetMember.roles.remove(role);
    } else {
      await targetMember.roles.add(role);
    }
  } catch {
    await interaction.reply({
      content: "I couldn't update that user's roles. Make sure I have the Manage Roles permission and my role is high enough.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setDescription(
      hasRole
        ? `Removed **${role.name}** from ${targetUser}.`
        : `Added **${role.name}** to ${targetUser}.`
    )
    .setFooter({ text: `Changed by ${interaction.user.tag}` });

  await interaction.reply({ embeds: [embed] });
}

// --- Staff / Quarantine ----------------------------------------------------

async function handleStaff(interaction) {
  const role = interaction.options.getRole("role");
  const quarantinedRole = interaction.options.getRole("quarantined_role");
  const guildId = interaction.guildId;

  staffRoles.set(guildId, role.id);
  quarantinedRoles.set(guildId, quarantinedRole.id);

  await interaction.reply({
    content: `The staff role has been set to **${role.name}** and the quarantined role has been set to **${quarantinedRole.name}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleQuarantine(interaction) {
  const targetUser = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason");
  const guild = interaction.guild;

  const targetMember = await guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "Could not find that user in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const quarantinedRoleId = quarantinedRoles.get(guild.id);
  if (!quarantinedRoleId) {
    await interaction.reply({
      content:
        "No quarantined role has been set for this server. An administrator can set one with /staff.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const quarantineRole = guild.roles.cache.get(quarantinedRoleId);
  if (!quarantineRole) {
    await interaction.reply({
      content:
        "The configured quarantined role no longer exists. An administrator can set a new one with /staff.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = await guild.members.fetchMe();

  if (quarantineRole.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content:
        "The quarantined role is at or above my highest role. Move my role above it in the server settings.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Save the user's manageable roles, then remove them.
  const savedRoleIds = [];
  const rolesToRemove = [];

  for (const [, role] of targetMember.roles.cache) {
    if (role.id === guild.id) continue; // skip @everyone
    if (role.position >= botMember.roles.highest.position) continue; // skip unmanageable
    savedRoleIds.push(role.id);
    rolesToRemove.push(role);
  }

  if (rolesToRemove.length > 0) {
    try {
      await targetMember.roles.remove(rolesToRemove);
    } catch {
      /* proceed even if some removals fail */
    }
  }

  try {
    await targetMember.roles.add(quarantineRole);
  } catch {
    await interaction.reply({
      content:
        "I couldn't assign the quarantined role. Make sure I have the Manage Roles permission and my role is high enough.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Persist saved roles in memory.
  if (!quarantineStore.has(guild.id)) {
    quarantineStore.set(guild.id, new Map());
  }
  quarantineStore.get(guild.id).set(targetUser.id, savedRoleIds);

  // DM the quarantined user. If it fails, continue normally.
  try {
    await targetUser.send(
      `You have been quarantined in **${guild.name}** for: **${reason}**`
    );
  } catch {
    /* DM may fail if user has DMs closed — continue normally */
  }

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle("🔒 Quarantine Log")
    .addFields(
      { name: "User", value: `${targetUser} (\`${targetUser.id}\`)`, inline: false },
      { name: "Moderator", value: `${interaction.user}`, inline: false },
      { name: "Reason", value: reason, inline: false }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleUnquarantine(interaction) {
  const targetUser = interaction.options.getUser("user");
  const guild = interaction.guild;

  const targetMember = await guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  if (!targetMember) {
    await interaction.reply({
      content: "Could not find that user in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const quarantinedRoleId = quarantinedRoles.get(guild.id);
  if (!quarantinedRoleId) {
    await interaction.reply({
      content:
        "No quarantined role has been set for this server. An administrator can set one with /staff.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const quarantineRole = guild.roles.cache.get(quarantinedRoleId);

  if (!quarantineRole || !targetMember.roles.cache.has(quarantineRole.id)) {
    await interaction.reply({
      content: "That user is not currently quarantined.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = await guild.members.fetchMe();

  if (quarantineRole.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content:
        "The quarantined role is at or above my highest role. Move my role above it in the server settings.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove the quarantined role.
  try {
    await targetMember.roles.remove(quarantineRole);
  } catch {
    await interaction.reply({
      content:
        "I couldn't remove the quarantined role. Make sure I have the Manage Roles permission and my role is high enough.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Restore saved roles from memory, if available.
  const guildQuarantine = quarantineStore.get(guild.id);
  const savedRoleIds = guildQuarantine ? guildQuarantine.get(targetUser.id) : null;

  if (savedRoleIds && savedRoleIds.length > 0) {
    const rolesToAdd = [];
    for (const roleId of savedRoleIds) {
      const role = guild.roles.cache.get(roleId);
      if (role && role.position < botMember.roles.highest.position) {
        rolesToAdd.push(role);
      }
    }
    if (rolesToAdd.length > 0) {
      try {
        await targetMember.roles.add(rolesToAdd);
      } catch {
        /* proceed even if some additions fail */
      }
    }
    if (guildQuarantine) guildQuarantine.delete(targetUser.id);
  }

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle("🔓 Unquarantine Log")
    .addFields(
      { name: "User", value: `${targetUser} (\`${targetUser.id}\`)`, inline: false },
      { name: "Moderator", value: `${interaction.user}`, inline: false }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// --- Purge User (shared logic) ---------------------------------------------

async function purgeUserMessages(channel, userId, amount, requesterTag) {
  // Fetch up to 100 recent messages in the channel.
  const messages = await channel.messages.fetch({ limit: 100 });

  // Filter to only messages from the target user, up to the requested amount.
  const toDelete = messages
    .filter((m) => m.author.id === userId)
    .first(amount);

  if (toDelete.length === 0) {
    return { deleted: 0, none: true };
  }

  // Use bulkDelete for 2-100 messages, individual delete for 1.
  if (toDelete.length === 1) {
    try {
      await toDelete[0].delete();
    } catch {
      /* ignore */
    }
  } else {
    try {
      await channel.bulkDelete(toDelete, true);
    } catch {
      /* fall back to individual deletes if bulk fails */
      for (const msg of toDelete) {
        try {
          await msg.delete();
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { deleted: toDelete.length, none: false };
}

async function handlePurgeUserSlash(interaction) {
  const targetUser = interaction.options.getUser("user");
  const amount = interaction.options.getInteger("amount");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await purgeUserMessages(
    interaction.channel,
    targetUser.id,
    amount,
    interaction.user.tag
  );

  if (result.none) {
    await interaction.editReply({
      content: `No recent messages from **${targetUser.tag}** were found in this channel.`,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setDescription(
      `🧹 Purged **${result.deleted}** message${result.deleted === 1 ? "" : "s"} from **${targetUser.tag}** in ${interaction.channel}.`
    )
    .setFooter({ text: `Purged by ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// --- Prefix command implementations (!u) ----------------------------------

async function prefixEmoji(message, args) {
  // !u emoji [image attachment] [name]
  if (
    !message.memberPermissions ||
    !message.memberPermissions.has(PermissionFlagsBits.ManageGuildExpressions)
  ) {
    await message.reply("You need the **Manage Expressions** permission to use this command.");
    return;
  }

  const name = args[1];

  if (!name) {
    await message.reply("Usage: `!u emoji <name>` (attach an image to your message)");
    return;
  }

  // Discord emoji names: 2-32 chars, alphanumeric + underscores, must start with a letter or number.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_]{1,31}$/.test(name)) {
    await message.reply(
      "Invalid emoji name. Use **2-32** characters: letters, numbers, and underscores. Must start with a letter or number."
    );
    return;
  }

  // Check for an attached image.
  const attachment = message.attachments.first();
  if (!attachment) {
    await message.reply("Please attach an image to your message to use as the emoji.");
    return;
  }

  // Validate it's an image.
  const validTypes = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ];
  if (!validTypes.includes(attachment.contentType)) {
    await message.reply(
      "The attached file must be an image (PNG, JPEG, GIF, or WebP)."
    );
    return;
  }

  // Discord emoji image must be under 256 KB.
  if (attachment.size > 256 * 1024) {
    await message.reply(
      "The image is too large. Discord emoji images must be under **256 KB**."
    );
    return;
  }

  try {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      await message.reply("Could not download the attached image. Please try again.");
      return;
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUri = `data:${attachment.contentType};base64,${base64}`;

    const createdEmoji = await message.guild.emojis.create({
      name,
      attachment: dataUri,
    });

    const embed = new EmbedBuilder()
      .setColor("#006400")
      .setTitle("✅ Emoji Added")
      .setDescription(`Emoji **\`${createdEmoji.name}\`** has been added to this server.`)
      .setThumbnail(createdEmoji.imageURL())
      .setFooter({ text: `Added by ${message.author.tag}` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (error) {
    // Handle Discord API errors with specific messages.
    const errCode = error?.code;
    let errMsg = "Could not create the emoji. Please try again.";

    if (errCode === 50035 || errCode === 30018) {
      errMsg = "The server has reached its emoji limit, or the image is invalid.";
    } else if (errCode === 50013) {
      errMsg = "I don't have permission to manage emojis. Make sure I have the Manage Expressions permission.";
    } else if (errCode === 50138) {
      errMsg = "The emoji name is invalid or already in use.";
    }

    await message.reply(errMsg);
  }
}

async function handleInfo(interaction) {
  const ping = Math.round(interaction.client.ws.ping);
  const uptime = formatDuration(Date.now() - startTime);
  const botAvatar = interaction.client.user.displayAvatarURL({ size: 4096, extension: "png" });

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle("Lumi — Bot Info")
    .setThumbnail(botAvatar)
    .addFields(
      { name: "Name", value: "Lumi", inline: true },
      { name: "Ping", value: `${ping}ms`, inline: true },
      { name: "Invite", value: "[Link](https://discord.com/oauth2/authorize?client_id=1543079364604985364&permissions=8&scope=bot%20applications.commands)", inline: true },
      { name: "Restarted", value: uptime, inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleArcaneSeal(interaction) {
  const targetChannel = interaction.options.getChannel("channel");

  await interaction.reply({
    content: `🔮 Casting arcane seal on ${targetChannel}...`,
    flags: MessageFlags.Ephemeral,
  });

  const sent = await targetChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor("#006400")
        .setTitle("\uD83D\uDD2E LUMI'S WITCHCRAFT")
        .setDescription("The air grows unnaturally still...\n\uD83D\uDD6A\uFE0F Lumi begins weaving an ancient spell.\n\u23F3 3..."),
    ],
  });

  await sleep(1000);
  await sent.edit({
    embeds: [
      new EmbedBuilder()
        .setColor("#006400")
        .setTitle("\uD83D\uDD2E LUMI'S WITCHCRAFT")
        .setDescription("The shadows begin to twist around the room...\n\u2728 The spell is taking shape.\n\u23F3 2..."),
    ],
  });

  await sleep(1000);
  await sent.edit({
    embeds: [
      new EmbedBuilder()
        .setColor("#006400")
        .setTitle("\uD83D\uDD2E LUMI'S WITCHCRAFT")
        .setDescription("A surge of arcane energy fills the air...\n\uD83C\uDF19 The final incantation is spoken.\n\u23F3 1..."),
    ],
  });

  await sleep(1000);

  const everyoneRole = interaction.guild.roles.everyone;
  const previousPerms = targetChannel.permissionOverwrites.cache.get(everyoneRole.id);
  const hadSendPerm = previousPerms
    ? previousPerms.allow.has(PermissionFlagsBits.SendMessages)
    : false;
  const previousDenySend = previousPerms
    ? previousPerms.deny.has(PermissionFlagsBits.SendMessages)
    : false;

  try {
    await targetChannel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: false,
    });
  } catch {
    await sent.edit({
      embeds: [
        new EmbedBuilder()
          .setColor("#006400")
          .setTitle("\uD83D\uDD2E ARCANE SEAL")
          .setDescription("The ritual failed — Lumi lacks permission to manage this channel."),
      ],
    });
    return;
  }

  await sent.edit({
    embeds: [
      new EmbedBuilder()
        .setColor("#006400")
        .setTitle("\uD83D\uDD2E ARCANE SEAL")
        .setDescription("The ritual is complete.\n\uD83D\uDD12 Lumi has sealed this channel.\nNo messages shall pass through the seal for 5 seconds.\n\u2728 The seal will soon fade..."),
    ],
  });

  await sleep(5000);

  try {
    if (previousPerms) {
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: hadSendPerm ? true : (previousDenySend ? false : null),
      });
    } else {
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: null,
      });
    }
  } catch {
    /* best-effort restore */
  }
}

// --- Helpers ---------------------------------------------------------------

async function requireAdmin(interaction, fn) {
  // Double-check server-side even though the command has default member
  // permissions. Covers cases where an admin manually granted the command
  // to non-admin roles, or the interaction is a DM.
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(ADMIN_PERMISSION)) {
    await interaction.reply({
      content: "You need the Administrator permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await fn();
}

async function requirePermission(interaction, permissionFlag, permissionName, fn) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(permissionFlag)) {
    await interaction.reply({
      content: `You need the **${permissionName}** permission to use this command.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await fn();
}

async function requireStaff(interaction, fn) {
  // Administrators can always use staff commands.
  if (interaction.memberPermissions && interaction.memberPermissions.has(ADMIN_PERMISSION)) {
    await fn();
    return;
  }

  const staffRoleId = staffRoles.get(interaction.guildId);
  if (!staffRoleId) {
    await interaction.reply({
      content:
        "No staff role has been set for this server. An administrator can set one with /staff.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member || !member.roles.cache.has(staffRoleId)) {
    await interaction.reply({
      content: "You do not have the staff role required to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await fn();
}

// Accepts "#006400", "006400", "#FFF", "FFF" (case-insensitive).
// Returns a normalized "#RRGGBB" string, or null if invalid.
function parseHexColor(input) {
  const cleaned = String(input).trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  return null;
}

function isValidHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Resolves a display name for a user, preferring the guild nickname if the
// user is a member of this server. Falls back to the user's global tag/name.
async function resolveDisplayName(interaction, user) {
  if (interaction.guild) {
    const member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);
    if (member) return member.displayName;
  }
  return user.globalName ?? user.tag;
}

client.login(token);
