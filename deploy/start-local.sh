#!/bin/bash
# Runs the whole app on this laptop and publishes it at a fixed address
# through ngrok (https, so the browser allows the microphone).
#
#   bash deploy/start-local.sh          # builds, starts, prints the link
#   bash deploy/start-local.sh --no-build
#   bash deploy/stop-local.sh           # stops everything
#
# Same layout as the container (Dockerfile): one router on :7860 (Caddy,
# deploy/Caddyfile) in front of the frontend (3000), backend (4000) and
# speech-to-text (5001). Needs deploy/.env (git-ignored) with:
#   NGROK_AUTHTOKEN=...                 (ngrok dashboard -> Your Authtoken)
#   NGROK_DOMAIN=xyz.ngrok-free.app     (ngrok dashboard -> Domains, free)
#   ACCESS_CODE=...                     (needed to create a meeting)
# and backend/.env as usual (database, Fish, Groq, DeepSeek, TURN).
set -euo pipefail
cd "$(dirname "$0")/.."
setting() { grep -E "^$1=" deploy/.env | head -1 | cut -d= -f2- | tr -d "\"'\r"; }
DOMAIN=$(setting NGROK_DOMAIN)
export NGROK_AUTHTOKEN=$(setting NGROK_AUTHTOKEN)
ACCESS_CODE=$(setting ACCESS_CODE)
for v in DOMAIN NGROK_AUTHTOKEN ACCESS_CODE; do
  [ -n "${!v}" ] || { echo "Missing $v in deploy/.env"; exit 1; }
done

# winget installs these outside PATH for Git Bash; find them either way.
find_tool() {
  command -v "$1" 2>/dev/null ||
    ls /c/Users/*/AppData/Local/Microsoft/WinGet/Packages/*/"$1".exe 2>/dev/null | head -1
}
NGROK=$(find_tool ngrok); CADDY=$(find_tool caddy)
[ -n "$NGROK" ] && [ -n "$CADDY" ] || { echo "Install ngrok and caddy (winget install Ngrok.Ngrok CaddyServer.Caddy)"; exit 1; }

# Git Bash would otherwise rewrite "/api" into a Windows path.
export MSYS_NO_PATHCONV=1
mkdir -p deploy/logs

if [ "${1:-}" != "--no-build" ]; then
  echo "Building (1-2 minutes)..."
  # Page and API share one address, so the page uses relative URLs.
  (cd frontend && NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_WS_URL=/ npm run build) > deploy/logs/build.log 2>&1
  (cd backend && npm run build) >> deploy/logs/build.log 2>&1
fi

echo "Starting services..."
# The speech service's own Python, directly. "uv run" goes through a small
# launcher that failed from some terminals ("No Python at ..."); this is also
# how the container starts it.
ASR_PY=asr/.venv/Scripts/python.exe
[ -x "$ASR_PY" ] || ASR_PY=asr/.venv/bin/python
(cd asr && "../$ASR_PY" -m uvicorn main:app --host 127.0.0.1 --port 5001) > deploy/logs/asr.log 2>&1 &
(cd backend && NODE_ENV=production ACCESS_CODE="$ACCESS_CODE" FRONTEND_URL="https://$DOMAIN" node dist/main.js) > deploy/logs/backend.log 2>&1 &
(cd frontend && npx next start -H 127.0.0.1 -p 3000) > deploy/logs/frontend.log 2>&1 &
"$CADDY" run --config deploy/Caddyfile --adapter caddyfile > deploy/logs/router.log 2>&1 &
"$NGROK" http 7860 --url="https://$DOMAIN" --log=stdout --log-level=warn > deploy/logs/ngrok.log 2>&1 &

# Ready when the health check passes through the router (the speech model
# takes ~30s to load and warm up).
for _ in $(seq 1 90); do
  if curl -s "http://127.0.0.1:7860/api/health" | grep -q '"ok":true'; then
    echo
    echo "Live at https://$DOMAIN  (access code to create a meeting: $ACCESS_CODE)"
    echo "Logs in deploy/logs/. Stop with: bash deploy/stop-local.sh"
    exit 0
  fi
  sleep 2
done
echo "Not healthy after 3 minutes -- see deploy/logs/*.log"
exit 1
