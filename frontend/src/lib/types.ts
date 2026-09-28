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
  voices: Record<string, string>; // lang -> spoken translation, base64 mp3
  serverMs: number;
  mock: boolean;
}
