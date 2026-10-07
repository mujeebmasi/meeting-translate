import { UnauthorizedException } from '@nestjs/common';
import { UsageService } from './usage.service';

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const before = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.entries(vars).forEach(([k, v]) =>
    v === undefined ? delete process.env[k] : (process.env[k] = v),
  );
  try {
    run();
  } finally {
    Object.entries(before).forEach(([k, v]) =>
      v === undefined ? delete process.env[k] : (process.env[k] = v),
    );
  }
}

describe('UsageService', () => {
  it('needs no access code when none is set', () => {
    withEnv({ ACCESS_CODE: undefined }, () => {
      const usage = new UsageService();
      expect(usage.accessCodeRequired()).toBe(false);
      expect(() => usage.checkAccessCode(undefined)).not.toThrow();
    });
  });

  it('accepts the right access code and rejects a wrong or missing one', () => {
    withEnv({ ACCESS_CODE: 'demo-2026' }, () => {
      const usage = new UsageService();
      expect(usage.accessCodeRequired()).toBe(true);
      expect(() => usage.checkAccessCode('demo-2026')).not.toThrow();
      expect(() => usage.checkAccessCode('demo-2025')).toThrow(
        UnauthorizedException,
      );
      expect(() => usage.checkAccessCode(undefined)).toThrow(
        UnauthorizedException,
      );
    });
  });

  it('marks a meeting full after its sentence limit', () => {
    withEnv({ MAX_SENTENCES_PER_MEETING: '2' }, () => {
      const usage = new UsageService();
      usage.countSentence('m1');
      expect(usage.meetingFull('m1')).toBe(false);
      usage.countSentence('m1');
      expect(usage.meetingFull('m1')).toBe(true);
      expect(usage.meetingFull('m2')).toBe(false);
    });
  });

  it('stops handing out voices after the daily limit', () => {
    withEnv({ MAX_VOICES_PER_DAY: '2' }, () => {
      const usage = new UsageService();
      expect([usage.takeVoice(), usage.takeVoice(), usage.takeVoice()]).toEqual(
        [true, true, false],
      );
    });
  });
});
