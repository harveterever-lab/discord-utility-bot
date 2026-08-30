// One-time slash command registration script.
// Run with: npm run deploy
// Re-run whenever you change command definitions below.

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}
if (!clientId) {
  console.error(
    "Missing CLIENT_ID environment variable (the bot application's ID)."
  );
  process.exit(1);
}

const commands = [
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
];

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`
    );

    // Global commands are available across all guilds. They can take up to an
    // hour to cache. For instant testing, swap Routes.applicationCommands
    // for Routes.applicationGuildCommands(clientId, guildId).
    const data = await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });

    console.log(
      `Successfully reloaded ${data.length} application (/) commands globally.`
    );
    console.log(
      "Note: global commands may take up to 1 hour to appear in all guilds."
    );
    console.log(
      "For instant local testing, use applicationGuildCommands instead."
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
