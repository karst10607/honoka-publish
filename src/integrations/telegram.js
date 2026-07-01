/**
 * Telegram bot integration — receive URLs via Telegram and auto-publish.
 * Clean external addition (no company IP).
 */
const path = require("path");

let _bot = null;

/**
 * Initialize the Telegram bot listener.
 * @param {object} opts
 * @param {string} opts.token - Telegram Bot Token
 * @param {function} opts.onUrl - Callback when a URL is received: (url) => void
 * @param {string} [opts.allowedUser] - Optional Telegram user ID restriction
 */
function startBot({ token, onUrl, allowedUser }) {
  if (!token) {
    console.log("  Telegram: no token — disabled");
    return;
  }

  // Stop existing bot if any
  stopBot();

  let TelegramBot;
  try {
    TelegramBot = require("node-telegram-bot-api");
  } catch {
    console.warn("  Telegram: node-telegram-bot-api not installed. Run: npm install");
    return;
  }

  const bot = new TelegramBot(token, { polling: { interval: 2000 } });
  _bot = bot;

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = String(msg.from?.id || "");

    // Check authorization
    if (allowedUser && userId !== String(allowedUser)) {
      bot.sendMessage(chatId, "⛔ Unauthorized user.");
      return;
    }

    // Extract URLs from message
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex);
    if (!urls || urls.length === 0) return;

    bot.sendMessage(chatId, `📥 Processing ${urls.length} URL(s)...`);

    for (const url of urls) {
      try {
        bot.sendMessage(chatId, `  🔍 ${url}`);
        if (onUrl) await onUrl(url);
        bot.sendMessage(chatId, `  ✅ Done: ${url}`);
      } catch (err) {
        bot.sendMessage(chatId, `  ❌ ${url}: ${err.message}`);
      }
    }
  });

  bot.on("polling_error", (err) => {
    if (err.code === "EFATAL") {
      console.error("  Telegram: fatal polling error — check network/VPN.");
    }
  });

  console.log("  Telegram: bot started ✓");
}

function stopBot() {
  if (_bot) {
    try { _bot.stopPolling(); } catch { /* ignore */ }
    _bot = null;
  }
}

module.exports = { startBot, stopBot };
