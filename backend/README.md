# Meet Translate — backend

NestJS API + WebSocket signalling for [meet-translate-frontend](../meet-translate-frontend).
A video-meeting app where each person picks their own language and everyone's
speech shows up as live translated captions.

## Stack

NestJS 11 · Prisma 6.19.3 · PostgreSQL · Socket.IO (`@nestjs/websockets`)

## How it works

- **Video/audio never touches this server.** Browsers connect to each other
  directly over WebRTC. This server only helps two browsers find each other
  at the start -- see `MeetingsGateway`'s `signal` event, which just relays a
  message from one socket to another without reading it.
- **`MeetingsGateway`** (`src/meetings/meetings.gateway.ts`) handles joining a
  meeting, WebRTC signalling, and language changes over a Socket.IO
  connection.
- **`PresenceService`** (`src/meetings/presence.service.ts`) is a small
  in-memory map of who is *currently connected* to each meeting, so a signal
  message can be routed to the right socket. This is separate from the
  database, on purpose: there's no row for "an open socket connection".
- **`MeetingsService`** (`src/meetings/meetings.service.ts`) is the durable
  side, backed by Postgres via Prisma: the `Meeting`, `Participant` and
  `Utterance` (spoken phrase + translations) tables.
- **`MeetingsController`** (`src/meetings/meetings.controller.ts`) has the
  actual translation pipeline. The browser uploads one WAV file per spoken
  phrase (see the frontend's `segmenter.ts` for why), which gets:
  1. turned into text -- by the local **IndicConformer** service
     (`../asr`, called from `src/asr/`) for Hindi/Telugu/Tamil/Kannada, or
     **Fish Audio** (`src/fish/`) for English. Fish was tried for the Indian
     languages first and returned gibberish for Telugu, Tamil and Kannada.
  2. translated into English (only ever that direction -- see
     `needsTranslation()` in `src/languages.ts`) by **DeepSeek**
     (`src/translate/`), via DeepSeek's Anthropic-compatible endpoint --
     hence still using `@anthropic-ai/sdk` as the client, just given a
     `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` explicitly rather than the
     SDK's own default `ANTHROPIC_*` env vars. Swap to real Anthropic by
     changing those two lines in `translate.service.ts`'s `client()` back
     to `new Anthropic()` (reads `ANTHROPIC_API_KEY` itself) and `MODEL` to
     a `claude-*` name.
  3. broadcast to everyone as a caption right away, then spoken in English
     by **Fish Audio text-to-speech** and pushed (as a separate `voice`
     socket event) only to the English listeners. Saved to Postgres last,
     without holding anything up.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL` -- your local Postgres password (create a `meet_translate`
  database first, or point this at one that already exists)
- `FISH_API_KEY` -- from https://fish.audio/app/api-keys/ (needs API credit,
  see https://fish.audio/app/developers -- separate from any free website
  credit)
- `DEEPSEEK_API_KEY` -- from https://platform.deepseek.com (free token
  grant on signup, no card)

No credit on either account yet? Set `MOCK=1` instead and skip both keys --
the app runs with fake, pre-written captions (`src/mock.service.ts`) so the
real video call and caption UI can still be tried for free. A banner in the
meeting UI says when this is on.

```bash
npx prisma migrate dev --name init
npm run start:dev
```

API runs at `http://localhost:4000/api`, WebSocket at `ws://localhost:4000/ws`.
Then run [meet-translate-frontend](../meet-translate-frontend) alongside it.

## Testing

```bash
npm test
```

None of it needs a database, API keys, or a browser -- these are unit tests
against plain classes, using Jest with real fake-server integration where it
matters:
- `fish.service.spec.ts` / `translate.service.spec.ts` -- each hits a fake
  local HTTP server (`FISH_BASE_URL` / `DEEPSEEK_BASE_URL`), checking the
  real request shapes and error handling.
- `presence.service.spec.ts` -- the live in-memory room bookkeeping, with a
  fake socket instead of a real connection.
- `meetings.service.spec.ts` -- the Prisma-backed logic, with a fake
  `PrismaService` (`jest.fn()` stubs) so no database is needed.

It doesn't cover the gateway's socket.io wiring itself or the controller's
routing -- this is the parts with the most non-obvious logic, not full
coverage.

## Known limits (it's a prototype)

- **No TURN server** -- WebRTC only has a public STUN server configured (see
  the frontend's `RTC_CONFIG`). On strict corporate/mobile networks that
  block direct peer connections, video may not connect.
- **Up to 6 people per meeting** (`MAX_PEOPLE` in `meetings.gateway.ts`) --
  video is peer-to-peer, so every extra person adds a connection to everyone
  else.
- **The 4-second budget is per phrase**, measured from when someone stops
  speaking to when the caption reaches everyone (`serverMs` in the caption
  payload).
