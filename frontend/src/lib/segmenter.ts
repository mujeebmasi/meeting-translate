// Cuts a continuous microphone stream into spoken phrases.
//
// Why: speech-to-text works on a finished audio clip, so we wait for the
// speaker to pause and send what they just said. The pause length is the
// main lever on delay: shorter = quicker captions but choppier sentences.
//
// Whether each block *is* speech is decided by the caller (the Silero voice
// detector, see the meeting page) -- this file only decides where a phrase
// starts and ends. It used to decide "speech" by loudness alone, which let
// keyboard clicks, background noise and the translated voice playing on the
// speakers through as "speech", and each of those became a garbled caption.

const END_SILENCE_MS = 500; // this much quiet ends a phrase
// ...but the audio is already sent after this much, marked "tentative", so
// the server can start on it while we wait to see whether the pause lasts.
// If they speak again before END_SILENCE_MS it's cancelled, so where
// sentences end -- and so translation quality -- is exactly as before. This
// alone gets captions out ~0.3s sooner. (Server side: PhraseGate.)
const EARLY_SEND_MS = 200;
// Long speech without a proper pause is still cut, so captions keep coming.
// After MAX_PHRASE_MS the phrase ends at the next brief gap between words
// (any non-speech block), not instantly -- an instant cut split a word in
// half, and the leftover half-word became a nonsense caption. HARD_MAX is
// the backstop for someone who never leaves a gap at all.
// Was 4s, which cut ordinary 4-5s sentences in two: the second half was
// translated without the first half's context ("today's meeting... big?").
// Delay is counted from when the speaker stops, so a longer limit costs
// nothing for normal sentences; it only holds back captions in a monologue.
const MAX_PHRASE_MS = 8000;
const HARD_MAX_PHRASE_MS = 10000;
const MIN_SPEECH_MS = 400; // ignore coughs and "hmm"s shorter than this
const PRE_ROLL_MS = 300; // keep a little audio from before speech began

// 16-bit mono WAV: a 44-byte header followed by the raw samples.
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, str: string) =>
    [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of this header section
  view.setUint16(20, 1, true); // 1 = plain PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  samples.forEach((s, i) => {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clamped * 0x7fff, true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface PhraseHandlers {
  // A phrase's audio. `tentative` = sent early, still waiting on
  // confirm/cancel; `endedAtMs` = when the speech in it stopped.
  onPhrase: (wavBlob: Blob, id: string, tentative: boolean, endedAtMs: number) => void;
  onConfirm: (id: string) => void; // the pause lasted: a real sentence end
  onCancel: (id: string) => void; // they kept talking: drop the early send
}

export class Segmenter {
  private sampleRate: number;
  private handlers: PhraseHandlers;
  // Exposed (not truly private) so tests can check state resets correctly
  // between phrases, the same way the old plain-JS version did.
  speaking = false;
  blocks: Float32Array[] = [];
  private totalMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private earlyId: string | null = null; // the tentative send awaiting a decision

  constructor(sampleRate: number, handlers: PhraseHandlers) {
    this.sampleRate = sampleRate;
    this.handlers = handlers;
  }

  private reset(): void {
    this.speaking = false;
    this.blocks = [];
    this.totalMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.earlyId = null;
  }

  push(block: Float32Array, isVoice: boolean): void {
    const ms = (block.length / this.sampleRate) * 1000;

    if (!this.speaking) {
      // Not in a phrase yet: just remember the last few hundred ms of audio,
      // so the first syllable is not clipped when speech starts.
      this.blocks.push(block);
      this.totalMs += ms;
      while (this.totalMs > PRE_ROLL_MS) {
        this.totalMs -= (this.blocks.shift()!.length / this.sampleRate) * 1000;
      }
      if (isVoice) {
        this.speaking = true;
        this.speechMs = ms;
        this.silenceMs = 0;
      }
      return;
    }

    this.blocks.push(block);
    this.totalMs += ms;
    if (isVoice) {
      this.speechMs += ms;
      this.silenceMs = 0;
      // Speaking again: the early send was mid-sentence after all.
      if (this.earlyId) {
        this.handlers.onCancel(this.earlyId);
        this.earlyId = null;
      }
    } else {
      this.silenceMs += ms;
      if (this.silenceMs >= EARLY_SEND_MS && !this.earlyId && this.speechMs >= MIN_SPEECH_MS) {
        this.earlyId = crypto.randomUUID();
        this.handlers.onPhrase(this.wav(), this.earlyId, true, Date.now() - this.silenceMs);
      }
    }

    const pausedLongEnough = this.silenceMs >= END_SILENCE_MS;
    const longAndBetweenWords = this.totalMs >= MAX_PHRASE_MS && !isVoice;
    if (pausedLongEnough || longAndBetweenWords || this.totalMs >= HARD_MAX_PHRASE_MS) this.finish();
  }

  private wav(): Blob {
    const all = new Float32Array(this.blocks.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    for (const b of this.blocks) {
      all.set(b, offset);
      offset += b.length;
    }
    return encodeWav(all, this.sampleRate);
  }

  private finish(): void {
    if (this.earlyId) {
      // Already sent early, and nothing was said since: just confirm it.
      this.handlers.onConfirm(this.earlyId);
    } else if (this.speechMs >= MIN_SPEECH_MS) {
      this.handlers.onPhrase(this.wav(), crypto.randomUUID(), false, Date.now() - this.silenceMs);
    }
    this.reset();
  }
}
