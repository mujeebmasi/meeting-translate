// A "sentence" that's really a laugh, a breath or a cough: the recognizer
// sometimes returns a single syllable for it (a real call got "घ", which
// became a caption "Gha"). Fewer than 2 letters (counting vowel signs, so
// "हा" -- "yes" -- still counts as speech) is treated as noise.
export function isJustNoise(text: string): boolean {
  const letters = text.match(/[\p{L}\p{M}]/gu) ?? [];
  return letters.length < 2;
}
