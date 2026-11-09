/**
 * Telegram adapter contract tests — node-telegram-bot-api is stubbed via
 * require.cache so no network or real token is needed. Run: npm test
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const modulePath = require.resolve("node-telegram-bot-api");

class FakeBot {
  constructor(token, opts) {
    this.token = token;
    this.opts = opts;
    this.handlers = {};
    this.sent = [];
    FakeBot.last = this;
  }
  on(event, fn) { this.handlers[event] = fn; }
  sendMessage(chatId, text) { this.sent.push({ chatId, text }); return Promise.resolve(); }
  stopPolling() { this.stopped = true; }
}
FakeBot.last = null;

require.cache[modulePath] = {
  id: modulePath,
  filename: modulePath,
  loaded: true,
  exports: FakeBot,
};

const { startBot, stopBot } = require("../src/integrations/telegram");

function message({ id = 42, text = "see https://example.com/a" } = {}) {
  return { chat: { id: 100 }, from: { id }, text };
}

test("no token leaves the bot disabled", () => {
  FakeBot.last = null;
  startBot({ token: "", onUrl: async () => {} });
  assert.equal(FakeBot.last, null);
});

test("onUrl receives a reply function and its return value is sent as final reply", async () => {
  const seen = [];
  startBot({
    token: "fake-token",
    onUrl: async (url, { reply }) => {
      seen.push(url);
      await reply("interim progress");
      return "FINAL RESULT";
    },
  });
  const bot = FakeBot.last;
  assert.ok(bot);
  await bot.handlers.message(message());
  assert.deepEqual(seen, ["https://example.com/a"]);
  const texts = bot.sent.map((m) => m.text);
  assert.ok(texts.includes("interim progress"));
  assert.ok(texts.includes("FINAL RESULT"));
  assert.ok(texts.every((t) => t !== "  ✅ Done: https://example.com/a"));
  assert.ok(bot.sent.every((m) => m.chatId === 100));
  stopBot();
});

test("undefined onUrl result keeps the generic done reply", async () => {
  startBot({ token: "fake-token", onUrl: async () => {} });
  const bot = FakeBot.last;
  await bot.handlers.message(message());
  assert.ok(bot.sent.some((m) => m.text === "  ✅ Done: https://example.com/a"));
  stopBot();
});

test("unauthorized users are rejected before onUrl runs", async () => {
  let called = false;
  startBot({ token: "fake-token", allowedUser: "42", onUrl: async () => { called = true; } });
  const bot = FakeBot.last;
  await bot.handlers.message(message({ id: 999 }));
  assert.equal(called, false);
  assert.ok(bot.sent.some((m) => m.text.includes("Unauthorized")));
  stopBot();
});

test("onUrl errors are reported with tokens redacted", async () => {
  startBot({
    token: "fake-token",
    onUrl: async () => { throw new Error("request to http://x/notes?token=SUPERSECRET&f=1 failed"); },
  });
  const bot = FakeBot.last;
  await bot.handlers.message(message());
  const errText = bot.sent.find((m) => m.text.includes("❌")).text;
  assert.ok(errText.includes("token=***"));
  assert.ok(!errText.includes("SUPERSECRET"));
  stopBot();
});

test("messages without URLs are ignored", async () => {
  let called = false;
  startBot({ token: "fake-token", onUrl: async () => { called = true; } });
  const bot = FakeBot.last;
  await bot.handlers.message(message({ text: "hello there" }));
  assert.equal(called, false);
  assert.equal(bot.sent.length, 0);
  stopBot();
});