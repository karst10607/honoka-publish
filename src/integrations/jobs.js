/**
 * In-memory async job registry for MCP tool calls.
 *
 * MCP tool calls have client-side timeouts and the protocol is pull-only, so
 * long tasks (video download, URL ingestion) return a ticket id immediately
 * and clients poll get_job_status. Jobs are per-process; keep the MCP server
 * running for the duration of the work.
 */
const MAX_JOBS = 100;

const jobs = new Map();
let seq = 0;

function startJob(type, fn) {
  const id = `job_${Date.now().toString(36)}_${(++seq).toString(36)}`;
  const job = {
    id,
    type,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(id, job);
  prune();
  Promise.resolve()
    .then(fn)
    .then((result) => {
      job.status = "done";
      job.result = result;
    })
    .catch((err) => {
      job.status = "error";
      job.error = String((err && err.message) || err);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return id;
}

function getJob(id) {
  const job = jobs.get(id);
  return job ? { ...job } : null;
}

function listJobs(limit = 20) {
  return [...jobs.values()].slice(-limit).reverse().map((job) => ({ ...job }));
}

/** Drop finished jobs oldest-first once the registry exceeds MAX_JOBS. */
function prune() {
  if (jobs.size <= MAX_JOBS) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status !== "running") jobs.delete(id);
  }
}

function resetJobs() {
  jobs.clear();
}

module.exports = { startJob, getJob, listJobs, resetJobs, MAX_JOBS };