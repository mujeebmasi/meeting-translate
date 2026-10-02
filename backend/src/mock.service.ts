import { Injectable } from '@nestjs/common';
import type { Translation } from './translate/translate.service';

// Stand-in for FishService/TranslateService, used only when MOCK=1. Lets the
// whole app (video, joining, captions, timing) be tried without spending
// real Fish/Anthropic credit. FishService and TranslateService are never
// touched by this -- MeetingsService just calls this instead, when MOCK=1.
@Injectable()
export class MockService {
  // A few plausible sentences so captions don't look like an obvious static
  // stub when someone talks for a while.
  private static readonly SAMPLE_LINES = [
    'Hi, can everyone hear me okay?',
    'Let me share my screen for a second.',
    'I think that covers the first point.',
    'Sorry, go ahead, you were saying?',
    'That sounds good to me, let us move on.',
  ];
  private next = 0;

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Real speech-to-text takes a moment; fake that so the timing you see is
  // realistic rather than instant.
  async transcribe(): Promise<string> {
    await this.delay(250 + Math.random() * 250);
    const line =
      MockService.SAMPLE_LINES[this.next % MockService.SAMPLE_LINES.length];
    this.next += 1;
    return line;
  }

  async translate(text: string): Promise<Translation> {
    await this.delay(150 + Math.random() * 150);
    return {
      english: `[en demo] ${text}`,
      romanized: `[romanized demo] ${text}`,
    };
  }
}
