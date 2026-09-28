import { Injectable } from '@nestjs/common';

// Speech-to-text for Hindi, Telugu, Tamil and Kannada, done by the local
// Python service in ../asr (AI4Bharat IndicConformer). Fish Audio is still
// used for English -- it's accurate there -- but it returned gibberish for
// Telugu, Tamil and Kannada when tested, so those go here instead.
@Injectable()
export class AsrService {
  // Read per call (not stored once) so a test can point this at a fake
  // server after the service already exists, same as FishService.
  private baseUrl(): string {
    return process.env.ASR_URL || 'http://localhost:5001';
  }

  async transcribe(wavBuffer: Buffer, lang: string): Promise<string> {
    const res = await fetch(`${this.baseUrl()}/transcribe?lang=${lang}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array(wavBuffer),
    });
    if (!res.ok) {
      throw new Error(
        `Local speech-to-text failed (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { text?: string };
    return (data.text || '').trim();
  }
}
