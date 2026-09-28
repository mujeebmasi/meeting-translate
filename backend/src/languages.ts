// Languages people can pick. The code is what Fish Audio's speech-to-text
// takes as a hint; the name is what we tell the translator.
//
// Deliberately just these three (not every language Fish/DeepSeek could
// handle): speakers use Hindi or Telugu, listeners read English. A longer
// list was tried first and caused real problems -- someone picking the
// wrong language by mistake made Fish's speech-to-text force-fit their
// English/Hindi speech into Chinese/Thai phonemes, producing garbled
// captions. Fewer, correct options beats more, easy-to-mispick ones.
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

// Translation only ever goes one way: into English.
export const TARGET_LANG = 'en';

// Translate a phrase only if it wasn't already English and someone in the
// room is actually listening in English. An English speaker is never
// translated into Hindi/Telugu -- that direction isn't part of this app, and
// skipping it saves a DeepSeek + Fish call per sentence.
export function needsTranslation(
  speakerLang: string,
  languagesInRoom: Set<string>,
): boolean {
  return speakerLang !== TARGET_LANG && languagesInRoom.has(TARGET_LANG);
}
