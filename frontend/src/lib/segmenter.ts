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
const MAX_PHRASE_MS = 4000; // cut long speech anyway so captions keep coming
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

export type OnPhrase = (wavBlob: Blob, endedAtMs: number) => void;

export class Segmenter {
  private sampleRate: number;
  private onPhrase: OnPhrase;
  // Exposed (not truly private) so tests can check state resets correctly
  // between phrases, the same way the old plain-JS version did.
  speaking = false;
  blocks: Float32Array[] = [];
  private totalMs = 0;
  private speechMs = 0;
  private silenceMs = 0;

  constructor(sampleRate: number, onPhrase: OnPhrase) {
    this.sampleRate = sampleRate;
    this.onPhrase = onPhrase;
  }

  private reset(): void {
    this.speaking = false;
    this.blocks = [];
    this.totalMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
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
    } else {
      this.silenceMs += ms;
    }

    if (this.silenceMs >= END_SILENCE_MS || this.totalMs >= MAX_PHRASE_MS) this.finish();
  }

  private finish(): void {
    if (this.speechMs >= MIN_SPEECH_MS) {
      const all = new Float32Array(this.blocks.reduce((n, b) => n + b.length, 0));
      let offset = 0;
      for (const b of this.blocks) {
        all.set(b, offset);
        offset += b.length;
      }
      this.onPhrase(encodeWav(all, this.sampleRate), Date.now());
    }
    this.reset();
  }
}
