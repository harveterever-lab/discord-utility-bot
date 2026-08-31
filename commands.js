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

  new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Post a sticky message that stays at the bottom of the channel (admin only).")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The sticky message content.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("unsticky")
    .setDescription("Remove the sticky message from this channel (admin only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Toggle a role on a user (admin only).")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to toggle the role on.")
        .setRequired(true)
    )
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("The role to toggle.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("staff")
    .setDescription("Set the server's staff role and quarantined role (admin only).")
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("The role to designate as staff.")
        .setRequired(true)
    )
    .addRoleOption((option) =>
      option
        .setName("quarantined_role")
        .setDescription("The existing role used for quarantined users.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("quarantine")
    .setDescription("Quarantine a user (staff only).")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to quarantine.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Why is this user being quarantined?")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("unquarantine")
    .setDescription("Remove a user from quarantine (staff only).")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to unquarantine.")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("purgeuser")
    .setDescription("Purge recent messages from a specific user in this channel.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user whose messages should be purged.")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of recent messages to delete (1-100).")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Show information about the bot.")
    .toJSON(),
];

module.exports = { commandDefinitions };
