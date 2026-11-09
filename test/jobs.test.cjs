/**
 * Async job registry tests (MCP ticket model).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { startJob, getJob, listJobs, resetJobs } = require("../src/integrations/jobs");

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a job completes and exposes its result", async () => {
  resetJobs();
  const id = startJob("save_url", async () => ({ ok: true, noteId: "n1" }));
  assert.match(id, /^job_/);
  const job = await waitFor(() => {
    const current = getJob(id);
    return current.status === "done" ? current : null;
  });
  assert.deepEqual(job.result, { ok: true, noteId: "n1" });
  assert.equal(job.type, "save_url");
  assert.ok(job.finishedAt);
});

test("a throwing job reports status error", async () => {
  resetJobs();
  const id = startJob("download_video", async () => { throw new Error("yt-dlp exploded"); });
  const job = await waitFor(() => {
    const current = getJob(id);
    return current.status === "error" ? current : null;
  });
  assert.equal(job.error, "yt-dlp exploded");
});

test("unknown tickets return null", () => {
  resetJobs();
  assert.equal(getJob("job_nope"), null);
});

test("job registry is capped at MAX_JOBS", async () => {
  resetJobs();
  for (let i = 0; i < 105; i++) startJob("noop", async () => i);
  await waitFor(() => listJobs(1000).every((job) => job.status !== "running"));
  startJob("noop", async () => "trigger-prune");
  const jobs = listJobs(1000);
  assert.ok(jobs.length <= 100, `expected <= 100 jobs, got ${jobs.length}`);
});