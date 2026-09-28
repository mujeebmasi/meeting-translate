import { needsTranslation } from './languages';

describe('needsTranslation', () => {
  it('translates a Hindi or Telugu speaker when someone listens in English', () => {
    expect(needsTranslation('hi', new Set(['hi', 'en']))).toBe(true);
    expect(needsTranslation('te', new Set(['te', 'en']))).toBe(true);
  });

  it('never translates an English speaker into Hindi/Telugu', () => {
    expect(needsTranslation('en', new Set(['en', 'hi', 'te']))).toBe(false);
  });

  it('skips translating when nobody is listening in English', () => {
    expect(needsTranslation('hi', new Set(['hi', 'te']))).toBe(false);
  });
});
