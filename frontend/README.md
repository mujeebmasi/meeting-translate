# Meet Translate — frontend

Next.js UI for [meet-translate-backend](../meet-translate-backend). A video
call where each person picks their own language and sees everyone else's
speech as live translated captions, under 4 seconds after they stop talking.

## Stack

Next.js 16 (App Router) · TypeScript · React 19 · Tailwind CSS 4 ·
`socket.io-client`

## Pages

- `/` (`src/app/page.tsx`) -- create a meeting, or join one by code/link.
- `/m/[code]` (`src/app/m/[code]/page.tsx`) -- the meeting itself: a lobby
  (name + language) then the call. This one file holds the WebRTC
  peer-connection handling, the Socket.IO signalling client, and the caption
  UI -- see the comments in there for why a couple of values (like the
  currently-selected language) are kept in a `useRef` alongside React state.

## How the translation pipeline works, from the browser's side

Fish Audio's speech-to-text needs a finished audio file, not a live stream,
so the browser can't just pipe raw microphone audio to the server. Instead:

1. `public/mic-worklet.js` runs on the browser's audio thread and hands small
   blocks of raw microphone samples to the page.
2. `src/lib/segmenter.ts` watches those blocks and decides when a spoken
   phrase has ended (a pause, or a run-on sentence past ~4 seconds), then
   hands back one WAV file.
3. That WAV is uploaded to the backend (`src/lib/api.ts`'s `sendUtterance`),
   which turns it into text, translates it, and broadcasts the result over
   the same Socket.IO connection as a `caption` event. The caption shows
   the English text, with the speaker's own words underneath in English
   letters (`romanized`, e.g. "Hindi: aaj ki meeting mein kya hua").

## Setup

```bash
npm install
```

The defaults in `src/lib/api.ts` already point at the backend's local dev
address (`http://localhost:4000`), so no `.env.local` is needed unless
you're running the backend somewhere else -- copy `.env.local.example` to
`.env.local` if so.

```bash
npm run dev
```

Open http://localhost:3000. You'll need
[meet-translate-backend](../meet-translate-backend) running alongside this
(with `MOCK=1` if you don't have Fish/Anthropic API credit yet).

Camera and microphone access require `localhost` or `https://` -- a plain
`http://` address on another machine won't be allowed to use them.

## Known limits (it's a prototype)

- No TURN server is configured (`RTC_CONFIG` in the meeting page) -- on a
  strict network that blocks direct peer connections, video may not connect.
- No automated tests on the frontend, matching this project's other
  portfolio pieces -- `src/lib/segmenter.ts` (the phrase-cutting logic) is the
  one thing here worth unit-testing, and it's a straight TypeScript port of
  the version already covered by tests in the original prototype, so adding
  them here is a reasonable next step rather than untested new logic.
