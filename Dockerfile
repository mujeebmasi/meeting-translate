# One container with the whole app, for a single-server deployment
# (Hugging Face Spaces, or any VPS with Docker). Inside it:
#   Caddy on :7860 -> /api, /ws to the backend (4000), everything else to
#   the frontend (3000); the backend calls the speech-to-text service (5001),
#   which only listens inside the container.
# The database is outside (DATABASE_URL), and so are the paid APIs.
#
# Build needs the Hugging Face token as a build secret (the speech model is
# gated): docker build --secret id=HF_TOKEN,env=HF_TOKEN .  On HF Spaces,
# adding HF_TOKEN as a Space secret is enough.

# ---------- frontend: Next.js production build ----------
FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Same address for page and API (Caddy routes by path), so: relative URLs.
ENV NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_WS_URL=/ NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- backend: NestJS build + Prisma client ----------
FROM node:24-bookworm-slim AS backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---------- runtime ----------
FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Node (from the official image) and Caddy (the router), as single binaries.
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# HF Spaces runs the container as user 1000; everything lives in its home.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# Speech-to-text service, with the model baked into the image so waking the
# server doesn't mean downloading 2.4 GB again.
COPY --chown=user asr/pyproject.toml asr/uv.lock asr/
RUN cd asr && uv sync --frozen --no-install-project
COPY --chown=user asr/*.py asr/
RUN --mount=type=secret,id=HF_TOKEN,mode=0444,required=true \
    cd asr && HF_TOKEN=$(cat /run/secrets/HF_TOKEN) .venv/bin/python download_model.py

COPY --chown=user --from=backend /build/node_modules backend/node_modules
COPY --chown=user --from=backend /build/dist backend/dist
COPY --chown=user --from=backend /build/prisma backend/prisma
COPY --chown=user --from=backend /build/package.json backend/package.json
COPY --chown=user --from=frontend /build/.next frontend/.next
COPY --chown=user --from=frontend /build/public frontend/public
COPY --chown=user --from=frontend /build/node_modules frontend/node_modules
COPY --chown=user --from=frontend /build/package.json frontend/package.json
COPY --chown=user deploy/Caddyfile deploy/start.sh deploy/

ENV PORT=4000 ASR_URL=http://127.0.0.1:5001 NODE_ENV=production
EXPOSE 7860
CMD ["bash", "deploy/start.sh"]
