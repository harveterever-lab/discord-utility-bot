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

const ADMIN_PERMISSION = PermissionFlagsBits.Administrator;

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

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setDescription(sticky.content)
    .setFooter({ text: "Sticky Message" });

  try {
    const sent = await message.channel.send({ embeds: [embed] });
    sticky.messageId = sent.id;
  } catch {
    /* ignore */
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

  const embed = new EmbedBuilder()
    .setColor("#006400")
    .setDescription(content)
    .setFooter({ text: "Sticky Message" });

  const sent = await interaction.channel.send({ embeds: [embed] });

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
