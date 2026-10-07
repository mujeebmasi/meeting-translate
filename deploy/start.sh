#!/bin/bash
# Starts everything inside the container. If any part stops, the container
# exits, so the host (HF Spaces / Docker's restart policy) starts it again
# rather than leaving a half-working app running.
cd /home/user/app || exit 1

# Database tables: apply any migrations not yet applied (safe to re-run).
(cd backend && npx prisma migrate deploy) || exit 1

# Speech-to-text: loads the model and warms up each language (~30s).
(cd asr && exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port 5001) &
(cd backend && exec node dist/main.js) &
(cd frontend && exec npx next start -H 127.0.0.1 -p 3000) &
caddy run --config deploy/Caddyfile --adapter caddyfile &

# Exit as soon as any one of them does.
wait -n
echo "A service stopped; exiting so the container restarts."
exit 1
