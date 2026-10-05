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
import sys
import time
import wave

import numpy as np
import onnxruntime as ort
import torch
import torchaudio
from fastapi import FastAPI, HTTPException, Query, Request

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models", "indic-conformer")
LANGUAGES = {"hi", "te", "ta", "kn"}
SAMPLE_RATE = 16000  # what the model was trained on

# The model ships its own Python file (model_onnx.py) next to its weights.
# We import that class directly rather than going through transformers'
# AutoModel.from_pretrained: the model's from_pretrained always re-downloads
# from Hugging Face, even when you point it at a local folder.
sys.path.insert(0, MODEL_DIR)
from model_onnx import IndicASRConfig, IndicASRModel  # noqa: E402

# Loaded once at startup (takes a few seconds), then reused for every request.
model = IndicASRModel(IndicASRConfig(ts_folder=MODEL_DIR))


def tuned_session(name: str) -> ort.InferenceSession:
    """Reload one part of the model with settings that hold up on a busy
    laptop. By default ONNX Runtime uses every core and busy-waits between
    steps, which collapses when a browser, video call and Discord are also
    running. Measured on a 4.6s clip with 12 other threads maxing the CPU:
    default settings 672ms (jumping 483-737ms), these settings 343ms steady;
    on an idle machine it's 170ms vs 187ms, so almost nothing is lost."""
    options = ort.SessionOptions()
    options.intra_op_num_threads = 8
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    return ort.InferenceSession(
        os.path.join(MODEL_DIR, "assets", f"{name}.onnx"),
        options,
        providers=["CPUExecutionProvider"],
    )


# The two parts CTC decoding actually uses (see transcribe() below).
model.models["encoder"] = tuned_session("encoder")
model.models["ctc_decoder"] = tuned_session("ctc_decoder")

# The first run of each language is slow (~0.8-2s instead of ~0.2s): ONNX
# Runtime sets itself up on first use. Without this, the first sentence of
# every call paid that cost. One second of silence per language, at startup.
for _lang in sorted(LANGUAGES):
    model(torch.zeros(1, SAMPLE_RATE), _lang, "ctc")

app = FastAPI()


@app.get("/health")
def health():
    """Lets the backend's /api/health check this service is up. The model is
    loaded before the server starts, so answering at all means it's ready."""
    return {"ok": True}


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

    # "ctc" rather than "rnnt": on test sentences in all four languages it
    # was just as accurate and ~40% faster (~200ms vs ~300ms on CPU).
    started = time.perf_counter()
    text = model(audio, lang, "ctc")
    ms = round((time.perf_counter() - started) * 1000)
    return {"text": text.strip(), "ms": ms}
