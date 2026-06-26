#!/usr/bin/env bash
#
# restart.sh — stop every running OmniMind dev service (clearing duplicates / stale
# instances) and start a single fresh one. Scoped to THIS repo only: it never touches
# Next.js servers from other projects on your machine.
#
# Usage:
#   ./scripts/restart.sh               # stop this repo's dev services, start fresh (background)
#   ./scripts/restart.sh --fg          # ...run attached to this terminal instead
#   ./scripts/restart.sh --port 4000   # ...prefer this port (or: PORT=4000 ./scripts/restart.sh)
#   ./scripts/restart.sh --stop        # just stop everything, don't start
#   ./scripts/restart.sh --force-port  # also kill whatever else holds the target port
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Preferred port precedence: --port / PORT env > .env.local PORT > 3000.
PORT_EXPLICIT=0
[[ -n "${PORT:-}" ]] && PORT_EXPLICIT=1
FOREGROUND=0
STOP_ONLY=0
FORCE_PORT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fg|--foreground) FOREGROUND=1; shift ;;
    --stop) STOP_ONLY=1; shift ;;
    --force-port) FORCE_PORT=1; shift ;;
    --port) PORT="${2:?--port needs a value}"; PORT_EXPLICIT=1; shift 2 ;;
    --port=*) PORT="${1#*=}"; PORT_EXPLICIT=1; shift ;;
    -h|--help) sed -n '3,16p' "$0"; exit 0 ;;
    *) echo "restart.sh: unknown argument '$1' (try --help)" >&2; exit 2 ;;
  esac
done

if [[ "$PORT_EXPLICIT" -eq 0 ]]; then
  ENV_PORT=""
  [[ -f "$ROOT/.env.local" ]] && \
    ENV_PORT="$(grep -E '^[[:space:]]*PORT=' "$ROOT/.env.local" | head -1 | sed -E 's/^[[:space:]]*PORT=//; s/["'"'"'[:space:]]//g')"
  PORT="${ENV_PORT:-3000}"
fi

LOG_DIR="$ROOT/.data"
LOG_FILE="$LOG_DIR/dev.log"
PID_FILE="$LOG_DIR/dev.pid"
mkdir -p "$LOG_DIR"

# Matches only this repo's Next.js dev process (the command line carries the repo path).
SCOPE="$ROOT/node_modules/.bin/next"

kill_tree() { # kill a pid and its descendants by PID (children first). Never kills by
              # process group — macOS has no setsid, so a backgrounded server shares the
              # launcher's group and a group-kill would take down this script too.
  local pid="$1" sig="${2:-TERM}" kid kids
  kids="$(pgrep -P "$pid" 2>/dev/null || true)"
  while IFS= read -r kid; do
    [[ -n "$kid" ]] && kill_tree "$kid" "$sig"
  done <<< "$kids"
  kill -"$sig" "$pid" 2>/dev/null || true
}

find_free_port() { # echo the first free port at/after $1
  local p="$1" i
  for i in $(seq 0 25); do
    if ! lsof -ti "tcp:$p" >/dev/null 2>&1; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  echo "$1"
}

# ---------------------------------------------------------------------------
# 1. STOP every existing dev service for THIS repo (clears duplicates).
# ---------------------------------------------------------------------------
echo "==> Stopping OmniMind dev services for $ROOT …"

# (a) the background server this script last started, if still alive
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null && kill_tree "$OLD_PID" TERM
  rm -f "$PID_FILE"
fi

# (b) any Next dev process whose command line points at THIS repo.
#     (newline-separated pid list + while-read loop → portable to bash 3.2 on macOS)
PIDS="$(pgrep -f "$SCOPE" 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  echo "    found running instance(s): $(echo "$PIDS" | tr '\n' ' ')"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill_tree "$pid" TERM
  done <<< "$PIDS"
  sleep 1
  # force-kill any survivors
  LEFT="$(pgrep -f "$SCOPE" 2>/dev/null || true)"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill_tree "$pid" KILL
  done <<< "$LEFT"
else
  echo "    no running instances for this repo."
fi

# (c) optional: also reclaim the port from an unrelated process
if [[ "$FORCE_PORT" -eq 1 ]]; then
  PORT_PIDS="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  if [[ -n "$PORT_PIDS" ]]; then
    echo "    --force-port: killing other holders of :$PORT ($(echo "$PORT_PIDS" | tr '\n' ' '))"
    # shellcheck disable=SC2086
    kill -9 $PORT_PIDS 2>/dev/null || true
  fi
fi

sleep 1
echo "    all clear."

if [[ "$STOP_ONLY" -eq 1 ]]; then
  echo "==> Stopped (no restart requested)."
  exit 0
fi

# Next 16 errors on EADDRINUSE rather than auto-incrementing, so pick a free port ourselves.
if [[ "$FORCE_PORT" -eq 0 ]]; then
  FREE="$(find_free_port "$PORT")"
  if [[ "$FREE" != "$PORT" ]]; then
    echo "    port $PORT is held by another app → using free port $FREE"
    echo "      (use --force-port to take $PORT, or --port N to choose another)"
    PORT="$FREE"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Ensure schema + seeded system accounts, then START fresh.
# ---------------------------------------------------------------------------
echo "==> Ensuring database schema + system accounts…"
npm run db:migrate >/dev/null 2>&1 || echo "    (migrate skipped — auto-migrates on first request)"

echo "==> Starting dev server (preferred port $PORT)…"

if [[ "$FOREGROUND" -eq 1 ]]; then
  exec env PORT="$PORT" npm run dev
fi

# Background: fully detach so it survives this script exiting; log + record PID.
: > "$LOG_FILE"
nohup env PORT="$PORT" npm run dev >"$LOG_FILE" 2>&1 &
NEW_PID=$!
disown 2>/dev/null || true
echo "$NEW_PID" > "$PID_FILE"

for _ in $(seq 1 60); do
  grep -qE "Ready|started server|Local:" "$LOG_FILE" 2>/dev/null && break
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "!! dev server exited during startup — last log lines:" >&2
    tail -n 25 "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
done

# Report the URL Next actually bound (it may differ from PORT if it was taken).
URL="$(grep -oE 'http://localhost:[0-9]+' "$LOG_FILE" | head -1 || true)"
[[ -z "$URL" ]] && URL="http://localhost:$PORT"

echo
echo "==> OmniMind is up."
echo "    URL    : $URL   (login → demo / demo123  or  admin@robohire.io / Lightark@1)"
echo "    PID    : $NEW_PID"
echo "    Logs   : tail -f $LOG_FILE"
echo "    Stop   : ./scripts/restart.sh --stop"
