# Discord Utility Bot

A lightweight [Discord.js](https://discord.js.org/) v14 bot with slash commands and a prefix role-creation command. AFK data and other state are kept in memory only — no database required.

## Slash Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/afk [reason]` | Everyone | Marks you as Away From Keyboard. Mentions of an AFK user show their reason + duration. Sending any message removes your AFK status. |
| `/say [message]` | Administrator | The bot sends the provided message in the channel. |
| `/embed [description] [embed_color] [image] [footer]` | Administrator | The bot sends a rich embed. `description` is required; the rest are optional. Default color is dark green `#006400`. Hex colors are validated. |
| `/react [message_id] [emojis]` | Administrator | Adds the given emojis (separated by spaces) to the specified message. Supports Unicode, custom (`:name:id`), and animated (`a:name:id`) emojis. |
| `/avatar [user]` | Everyone | Shows the selected user's Discord avatar in an embed at the highest available quality, with a Download Avatar button. Defaults to your own avatar if no user is given. |
| `/banner [user]` | Everyone | Shows the selected user's Discord banner in an embed at the highest available quality, with a Download Banner button. Defaults to your own banner if no user is given. Shows a clear message if the user has no banner. |
| `/userinfo [user]` | Everyone | Shows information about a user (account creation date, server join date, roles). |
| `/membercount` | Everyone | Shows the current server member count. |
| `/slowmode [seconds]` | Administrator | Sets or disables channel slowmode (0–21600 seconds). |
| `/sticky [message]` | Administrator | Posts a sticky message that stays at the bottom of the channel. |
| `/unsticky` | Administrator | Removes the sticky message from the channel. |
| `/role [user] [role]` | Administrator | Toggles a role on/off a user. |
| `/staff [role] [quarantined_role]` | Administrator | Sets the server's staff role and the existing role to use for quarantined users. |
| `/quarantine [user] [reason]` | Staff | Removes the user's roles, assigns the quarantined role, DMs the user, and replies with a quarantine log embed. |
| `/unquarantine [user]` | Staff | Removes the quarantined role and restores the user's previously saved roles. Replies with an unquarantine log embed. |

## Prefix Commands

| Command | Permission | Description |
| --- | --- | --- |
| `!u create [name] [color]` | Administrator or Manage Roles | Creates a role with the given name and solid hex color. Attach an image to set it as the role icon (requires server Level 2 boost). |

## Setup

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested on Node 22)
- A Discord bot application with a token from the [Developer Portal](https://discord.com/developers/applications)

### 2. Enable Privileged Intents

In the Developer Portal, under your application → **Bot**, enable:

- **MESSAGE CONTENT INTENT** (required to detect mentions, remove AFK on send, and handle `!u create`)
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

### 5. Run the bot

```bash
npm start
```

Slash commands are auto-registered on startup.

## Deploying to Railway

1. Push this repository to GitHub.
2. In Railway, click **New Project → Deploy from GitHub repo** and select this repository.
3. Railway auto-detects Node.js via the `start` script (`node index.js`).
4. Go to the service **Variables** tab and add `DISCORD_TOKEN`.
5. Deploy.

## Notes

- AFK, sticky, staff, quarantine, and quarantine role data all live in process memory and reset whenever the bot restarts.
- The bot token is read from the `DISCORD_TOKEN` environment variable and is never written to disk or committed.
- No database is used.
