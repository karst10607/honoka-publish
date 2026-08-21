#!/usr/bin/env bash
# MCP vs CLI benchmark — one-shot runner.
#
# Usage:
#   NOTION_TOKEN=ntn_... NOTION_DATABASE=<db-id> bash run.sh
#   COUNT=50 ROUNDS=3 bash run.sh
#
# Auto-loads NOTION_TOKEN from the house-loan workspace .env.local when unset.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="../../../notion-forum-experiment/.env.local"
if [[ -z "${NOTION_TOKEN:-}" && -f "$ENV_FILE" ]]; then
  set -a; . "$ENV_FILE"; set +a
fi

if [[ -z "${NOTION_TOKEN:-}" ]]; then
  echo "ERROR: NOTION_TOKEN is not set. Export it (see README)." >&2
  exit 1
fi
if [[ -z "${NOTION_DATABASE:-}" ]]; then
  if [[ -n "${NOTION_POSTS_DATABASE_ID:-}" ]]; then
    export NOTION_DATABASE="$NOTION_POSTS_DATABASE_ID"
    echo "NOTICE: NOTION_DATABASE not set, using NOTION_POSTS_DATABASE_ID from .env.local" >&2
  else
    echo "ERROR: NOTION_DATABASE is not set. Pick any Notion database id (see README)." >&2
    exit 1
  fi
fi

COUNT="${COUNT:-50}"
ROUNDS="${ROUNDS:-3}"

mkdir -p results/raw
node gen-docs.cjs --count "$COUNT" --out work/docs

echo "== benchmark: $COUNT docs, $ROUNDS rounds (same corpus, same Notion DB) =="
for r in $(seq 1 "$ROUNDS"); do
  node paths/cli-path.cjs --round "$r"
  node paths/mcp-path.cjs --round "$r"
done

node metrics.cjs
echo "== summary written to results/summary.csv =="
