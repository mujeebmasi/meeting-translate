# Meet Translate

Video meetings where people speaking **Hindi, Telugu, Tamil or Kannada** are
heard in **English** by everyone else — as a live caption and a spoken
English voice, with the original speaker muted for English listeners.

## Measured

On a real Fish-voiced sentence per language, through the whole app (speech →
text → English → spoken English), on a laptop CPU:

| | Caption on screen | English voice heard |
|---|---|---|
| Hindi / Telugu / Tamil / Kannada | 1.3–1.6s | 2.3–2.7s |

Target was under 4s. Times are counted from when the speaker pauses.

## Three parts

| Folder | What | Stack |
|---|---|---|
| `frontend/` | The meeting page: video (WebRTC), voice detection, captions | Next.js, React, TypeScript, Tailwind |
| `backend/` | Signalling, the translation pipeline, saved transcripts | NestJS, Prisma, PostgreSQL, Socket.IO |
| `asr/` | Speech-to-text for the four Indian languages | Python, FastAPI, AI4Bharat IndicConformer |

`asr/` is Python only because the model ships as Python code. It runs locally
on the CPU (~0.2s per phrase), so it costs nothing per use.

### Which service does what, and why

| Step | Used | Why this one |
|---|---|---|
| Is the mic audio speech? | **Silero VAD** (in the browser) | A loudness check let clicks, noise and the translated voice through as "speech" |
| Speech → text (Indian languages) | **IndicConformer** (local) | Fish returned gibberish for Telugu/Tamil/Kannada and took 4–6s; this got them right in ~0.2s |
| Speech → text (English) | **Fish Audio** | Accurate for English |
| Text → English | **DeepSeek** (`deepseek-flash`, thinking off) | ~0.5–1s, free token grant on signup |
| English text → voice | **Fish Audio** | Consistent voice (`FISH_VOICE_ID`) |

## Running it

1. **Speech-to-text service** (first time: download the model, ~2.4 GB —
   needs a free Hugging Face token in `asr/.env` as `HF_TOKEN=...` and
   access accepted on the
   [model page](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual)):
   ```bash
   cd asr
   uv sync
   uv run python download_model.py
   uv run uvicorn main:app --port 5001
   ```
2. **Backend** — see `backend/README.md` for `.env` (Postgres, Fish, DeepSeek):
   ```bash
   cd backend
   npm install
   npx prisma migrate dev
   npm run start
   ```
3. **Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

Open http://localhost:3000, create a meeting, share the link.

**Testing two people on one laptop:** both browsers hear the same microphone,
so mute one of them and use headphones — otherwise each voice is picked up
twice and the translated voice gets re-captured.
