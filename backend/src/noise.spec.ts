import { isJustNoise } from './noise';

describe('isJustNoise', () => {
  it('treats a single syllable as noise', () => {
    expect(isJustNoise('घ')).toBe(true);
    expect(isJustNoise(' . ')).toBe(true);
  });

  it('keeps short real words', () => {
    expect(isJustNoise('हा')).toBe(false); // "yes"
    expect(isJustNoise('ओके')).toBe(false);
    expect(isJustNoise('Hi')).toBe(false);
  });
});
