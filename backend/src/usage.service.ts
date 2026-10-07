import { Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

// Guards for a public deployment, so a link that gets around can't run up
// the paid services (Fish charges per sentence spoken):
// - ACCESS_CODE: needed to create a meeting. Joining needs only the meeting
//   link, whose code is random and unguessable. Unset = no code needed
//   (local development).
// - MAX_SENTENCES_PER_MEETING: after this many sentences a meeting stops
//   accepting more.
// - MAX_VOICES_PER_DAY: English voices generated per day across all
//   meetings; past it, captions keep working (they're free) but no voice.
// Counts live in memory, so a restart resets them -- fine for a demo server.
@Injectable()
export class UsageService {
  private sentences = new Map<string, number>(); // meeting code -> count
  private voiceDay = '';
  private voicesToday = 0;

  accessCodeRequired(): boolean {
    return !!process.env.ACCESS_CODE;
  }

  checkAccessCode(given: string | undefined): void {
    const expected = process.env.ACCESS_CODE;
    if (!expected) return;
    const a = Buffer.from(given ?? '');
    const b = Buffer.from(expected);
    // Constant-time comparison, so the code can't be guessed by timing.
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new UnauthorizedException('Wrong access code');
  }

  private limit(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  meetingFull(code: string): boolean {
    return (
      (this.sentences.get(code) ?? 0) >=
      this.limit('MAX_SENTENCES_PER_MEETING', 300)
    );
  }

  countSentence(code: string): void {
    this.sentences.set(code, (this.sentences.get(code) ?? 0) + 1);
  }

  // Takes one voice from today's allowance; false once it's used up.
  takeVoice(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.voiceDay) {
      this.voiceDay = today;
      this.voicesToday = 0;
    }
    if (this.voicesToday >= this.limit('MAX_VOICES_PER_DAY', 500)) return false;
    this.voicesToday += 1;
    return true;
  }
}
