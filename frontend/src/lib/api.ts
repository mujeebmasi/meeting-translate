// One place for every call to the backend.

import type { Languages, Meeting } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    // fetch only throws when the request never reached the server.
    throw new ApiError('Cannot reach the API. Is the backend running?', 0);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('. ') : (data?.message ?? 'Something went wrong');
    throw new ApiError(message, response.status);
  }
  return data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export const api = {
  getLanguages: (): Promise<Languages> => request('/languages'),

  createMeeting: (title: string): Promise<Meeting> =>
    request('/meetings', { method: 'POST', body: JSON.stringify({ title }) }),

  getMeeting: (code: string): Promise<Meeting> => request(`/meetings/${code}`),

  // The mic-captured phrase is a WAV file, not JSON, so this bypasses
  // request() and posts the raw bytes with their own content type.
  // `tentative`: sent early, before the browser is sure the sentence ended
  // -- confirmed or cancelled later over the WebSocket (see segmenter.ts).
  sendUtterance: async (
    code: string,
    participantId: number,
    wavBlob: Blob,
    phraseId: string,
    tentative: boolean,
  ): Promise<{ serverMs?: number; empty?: boolean; cancelled?: boolean }> => {
    const query = `participantId=${participantId}&phraseId=${phraseId}&tentative=${tentative ? 1 : 0}`;
    const res = await fetch(`${API_URL}/meetings/${code}/utterance?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wavBlob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data?.message ?? 'Translation error', res.status);
    return data;
  },
};
