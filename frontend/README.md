# Meet Translate — frontend

Next.js UI for the [backend](../backend). A video call where Hindi, Telugu,
Tamil and Kannada speakers are heard in English, as live captions and a
translated voice: the first English words on screen in about 0.5-0.7s
after they stop talking, the voice playing in about 1.3-1.5s.

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

## The meeting screen

- **Header:** meeting name, copy-invite-link, and the "I speak" language
  dropdown. A line under it explains what the current choice means
  (`languageHint()` at the bottom of the meeting page), e.g. "Nobody else is
  on English, so your Hindi is not being translated."
- **Video tiles** (`src/components/video-tile.tsx`): name and language on
  each. With no picture (still connecting, no camera, camera off) the tile
  shows the person's initial. The `<video>` element is hidden rather than
  removed, because it also plays that person's audio. Your own tile is
  mirrored and says "mic off" when muted.
- **Captions box:** English caption, with the speaker's words in English
  letters underneath. It auto-scrolls to the newest caption, but not while
  you've scrolled up to read an older one.
- **Footer:** Mute and Camera off (red while off), "Translated voice"
  (shown only to English listeners), Leave.

## How the translation pipeline works, from the browser's side

Speech-to-text needs a finished audio file per sentence, not a live stream,
so the browser can't just pipe raw microphone audio to the server. Instead:

1. **Silero VAD** (`@ricky0123/vad-web`, loaded from a CDN) checks every
   ~32ms of microphone audio for speech. While the translated voice is
   playing, the mic is treated as silent so it isn't picked up again.
2. `src/lib/segmenter.ts` watches those blocks and decides when a spoken
   phrase has ended (a 0.5s pause, or a run-on sentence past ~8 seconds),
   then hands back one WAV file. To save time it sends the audio early,
   after only 0.2s of pause, marked tentative, then confirms it if the
   pause reaches 0.5s or cancels it if the speaker carries on (the
   `phrase-confirm` / `phrase-cancel` socket messages).
3. That WAV is uploaded to the backend (`src/lib/api.ts`'s `sendUtterance`),
   which turns it into text, translates it, and broadcasts the result over
   the same Socket.IO connection as `caption` events -- the same caption
   (same `id`) several times as the English streams in, which the page
   updates in place, showing "..." until it's `final`. Underneath is the
   speaker's own words in English letters (`romanized`, e.g. "Hindi: aaj
   ki meeting mein kya hua").
4. English listeners then get the voice in pieces (`voice-chunk`, then
   `voice-end`). `src/lib/voice-player.ts` starts playing on the first
   piece, using MediaSource to play an MP3 that's still arriving, and
   plays sentences one after another. Browsers without MP3 MediaSource
   (older iPhones) play each sentence once all of it has arrived.

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

Open http://localhost:3000. You'll need the [backend](../backend) running
alongside this (with `MOCK=1` if you don't have Fish/DeepSeek API credit
yet).

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
