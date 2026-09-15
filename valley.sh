#!/usr/bin/env bash
# Boot the street: the agent (8300) + the shop (3200). Ctrl+C stops both.
# Ports are overridable:  AGENT_PORT=8101 APP_PORT=3201 bash valley.sh
set -euo pipefail
cd "$(dirname "$0")"

AGENT_PORT="${AGENT_PORT:-8300}"
APP_PORT="${APP_PORT:-3200}"

if [ ! -f .env ]; then
  echo "No .env yet. Run:  cp .env.example .env"
  exit 1
fi
if ! .venv/bin/python -c "import forge,sys; sys.exit(0 if forge.MODE else 1)" 2>/dev/null; then
  echo "Not configured yet. Either point gcloud at a project (Vertex, the default):"
  echo "    gcloud config set project YOUR_PROJECT_ID"
  echo "or put an API key in .env — see .env.example."
  exit 1
fi

echo "VALLEY_AGENT_URL=http://127.0.0.1:${AGENT_PORT}" > site/.env.local

# Check for the BINARY, not the folder. A half-finished `npm install` — Cloud Shell
# times one out now and then — leaves site/node_modules there with nothing useful in
# it, and the old check waved that through. You found out ninety seconds later, from
# `next: command not found`.
if [ ! -x site/node_modules/.bin/next ]; then
  echo "  installing the app's dependencies (a minute or two the first time)…"
  if ! (cd site && npm install --no-fund --no-audit); then
    echo
    echo "  npm install failed. Try it on its own so you can read the error:"
    echo "      cd site && npm install"
    exit 1
  fi
fi
if [ ! -x site/node_modules/.bin/next ]; then
  echo
  echo "  npm install finished but site/node_modules/.bin/next is still missing."
  echo "  Clear it out and try once more:"
  echo "      rm -rf site/node_modules site/package-lock.json && cd site && npm install"
  exit 1
fi

# Stop only what this script started. `kill 0` signals the whole process group, which
# in Cloud Shell includes the shell you are typing in — hence the segfault on Ctrl+C.
pids=()
cleanup() {
  trap - EXIT INT TERM
  # Each job is a subshell, and the server it started is a child of THAT — so kill
  # the children first or the dev server outlives the Ctrl+C that was meant for it.
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] || continue
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done
  # A last sweep for anything they left behind, matched on OUR ports so that nothing
  # else you have running on this machine is in range.
  pkill -f "uvicorn street.service:app --port ${AGENT_PORT}" 2>/dev/null || true
  pkill -f "next dev.*--port ${APP_PORT}" 2>/dev/null || true
  true
}
trap cleanup EXIT INT TERM

# Is anything already on these ports? Without this the agent fails to bind, the
# script cheerfully prints the URL anyway, and the shop spends the next hour talking
# to whatever else happens to be listening there.
port_state() {
  .venv/bin/python - "$1" <<'PY'
import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", int(sys.argv[1]))); print("free")
except OSError:
    print("busy")
finally:
    s.close()
PY
}
for spec in "AGENT_PORT ${AGENT_PORT} street" "APP_PORT ${APP_PORT} shop"; do
  set -- $spec
  if [ "$(port_state "$2")" = "busy" ]; then
    echo
    echo "  Port $2 is already in use, so the $3 cannot start there."
    echo "  Either stop whatever is on it, or pick another port:"
    echo "      $1=$(( $2 + 11 )) bash valley.sh"
    exit 1
  fi
done

.venv/bin/uvicorn street.service:app --port "$AGENT_PORT" --log-level warning &
pids+=($!)
(cd site && npm run dev -- --port "$APP_PORT") &
pids+=($!)

# Say the URL only once the thing behind it actually answers.
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://127.0.0.1:${AGENT_PORT}/health"; then break; fi
  sleep 1
done
if ! curl -sf -o /dev/null "http://127.0.0.1:${AGENT_PORT}/health"; then
  echo
  echo "  The street never came up on ${AGENT_PORT}. Run it on its own to see why:"
  echo "      .venv/bin/uvicorn street.service:app --port ${AGENT_PORT}"
  exit 1
fi

echo
echo "  street → http://127.0.0.1:${AGENT_PORT}"
echo "  valley → http://localhost:${APP_PORT}"
echo
wait
