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
 * @param {function} opts.onUrl - Callback when a URL is received:
 *   (url, { reply }) => Promise<string|void>. `reply(text)` sends an interim
 *   message to the same chat; a returned string is sent as the final reply.
 * @param {string} [opts.allowedUser] - Optional Telegram user ID restriction
 */
function startBot({ token, onUrl, allowedUser }) {
  if (!token) {
    console.log("  Telegram: no token — disabled (set telegramBotToken + telegramAllowedUser via POST /api/settings)");
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
        const reply = (text) => bot.sendMessage(chatId, text);
        const finalText = onUrl ? await onUrl(url, { reply }) : undefined;
        bot.sendMessage(chatId, typeof finalText === "string" ? finalText : `  ✅ Done: ${url}`);
      } catch (err) {
        const safeMessage = String(err.message).replace(/token=[^&\s"')]+/gi, "token=***");
        bot.sendMessage(chatId, `  ❌ ${url}: ${safeMessage}`);
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
