# Discord Utility Bot

A lightweight [Discord.js](https://discord.js.org/) v14 bot with four slash commands. AFK data is kept in memory only — no database required.

## Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/afk [reason]` | Everyone | Marks you as Away From Keyboard. Mentions of an AFK user show their reason + duration. Sending any message removes your AFK status. |
| `/say [message]` | Administrator | The bot sends the provided message in the channel. |
| `/embed [description] [embed_color] [image] [footer]` | Administrator | The bot sends a rich embed. `description` is required; the rest are optional. Default color is dark green `#006400`. Hex colors are validated. |
| `/react [message_id] [emojis]` | Administrator | Adds the given emojis (separated by spaces) to the specified message. Supports Unicode, custom (`:name:id`), and animated (`a:name:id`) emojis. |

Administrator-only commands are hidden from and unusable by non-admins via Discord's default member permissions, and are re-checked server-side.

## Setup

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested on Node 22)
- A Discord bot application with a token from the
  [Developer Portal](https://discord.com/developers/applications)

### 2. Enable Privileged Intents

In the Developer Portal, under your application → **Bot**, enable:

- **MESSAGE CONTENT INTENT** (required to detect mentions and remove AFK on send)
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

1. Push this repository to GitHub (see the GitHub setup steps below if you
   haven't already).
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

> Slash commands are registered by running `npm run deploy` locally (or in a
> Railway shell). The running bot does **not** re-register commands on every
> start, which keeps it lightweight.

## GitHub Setup

```bash
git init
git add .
git commit -m "Initial commit: Discord.js v14 utility bot"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Future updates are pushed to the same repository with normal `git add`,
`git commit`, and `git push` commands.

## Project Structure

```
.
├── index.js              # Bot runtime: handles events + commands
├── deploy-commands.js    # One-time slash command registration
├── package.json
├── Procfile              # Railway/Heroku process declaration
├── .env.example          # Template for environment variables
└── .gitignore
```

## Notes

- AFK data lives in process memory and resets whenever the bot restarts.
- The bot token is read from the `DISCORD_TOKEN` environment variable and is
  never written to disk or committed.
- No database is used.
