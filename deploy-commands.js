// Manual slash command registration script.
// Run with: npm run deploy
// Re-run whenever you change command definitions in commands.js.
//
// NOTE: index.js also auto-registers commands on startup, so this script is
// only needed if you want to refresh commands without (re)starting the bot.

const { REST, Routes } = require("discord.js");
require("dotenv").config();

const { commandDefinitions } = require("./commands");

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

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commandDefinitions.length} application (/) commands.`
    );

    const data = await rest.put(Routes.applicationCommands(clientId), {
      body: commandDefinitions,
    });

    console.log(
      `Successfully reloaded ${data.length} application (/) commands globally.`
    );
    console.log(
      "Note: global commands may take up to 1 hour to appear in all guilds."
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
