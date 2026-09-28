export type Languages = Record<string, string>; // code -> display name, e.g. { en: 'English' }

export interface Meeting {
  code: string;
  title: string;
  people?: number;
}

// A person currently on the call, as broadcast to everyone else -- no
// socket, that's only known on the server (see the backend's PresenceService).
export interface PublicPeer {
  socketId: string;
  participantId: number;
  name: string;
  lang: string;
}

// One translated caption, broadcast over the WebSocket after a phrase has
// been transcribed and translated.
export interface Caption {
  from: string; // speaker's socketId
  name: string;
  lang: string;
  original: string;
  translations: Record<string, string>; // lang -> translated text
  serverMs: number;
  mock: boolean;
}

// The spoken version of a translated caption, sent right after the caption
// itself and only to people listening in the translated language.
export interface Voice {
  from: string; // speaker's socketId
  audio: string; // base64 mp3
}

// Translation only ever goes into English (Hindi/Telugu -> English), same
// rule as the backend's needsTranslation().
export const TARGET_LANG = 'en';
