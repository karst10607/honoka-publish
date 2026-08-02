/**
 * Discord bot integration — receive URLs via Discord and auto-publish.
 * Follows same adapter pattern as telegram.js.
 *
 * Uses discord.js v14+ (GatewayIntentBits.MessageContent requires Privileged Intent).
 */
let _client = null;

/**
 * Initialize the Discord bot listener.
 * @param {object} opts
 * @param {string} opts.token - Discord Bot Token
 * @param {function} opts.onUrl - Callback when a URL is received: (url) => void
 * @param {string} [opts.allowedChannel] - Optional Discord channel ID restriction
 */
function startBot({ token, onUrl, allowedChannel }) {
  if (!token) {
    console.log("  Discord: no token \u2014 disabled");
    return;
  }

  stopBot();

  let Discord, GatewayIntentBits;
  try {
    Discord = require("discord.js");
    GatewayIntentBits = Discord.GatewayIntentBits;
  } catch {
    console.warn("  Discord: discord.js not installed. Run: npm install discord.js");
    return;
  }

  const client = new Discord.Client({
    intents: [
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  _client = client;

  client.on("messageCreate", async (msg) => {
    // Ignore bot messages to prevent loops
    if (msg.author.bot) return;

    // Optional channel restriction
    if (allowedChannel && msg.channelId !== allowedChannel) return;

    const text = msg.content;
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex);
    if (!urls || urls.length === 0) return;

    for (const url of urls) {
      try {
        console.log(`  Discord: processing URL: ${url}`);
        if (onUrl) await onUrl(url);
      } catch (err) {
        console.error(`  Discord: error processing ${url}: ${err.message}`);
      }
    }
  });

  client.on("ready", () => {
    const userTag = client.user?.tag || "unknown";
    console.log(`  Discord: bot started \u2713 (${userTag})`);
  });

  client.login(token).catch((err) => {
    console.error(`  Discord: login failed: ${err.message}`);
    _client = null;
  });
}

function stopBot() {
  if (_client) {
    try { _client.destroy(); } catch { /* ignore */ }
    _client = null;
  }
}

module.exports = { startBot, stopBot };
