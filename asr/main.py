"""Local speech-to-text for Hindi, Telugu, Tamil and Kannada.

    uv run uvicorn main:app --port 5001

The NestJS backend POSTs one spoken phrase (a WAV file) to /transcribe and
gets the words back. This is its own small Python service only because the
model (AI4Bharat IndicConformer) ships as Python code -- there's no way to
run it from Node.

Why not Fish Audio's speech-to-text, which the app used before: tested on the
same short sentence in each language, Fish got Hindi right but returned
Malay-sounding gibberish for Telugu, Tamil and Kannada, and took 4-6 seconds
per clip. IndicConformer is trained specifically on Indian languages and
runs on this machine, so there's no network round trip either.
"""

import io
import os
import time
import wave

import numpy as np
import torch
import torchaudio
from fastapi import FastAPI, HTTPException, Query, Request
from transformers import AutoModel

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models", "indic-conformer")
LANGUAGES = {"hi", "te", "ta", "kn"}
SAMPLE_RATE = 16000  # what the model was trained on

# Loaded once at startup (takes a few seconds), then reused for every request.
model = AutoModel.from_pretrained(MODEL_DIR, trust_remote_code=True)

app = FastAPI()


def wav_to_tensor(data: bytes) -> torch.Tensor:
    """Turn a 16-bit PCM WAV file into the (1, samples) float tensor at 16 kHz
    that the model expects, averaging stereo down to mono."""
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2:
            raise HTTPException(400, "Expected 16-bit PCM WAV")
        rate, channels = w.getframerate(), w.getnchannels()
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)

    audio = torch.from_numpy(samples.astype(np.float32) / 32768.0)
    audio = audio.reshape(-1, channels).mean(dim=1).unsqueeze(0)
    if rate != SAMPLE_RATE:
        audio = torchaudio.functional.resample(audio, rate, SAMPLE_RATE)
    return audio


@app.post("/transcribe")
async def transcribe(request: Request, lang: str = Query(...)):
    if lang not in LANGUAGES:
        raise HTTPException(400, f"lang must be one of {sorted(LANGUAGES)}")
    audio = wav_to_tensor(await request.body())

    started = time.perf_counter()
    text = model(audio, lang, "rnnt")
    ms = round((time.perf_counter() - started) * 1000)
    return {"text": text.strip(), "ms": ms}
