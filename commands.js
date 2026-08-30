const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

// All slash command definitions live here so both index.js (auto-register on
// startup) and deploy-commands.js (manual CLI deploy) stay perfectly in sync.

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set yourself as Away From Keyboard.")
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Why are you going AFK?")
        .setRequired(false)
    )
    .toJSON(),

  // Administrator-only commands: default permissions make them invisible
  // and unusable to non-admins. They are re-checked in the interaction handler.
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Make the bot send a message in this channel.")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message the bot should send.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Make the bot send a rich embed.")
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("The embed description (main text).")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("embed_color")
        .setDescription("A HEX color, e.g. #006400 or 006400.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("image")
        .setDescription("Image URL to display in the embed.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("footer")
        .setDescription("Footer text for the embed.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("react")
    .setDescription("Add emoji reactions to a message by its ID.")
    .addStringOption((option) =>
      option
        .setName("message_id")
        .setDescription("The ID of the message to react to.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("emojis")
        .setDescription(
          "Emojis separated by spaces, e.g. 👍 ❤️ :custom: :anim~1:"
        )
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's Discord avatar in an embed.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Whose avatar to show (defaults to you).")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("banner")
    .setDescription("Show a user's Discord banner in an embed.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Whose banner to show (defaults to you).")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show information about a user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Whose info to show (defaults to you).")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("membercount")
    .setDescription("Show the current server member count.")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set the slowmode for this channel (admin only).")
    .addIntegerOption((option) =>
      option
        .setName("seconds")
        .setDescription("Seconds between messages (0 to disable).")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

module.exports = { commandDefinitions };
