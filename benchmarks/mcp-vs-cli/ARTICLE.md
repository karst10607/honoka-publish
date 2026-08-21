# MCP vs CLI for Notion Publishing: A 4.3× Gap, Measured on 50 Real Documents

**Howard Wu** · 2026-08-21 · rig: [benchmarks/mcp-vs-cli](.) (this directory)

> **The number this article stands behind:** getting the same 50 Markdown documents
> into the same Notion database took **110.2 s** through a purpose-built CLI and
> **477.1 s** through the same tool's MCP server — a **4.3× gap** on a cold start,
> with every document succeeding on both paths. On warm runs the CLI finished in
> **0.5 s** while the MCP path still took 6–8 minutes. The rig, the raw transcripts,
> and the two-sentence reproduction are all in this repo.

## 1. Why measure this at all

[honoka-publish](https://github.com/karst10607/honoka-publish) is a small npm tool I
maintain: a CLI and an MCP server that publish local Markdown into a Notion database,
with content-hash incremental sync. Shipping both interfaces invites an obvious
question — *why would anyone use the CLI when MCP is the fashionable answer?* The
ecosystem answer is "MCP is the future". I wanted a measured answer instead.

This benchmark compares the **two driving mechanisms of the same tool**: the CLI's
one-shot sync versus the MCP server driven over stdio, one JSON-RPC
`save-and-push` call per document. Both paths run the identical Notion layer
(`src/notion.js`), against the identical corpus and the identical database. The only
variable is how the work is driven. That is the point: I wanted to know what the
protocol and tool-calling machinery *adds* on top of identical API work.

Full disclosure, stated up front: this is my own tool, and the result is unflattering
to one of its two interfaces. The raw data is public and re-runnable, which is the
only way I know to make that disclosure mean anything.

## 2. The rig

The harness lives in this directory — see [README.md](README.md) for the full method.
The short version:

- **Corpus:** 50 generated Markdown documents — frontmatter, headings, lists, a code
  block, a quote, a link — in a fresh directory per round.
- **Database:** one real Notion database, wiped of previous benchmark pages before
  the run.
- **CLI path:** spawns `honoka-publish <directory>` once, then parses its
  per-document summary line (`Done. N synced, M skipped, K errors.`).
- **MCP path:** spawns the tool's MCP server
  (`node -e "require('./src/mcp').runMCP()"`), then issues one JSON-RPC
  `tools/call` → `save-and-push` per document over stdio, with a 120 s timeout per
  call.
- **Rounds:** 3 per run. Round 1 is cold (every document must be created). Rounds
  2–3 are warm: the CLI's per-directory registry skips unchanged files; the MCP path
  queries Notion by title and updates in place.

Each round's per-document outcome is written to `results/raw/round-N.json`, and
`metrics.cjs` aggregates them into the committed [results/summary.csv](results/summary.csv):

```
round,path,wallMs,ok,fail,skipped
1,cli,110197,50,0,0
1,mcp,477148,50,0,0
2,cli,494,50,0,50
2,mcp,385542,50,0,0
3,cli,522,50,0,50
3,mcp,456056,50,0,0
```

## 3. How the first run lied to me

This section is here because the interesting result is not the final number — it is
how close I came to publishing a wrong one.

**First lie — the exit code.** The first valid-looking CLI run exited `0`. The
harness reported success. In fact all 50 documents had been rejected by the Notion
API with HTTP 400, because the generated corpus used a `js` code-fence language tag,
which Notion's block validation rejects (it requires `javascript`). The CLI's exit
code did not reflect per-document API failures. The fix was structural: parse the
CLI's per-document summary line and count `synced`/`skipped`/`errors` independently.
An exit code is a process signal, not a success report.

**Second lie — the wrong tool.** The first MCP driver called the server's
`save-clip` tool, which only writes to local disk. It returned success in ~200 ms per
document — 50/50 "ok", blazing fast, and completely wrong: nothing had reached
Notion. The MCP path had to call `save-and-push`, which performs the same local save
*plus* the Notion upsert. A driver that measures the wrong tool is not a benchmark;
it is theater with a CSV attached.

> **Methodology rule I now follow:** every path must assert success *per document*,
> against the external system (Notion), not against its own exit code or response
> envelope. If a run cannot name the 50 individual pages it created, the run is
> invalid — regardless of what the wall clock or exit code says.

## 4. Results

### Cold start (round 1) — both paths do full work

| Path | Wall time | Per doc (avg) | Ok | Fail | Skipped |
|------|-----------|---------------|----|------|---------|
| CLI (one-shot sync) | 110,197 ms (1:50) | 2.2 s | 50 | 0 | 0 |
| MCP (JSON-RPC per doc) | 477,148 ms (7:57) | 9.5 s | 50 | 0 | 0 |

Cold, apples-to-apples (every document is created on both paths), the MCP mechanism
is **4.3× slower**: 9.5 s per document versus 2.2 s. Both paths succeeded on all 50
documents, so this is not a reliability difference — it is pure overhead.

### Warm runs (rounds 2–3) — the gap opens into minutes

| Path | Round 2 | Round 3 | Ok | Skipped |
|------|---------|---------|----|---------|
| CLI | 494 ms | 522 ms | 50 | 50 (registry skip) |
| MCP | 385,542 ms (6:26) | 456,056 ms (7:36) | 50 | 0 |

Before the numbers mean anything, the honest framing: **warm rounds are not a
re-upload test.** The CLI keeps a content-hash registry, sees that nothing changed,
and does ~zero API work (494 ms is the process overhead). The MCP path has no skip
state: every `save-and-push` call queries Notion by title and rewrites the page. So
the warm number measures each driver's cost of *bringing an already-synced corpus to
a consistent state* — the CLI's is effectively free, the MCP's is a full re-publish.
That is the point: for the MCP interface, "is anything already synced?" is a question
it cannot answer without paying the full price.

### Why is the MCP path slower?

I did not profile per-phase (the rig records wall time per document; the raw
transcripts are public if you want to dig further). The structural causes I can
identify from the code, stated as hypotheses rather than measurements:

- **Per-call upsert semantics.** The MCP `save-and-push` tool queries Notion by
  title on every call to decide create-vs-update, then clears and re-appends blocks
  on updates. The CLI's cold path skips the query entirely and only creates.
- **JSON-RPC framing and serialization** per document, on top of the same API work.
- **No shared state between calls.** The CLI loops over documents in one process
  with one registry; the MCP server treats each tool call as an isolated unit of
  work.

## 5. The product finding nobody asked for

While building the rig I hit a failure mode that deserves its own section, because it
affects real users, not just generated corpora: **the Notion API rejects image
blocks whose URLs are relative.** A Markdown document with
`![screenshot](assets/img_1.png)` produces an image block with a relative URL, and
Notion answers HTTP 400 ("Content creation Failed") with an empty error body. An
absolute `https://` URL works. I verified this with a raw API test before deciding
how to handle it in the benchmark.

The consequence: **the benchmark excludes images by default** (`--images` makes them
opt-in) rather than measuring a known-broken input. This is a documented limitation
of the markdown→blocks path in general — not a Notion-MCP-specific flaw, and not
something the CLI magically solves. Real clips with local screenshots fail
identically on both paths today.

## 6. Limitations, stated before the conclusions

- **Snapshot in time, one machine, one IP.** Notion API latency varies by region and
  rate limiting. I re-ran this on one day; a publishable claim should re-run over
  multiple days. The rig supports that out of the box.
- **No LLM in the loop.** The MCP path is driven programmatically, so this measures
  the protocol path — not AI token spend, which is a separate (and probably worse)
  cost. Token accounting is an extension I have not built yet.
- **Not a general statement about MCP.** This is one server, one tool, one dataset.
  It says nothing about MCP as a protocol beyond this implementation.
- **Warm ≠ re-upload** (see above). Do not quote the 780×–870× warm ratios as
  "re-sync" numbers.
- **My own tool's warts:** honoka-publish requires Node 18+, Pro features need a
  license key, and images cannot be pushed through the markdown path at all today
  (section 5). These are tracked in the project's Known Issues page.

## 7. So when do you use which?

| Scenario | Use | Why |
|----------|-----|-----|
| Publishing one document from inside an IDE conversation | MCP | Interactive; the per-call cost is irrelevant at this volume. |
| Batch-syncing 50+ existing documents | CLI | 4.3× faster cold, ~free warm via registry. |
| CI/CD, git hooks, cron | CLI | Deterministic, scriptable, no protocol layer to babysit. |
| Automating an existing MCP workflow | MCP | If your pipeline is already MCP-native, this benchmark says: don't batch through it. |

> **Verdict:** MCP is a great interactive interface and an expensive batch interface.
> On identical work, the protocol path added 7.3 seconds per document and a 4.3×
> wall-time penalty — and it has no answer for "nothing changed since last time". A
> dedicated CLI is not a nostalgia pick; it is the difference between a 110-second
> job and an 8-minute one.

## 8. Reproduce the number (two sentences)

Clone this repo, set `NOTION_TOKEN` and `NOTION_DATABASE`, then run
`bash benchmarks/mcp-vs-cli/run.sh`: it generates 50 Markdown documents, syncs them
once through the CLI and once through the MCP server per round (3 rounds by default),
and writes `results/summary.csv` plus every raw transcript to `results/raw/`. Every
number in this article is that script's output on a fresh checkout.

```bash
export NOTION_TOKEN=ntn_...
export NOTION_DATABASE=<database id>
COUNT=50 ROUNDS=3 bash run.sh
# → results/summary.csv + results/raw/round-{1..3}-*.json
```

## 9. What I'd measure next

- **LLM in the loop:** drive the MCP tools through a real model and record token
  spend per 50-document batch. The protocol number is the floor; the LLM number is
  the real-world cost.
- **API-call counting:** a local logging proxy to count exact Notion API requests
  per path (the rig is extension-ready for this).
- **Drift over time:** re-run monthly, keep the CSV history, and update this article
  when the gap moves.

---

This article is a benchmark, not an opinion: the rig, the raw data, and the
reproduction steps are public in this repository. Re-run it. If your numbers disagree
with mine, I want to know.
