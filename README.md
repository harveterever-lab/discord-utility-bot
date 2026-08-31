# Discord Utility Bot

A lightweight [Discord.js](https://discord.js.org/) v14 bot with slash commands, prefix commands (`!u`), AFK tracking, moderation tools, and more.

## Slash Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/afk [reason]` | Everyone | Marks you as Away From Keyboard. Mentions of an AFK user show their reason + duration. Sending any message removes your AFK status. |
| `/say [message]` | Administrator | The bot sends the provided message in the channel. |
| `/embed [description] [embed_color] [image] [footer]` | Administrator | The bot sends a rich embed. `description` is required; the rest are optional. Default color is dark green `#006400`. Hex colors are validated. |
| `/react [message_id] [emojis]` | Administrator | Adds the given emojis (separated by spaces) to the specified message. Supports Unicode, custom (`:name:id`), and animated (`a:name:id`) emojis. |
| `/avatar [user]` | Everyone | Shows the selected user's Discord avatar in an embed at the highest available quality, with a Download Avatar button. |
| `/banner [user]` | Everyone | Shows the selected user's Discord banner in an embed at the highest available quality, with a Download Banner button. |
| `/userinfo [user]` | Everyone | Shows information about a user. |
| `/membercount` | Everyone | Shows the current server member count. |
| `/slowmode [seconds]` | Administrator | Sets the slowmode for this channel. |
| `/sticky [message]` | Administrator | Posts a sticky message that stays at the bottom of the channel. |
| `/unsticky` | Administrator | Removes the sticky message from this channel. |
| `/role [user] [role]` | Administrator | Toggles a role on a user. |
| `/staff [role] [quarantined_role]` | Administrator | Sets the server's staff role and quarantined role. |
| `/quarantine [user] [reason]` | Staff | Quarantines a user by stripping roles and assigning a quarantined role. |
| `/unquarantine [user]` | Staff | Removes a user from quarantine and restores their roles. |
| `/purgeuser [user] [amount]` | Manage Messages | Deletes the specified number of recent messages from a specific user in this channel. |

## Prefix Commands (`!u`)

All prefix commands start with `!u`:

| Command | Permission | Description |
| --- | --- | --- |
| `!u emoji <name>` | Manage Expressions | Adds an attached image as a custom server emoji. Attach an image to your message and provide the emoji name. |

Administrator-only commands are hidden from and unusable by non-admins via Discord's default member permissions, and are re-checked server-side.

## Setup

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested on Node 22)
- A Discord bot application with a token from the
  [Developer Portal](https://discord.com/developers/applications)

### 2. Enable Privileged Intents

In the Developer Portal, under your application → **Bot**, enable:

- **MESSAGE CONTENT INTENT** (required to detect mentions, remove AFK on send, and read `!u` prefix commands)
- **SERVER MEMBERS INTENT** (optional, improves member lookups)

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```
DISCORD_TOKEN=your-bot-token-here
CLIENT_ID=your-bot-application-id-here
```

> `CLIENT_ID` is the **Application ID** shown on the General Information page
> of your bot in the Developer Portal. It is used only by the command
> registration script, not by the running bot.

### 5. Register slash commands (one-time, re-run when commands change)

```bash
npm run deploy
```

Global commands can take up to an hour to appear in all servers. For instant
testing in a single server, edit `deploy-commands.js` and replace
`Routes.applicationCommands(clientId)` with
`Routes.applicationGuildCommands(clientId, "your-test-guild-id")`, then re-run.

### 6. Run the bot

```bash
npm start
```

## Deploying to Railway

This bot is configured for [Railway](https://railway.app/).

1. Push this repository to GitHub.
2. In Railway, click **New Project → Deploy from GitHub repo** and select this
   repository.
3. Railway auto-detects Node.js via the `start` script (`node index.js`).
   The `Procfile` is included for compatibility as well.
4. Go to the service **Variables** tab and add:
   - `DISCORD_TOKEN` — your bot token
   - `CLIENT_ID` — your bot application ID (only needed to run
     `npm run deploy` from a Railway shell; the running bot itself does not
     require it)
5. Deploy. Railway will install dependencies and start the bot.

> Slash commands are auto-registered on startup. You can also run
> `npm run deploy` manually to refresh commands without restarting.

## Project Structure

```
.
├── index.js              # Bot runtime: handles events + commands (slash + prefix)
├── commands.js           # Slash command definitions
├── deploy-commands.js    # Manual slash command registration
├── package.json
├── Procfile              # Railway/Heroku process declaration
├── .env.example          # Template for environment variables
└── .gitignore
```

## Notes

- AFK, sticky message, staff role, and quarantine data lives in process memory
  and resets whenever the bot restarts.
- The bot token is read from the `DISCORD_TOKEN` environment variable and is
  never written to disk or committed.
- No database is used.
