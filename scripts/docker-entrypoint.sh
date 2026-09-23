#!/bin/sh
set -eu

state_dir="${NETOPS_STATE_DIR:-/data/wrangler}"
mkdir -p "$state_dir"

# The first migration is intentionally idempotent, so a named Docker volume can
# be reused across container restarts without losing browser save slots.
/app/node_modules/.bin/wrangler d1 execute DB \
  --local \
  --config /app/dist/server/wrangler.json \
  --persist-to "$state_dir" \
  --file /app/drizzle/0000_confused_puff_adder.sql

exec /app/node_modules/.bin/wrangler dev \
  --local \
  --config /app/dist/server/wrangler.json \
  --ip 0.0.0.0 \
  --port "$PORT" \
  --persist-to "$state_dir"
