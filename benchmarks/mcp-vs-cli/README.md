# MCP vs CLI — publishing 50 Markdown docs to Notion

Benchmark comparing two ways of getting the same 50 Markdown files into a Notion
database:

| Path | How it runs |
|------|-------------|
| **CLI** | `honoka-publish <directory>` — one-shot sync, content-hash incremental registry |
| **MCP** | honoka-publish's MCP server driven over stdio (JSON-RPC `save-and-push` per doc: local save + Notion push — the same work the CLI sync does) |

Both paths use the same code (`src/notion.js`), the same generated corpus, and the
same Notion database. The difference measured is the **driving mechanism**, not the
Notion API layer.

## Method

1. `gen-docs.cjs` generates a fresh corpus: N Markdown files (frontmatter, headings,
   lists, code blocks, links). Images are opt-in (`--images`) but off by default —
   see the relative-URL limitation below.
2. Each round runs both paths sequentially on the SAME corpus and SAME database:
   - round 1 = cold (everything must be created)
   - rounds 2+ = warm (CLI's per-directory registry at `work/docs/.honoka/`
     skips unchanged docs; MCP queries Notion by title and updates in place)
3. `metrics.cjs` aggregates `results/raw/round-*.json` into `results/summary.csv`.
   The committed `results/summary.csv` is a sample from the author's run (evidence
   for the accompanying article); fresh runs overwrite it, raw transcripts stay
   gitignored.

Metrics captured per run: wall time (ms), per-doc ok/fail counts (CLI parsed
from its `Done. N synced, M skipped, K errors.` summary line; MCP per JSON-RPC
response), skipped count, exit code.
Extension-ready (see below): Notion API call count, LLM token usage.

## Reproduction (two sentences)

`git clone` the repo, set `NOTION_TOKEN` and `NOTION_DATABASE`, then run
`bash benchmarks/mcp-vs-cli/run.sh` — it generates 50 docs (images are opt-in
via `--images`, off by default; see the relative-URL limitation below), syncs them
once via the CLI and once via MCP tools per round (3 rounds by default), and writes
`results/summary.csv` plus every raw transcript to `results/raw/`. Every number in
the write-up is that script's output on a fresh checkout.

## Running

```bash
export NOTION_TOKEN=ntn_...
export NOTION_DATABASE=<database id>
COUNT=50 ROUNDS=3 bash run.sh
```

If run from the house-loan workspace, `NOTION_TOKEN` is auto-loaded from
`notion-forum-experiment/.env.local` (set `NOTION_DATABASE` yourself).
`HONOKA_DIR` is pinned to `work/honoka` inside the benchmark so the MCP path's
local clips and registry never touch `~/honoka-docs`.

## Limitations (stated before the numbers)

- Snapshot in time on one machine/IP; Notion API latency varies by region and rate
  limiting. Re-run on multiple days before publishing a claim.
- The MCP path is driven programmatically (no LLM), so it measures the protocol
  path, not AI token spend. Token cost is a separate extension.
- A 1x1 PNG per doc is a minimal image workload; real-world docs with large photos
  will stress Direct Upload harder.
- Results are only about this tool and this dataset — not a general statement about
  the MCP protocol.
- Warm rounds are not "re-upload" tests: the CLI skips unchanged docs via its
  registry, while the MCP path updates pages in place. The warm number therefore
  measures each driver's cost of bringing an already-synced corpus to a consistent
  state.
- The corpus uses `javascript` code fences (Notion API rejects non-standard
  language tags like `js` with HTTP 400).
- **Local images cannot be pushed (product finding)**: the markdown path emits
  image blocks with relative asset URLs (`assets/img.png`), which the Notion API
  rejects with HTTP 400 "Content creation Failed". This affects real clips with
  local assets, not just this corpus, so the benchmark excludes images rather
  than measuring a known-broken input.

## Extensions (next steps)

- **LLM path**: drive the MCP tools through a real model (Claude/Codex/Claude
  Desktop) and record session token usage from the IDE/API logs.
- **API call counting**: run both paths through a local logging proxy to count
  Notion API requests precisely.
- **Mock Notion endpoint**: implement the subset of the Notion API used here
  locally, for fully offline/zero-cost CI runs (removes rate-limit variance, at the
  cost of not measuring the real API).
- **Long-running**: re-run monthly and keep the CSV history to show drift over time.
