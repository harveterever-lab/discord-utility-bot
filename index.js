const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

// --- AFK store (in-memory only; resets on restart) -------------------------
// Map<userId, { reason: string, timestamp: number }>
const afkUsers = new Map();

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

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
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

client.login(token);
