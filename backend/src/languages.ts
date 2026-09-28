// Languages people can pick. The code is what the speech-to-text model is
// told the speaker is using; the name is what we tell the translator.
//
// Deliberately just these (not every language the models could handle):
// speakers use Hindi, Telugu, Tamil or Kannada, listeners read/hear English.
// A longer list was tried first and caused real problems -- picking the
// wrong language by mistake produced garbled captions. Fewer, correct
// options beats more, easy-to-mispick ones.
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
  kn: 'Kannada',
};

// Translation only ever goes one way: into English.
export const TARGET_LANG = 'en';

// Translate a phrase only if it wasn't already English and someone in the
// room is actually listening in English. An English speaker is never
// translated into an Indian language -- that direction isn't part of this app, and
// skipping it saves a DeepSeek + Fish call per sentence.
export function needsTranslation(
  speakerLang: string,
  languagesInRoom: Set<string>,
): boolean {
  return speakerLang !== TARGET_LANG && languagesInRoom.has(TARGET_LANG);
}
