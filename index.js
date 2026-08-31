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

// --- Bot startup time (in-memory only; resets on restart) -------------------
const startTime = Date.now();

const ADMIN_PERMISSION = PermissionFlagsBits.Administrator;
const MANAGE_ROLES_PERMISSION = PermissionFlagsBits.ManageRoles;
const MANAGE_MESSAGES_PERMISSION = PermissionFlagsBits.ManageMessages;

const INVITE_URL = "https://discord.com/oauth2/authorize?client_id=1543079364604985364&permissions=8&scope=bot%20applications.commands";

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
      await requireManageMessages(interaction, () => handlePurgeUser(interaction));
      break;
    }
    case "info": {
      await handleInfo(interaction);
      break;
    }
    default:
      break;
  }
});

// --- Message listener: AFK mention + self-message removal ------------------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  if (afkUsers.has(message.author.id)) {
    afkUsers.delete(message.author.id);
    try {
      const reply = await message.reply(
        "Welcome back! Your AFK status has been removed."
      );
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    } catch {
      /* ignore */
    }
  }

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
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const sticky = stickyMessages.get(message.channelId);
  if (!sticky) return;

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

// --- !u create: role creation prefix command ------------------------------
// Parses "!u create [name] [color]" with an optional image attachment used
// as the role icon. Requires Administrator or Manage Roles.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith("!u create")) return;

  await handleUCreate(message);
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

  let color = "#006400";
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

  const tokens = emojisInput.trim().split(/\s+/).filter(Boolean);

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
    const customMatch = token.match(/^<(a)?:([a-zA-Z0-9_]+):(\d+)>$/);
    try {
      if (customMatch) {
        await targetMessage.react(token);
        added.push(token);
      } else {
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
  const user = interaction.options.getUser("user") ?? interaction.user;

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
  const user = interaction.options.getUser("user") ?? interaction.user;

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

  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: `I can't manage **${role.name}** because it is at or above my highest role. Move my role above it in the server settings.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

  const savedRoleIds = [];
  const rolesToRemove = [];

  for (const [, role] of targetMember.roles.cache) {
    if (role.id === guild.id) continue;
    if (role.position >= botMember.roles.highest.position) continue;
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

  if (!quarantineStore.has(guild.id)) {
    quarantineStore.set(guild.id, new Map());
  }
  quarantineStore.get(guild.id).set(targetUser.id, savedRoleIds);

  try {
    await targetUser.send(
      `You have been quarantined in **${guild.name}** for: **${reason}**`
    );
  } catch {
    /* DM may fail if user has DMs closed */
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

// --- Purge User -------------------------------------------------------------

async function handlePurgeUser(interaction) {
  const targetUser = interaction.options.getUser("user");
  const amount = interaction.options.getInteger("amount");

  if (!amount || amount < 1 || amount > 100) {
    await interaction.reply({
      content: "Amount must be between 1 and 100.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Fetch up to 100 recent messages, then filter by the target user.
    // Discord's bulk delete only works on messages sent within the last 14 days
    // and allows a maximum of 100 messages per call.
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const userMessages = messages.filter(
      (m) => m.author.id === targetUser.id
    );

    const toDelete = userMessages.first(amount);

    if (toDelete.length === 0) {
      await interaction.editReply(
        `No recent messages from ${targetUser} were found in this channel.`
      );
      return;
    }

    // Bulk delete supports up to 100 messages at once.
    // Messages older than 14 days cannot be bulk-deleted and must be deleted
    // individually. We attempt bulk first, then fall back to individual deletes.
    const bulkMessages = toDelete.filter(
      (m) => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
    );
    const oldMessages = toDelete.filter(
      (m) => Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
    );

    let deletedCount = 0;

    if (bulkMessages.length > 0) {
      await interaction.channel.bulkDelete(bulkMessages);
      deletedCount += bulkMessages.length;
    }

    for (const msg of oldMessages) {
      try {
        await msg.delete();
        deletedCount++;
      } catch {
        /* individual delete may fail if message is already gone */
      }
    }

    const embed = new EmbedBuilder()
      .setColor("#006400")
      .setDescription(
        `Successfully deleted **${deletedCount}** message${deletedCount === 1 ? "" : "s"} from ${targetUser}.`
      )
      .setFooter({ text: `Purged by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply(
      `Failed to purge messages: ${error.message}`
    );
  }
}

// --- Bot Info ---------------------------------------------------------------

async function handleInfo(interaction) {
  const botUser = client.user;
  const ping = Math.round(client.ws.ping);
  const avatarUrl = botUser.displayAvatarURL({ size: 4096, extension: "png" });
  const uptime = formatDuration(Date.now() - startTime);

  const inviteButton = new ButtonBuilder()
    .setLabel("Invite Lumi")
    .setStyle(ButtonStyle.Link)
    .setURL(INVITE_URL);

  const row = new ActionRowBuilder().addComponents(inviteButton);

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setTitle("Lumi — Bot Info")
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "Name", value: "Lumi", inline: true },
      { name: "Ping", value: `${ping}ms`, inline: true },
      { name: "Invite", value: `[Link](${INVITE_URL})`, inline: true },
      { name: "Restarted", value: uptime + " ago", inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], components: [row] });
}

// --- !u create handler ----------------------------------------------------

async function handleUCreate(message) {
  const member = message.member;
  if (!member) return;

  const hasPermission =
    member.permissions.has(ADMIN_PERMISSION) ||
    member.permissions.has(MANAGE_ROLES_PERMISSION);

  if (!hasPermission) {
    await message.reply(
      "You need **Administrator** or **Manage Roles** permission to use this command."
    );
    return;
  }

  const args = message.content.trim().split(/\s+/);

  // args[0] = "!u", args[1] = "create", args[2] = name, args[3] = color
  if (args.length < 4) {
    await message.reply(
      'Usage: `!u create [name] [color]`\n' +
      'Colors must be valid HEX codes, e.g. `#006400` or `006400`.\n' +
      'You can also attach an image to set as the role icon.'
    );
    return;
  }

  const name = args[2];
  const colorRaw = args[3];
  const color = parseHexColor(colorRaw);

  if (color === null) {
    await message.reply(
      `Invalid HEX color: \`${colorRaw}\`. Use a 6-digit hex code, e.g. \`#006400\` or \`006400\`.`
    );
    return;
  }

  if (name.length < 1 || name.length > 100) {
    await message.reply(
      "Role name must be between 1 and 100 characters."
    );
    return;
  }

  let iconBuffer = null;
  if (message.attachments.size > 0) {
    const attachment = message.attachments.first();
    const contentType = attachment.contentType || "";

    if (!contentType.startsWith("image/")) {
      await message.reply(
        "The attached file is not an image. Please attach a PNG, JPEG, or GIF image for the role icon."
      );
      return;
    }

    const MAX_ICON_SIZE = 256 * 1024;
    if (attachment.size > MAX_ICON_SIZE) {
      await message.reply(
        `The attached image is too large for a role icon. Discord limits role icons to 256 KB. Your image is ${(attachment.size / 1024).toFixed(1)} KB.`
      );
      return;
    }

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        await message.reply("Failed to download the attached image. Please try again.");
        return;
      }
      iconBuffer = Buffer.from(await response.arrayBuffer());
    } catch {
      await message.reply("Failed to download the attached image. Please try again.");
      return;
    }
  }

  const botMember = await message.guild.members.fetchMe();
  if (!botMember.permissions.has(MANAGE_ROLES_PERMISSION)) {
    await message.reply(
      "I don't have the **Manage Roles** permission. Please grant it to me in the server settings."
    );
    return;
  }

  const roleColor = parseInt(color.slice(1), 16);

  const roleOptions = {
    name,
    color: roleColor,
    reason: `Role created by ${message.author.tag} via !u create`,
  };

  if (iconBuffer) {
    roleOptions.icon = iconBuffer;
  }

  try {
    const createdRole = await message.guild.roles.create(roleOptions);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("Role Created")
      .addFields(
        { name: "Name", value: createdRole.name, inline: true },
        { name: "Color", value: color, inline: true }
      )
      .setFooter({ text: `Created by ${message.author.tag}` })
      .setTimestamp();

    if (iconBuffer) {
      embed.addFields({ name: "Icon", value: "Image attached", inline: true });
    }

    await message.reply({ embeds: [embed] });
  } catch (error) {
    if (iconBuffer && error.code === 50006) {
      try {
        delete roleOptions.icon;
        const createdRole = await message.guild.roles.create(roleOptions);

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle("Role Created (without icon)")
          .setDescription(
            "The role was created, but the icon could not be set. Role icons require the server to be at **Level 2 Boost** or higher."
          )
          .addFields(
            { name: "Name", value: createdRole.name, inline: true },
            { name: "Color", value: color, inline: true }
          )
          .setFooter({ text: `Created by ${message.author.tag}` })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      } catch (retryError) {
        await message.reply(
          `Failed to create the role even without the icon: ${retryError.message}`
        );
        return;
      }
    }

    await message.reply(
      `Failed to create the role: ${error.message}`
    );
  }
}

// --- Helpers ---------------------------------------------------------------

async function requireAdmin(interaction, fn) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(ADMIN_PERMISSION)) {
    await interaction.reply({
      content: "You need the Administrator permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await fn();
}

async function requireStaff(interaction, fn) {
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

async function requireManageMessages(interaction, fn) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(MANAGE_MESSAGES_PERMISSION)) {
    await interaction.reply({
      content: "You need the **Manage Messages** permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await fn();
}

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
