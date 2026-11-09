/**
 * In-process event bus for the honoka bridge.
 *
 * Domain events (url_received / download_progress / note_saved / error) are
 * emitted by the URL pipeline and streamed to subscribers via GET /events
 * (SSE). A small ring buffer supports Last-Event-ID replay after reconnects.
 * Payloads must stay token-free: all string fields are scrubbed of `token=`.
 */
const MAX_EVENTS = 100;

const listeners = new Set();
const ring = [];
let seq = 0;

function scrub(value) {
  if (typeof value === "string") return value.replace(/token=[^&\s"')]+/gi, "token=***");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = scrub(entry);
    return out;
  }
  return value;
}

function emitEvent(event) {
  const entry = { id: String(++seq), ts: new Date().toISOString(), ...scrub(event) };
  ring.push(entry);
  if (ring.length > MAX_EVENTS) ring.shift();
  for (const listener of listeners) {
    try { listener(entry); } catch { /* subscriber failures must not break the pipeline */ }
  }
  return entry;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Events newer than lastId (all buffered events when unset/invalid). */
function replaySince(lastId) {
  const since = Number(lastId);
  if (!Number.isFinite(since)) return ring.slice();
  return ring.filter((event) => Number(event.id) > since);
}

function resetEvents() {
  listeners.clear();
  ring.length = 0;
  seq = 0;
}

module.exports = { emitEvent, subscribe, replaySince, resetEvents, MAX_EVENTS };