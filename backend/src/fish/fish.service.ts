import { Injectable } from '@nestjs/common';

// Fish Audio: speech-to-text and text-to-speech.
@Injectable()
export class FishService {
  // Read per call, not into a field set once at construction -- so a test
  // can point this at a fake server (FISH_BASE_URL) after the service
  // already exists.
  private baseUrl(): string {
    return process.env.FISH_BASE_URL || 'https://api.fish.audio/v1';
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${process.env.FISH_API_KEY}` };
  }

  // Send one short WAV clip, get the words back. Fish's speech-to-text takes
  // a finished file (there is no live-stream mode), which is why the browser
  // cuts speech into phrases before sending (see the frontend's segmenter).
  async transcribe(wavBuffer: Buffer, lang: string): Promise<string> {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }),
      'speech.wav',
    );
    form.append('language', lang);
    form.append('ignore_timestamps', 'true'); // timestamps make it slower

    const res = await fetch(`${this.baseUrl()}/asr`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    if (!res.ok)
      throw new Error(
        `Fish speech-to-text failed (${res.status}): ${await res.text()}`,
      );

    const data = (await res.json()) as { text?: string };
    return cleanTranscript(data.text || '');
  }

  // Returns Fish's streaming response so the caller can pipe it to the browser.
  async speak(text: string): Promise<Response> {
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      'Content-Type': 'application/json',
    };
    if (process.env.FISH_TTS_MODEL) headers.model = process.env.FISH_TTS_MODEL;

    const body: Record<string, unknown> = {
      text,
      format: 'mp3',
      latency: 'low',
    };
    // Without this, Fish picks a different default voice on every call --
    // fine for a one-off, but jarring when every translated sentence in a
    // meeting sounds like a different person. Set in .env, not hardcoded
    // here, so a deployment can use its own preferred voice.
    if (process.env.FISH_VOICE_ID)
      body.reference_id = process.env.FISH_VOICE_ID;

    const res = await fetch(`${this.baseUrl()}/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(
        `Fish text-to-speech failed (${res.status}): ${await res.text()}`,
      );
    return res;
  }
}

// Tidies Fish's raw text before it becomes a caption:
// - Some models put markers like <|speaker:0|> in the text; we only want words.
// - On a cough or background noise Fish sometimes "hears" Chinese, e.g. "啊。"
//   (seen in a real two-person test). Nobody in these meetings speaks Chinese,
//   Japanese or Korean, so those characters are dropped.
// If nothing that looks like a word is left, it returns '' -- the controller
// already treats an empty transcript as noise and sends no caption.
export function cleanTranscript(raw: string): string {
  const text = raw
    .replace(/<\|[^|]*\|>/g, '')
    .replace(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}
