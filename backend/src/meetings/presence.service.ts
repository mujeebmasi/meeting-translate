import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';

export interface LivePeer {
  socketId: string;
  participantId: number;
  name: string;
  lang: string;
  socket: Socket;
}

// What other people in the meeting are allowed to know about a peer
// (no socket).
export interface PublicPeer {
  socketId: string;
  participantId: number;
  name: string;
  lang: string;
}

// Tracks who is *currently connected* to each meeting, in memory. This is
// separate from the Participant rows in Postgres: the database remembers
// who has ever joined (for history/transcripts), this remembers who is on
// the call right now, so WebRTC signalling messages can be routed to the
// right socket. There's no way to keep this in the database -- there's no
// row for "an open socket connection".
@Injectable()
export class PresenceService {
  private rooms = new Map<string, Map<string, LivePeer>>();

  add(meetingCode: string, peer: LivePeer): void {
    if (!this.rooms.has(meetingCode)) this.rooms.set(meetingCode, new Map());
    this.rooms.get(meetingCode)!.set(peer.socketId, peer);
  }

  remove(meetingCode: string, socketId: string): void {
    const room = this.rooms.get(meetingCode);
    room?.delete(socketId);
    // Forget a meeting once its last person leaves, so a server that runs
    // for weeks doesn't keep an empty entry for every meeting ever held.
    if (room?.size === 0) this.rooms.delete(meetingCode);
  }

  get(meetingCode: string, socketId: string): LivePeer | undefined {
    return this.rooms.get(meetingCode)?.get(socketId);
  }

  list(meetingCode: string): LivePeer[] {
    return [...(this.rooms.get(meetingCode)?.values() ?? [])];
  }

  setLang(meetingCode: string, socketId: string, lang: string): void {
    const peer = this.get(meetingCode, socketId);
    if (peer) peer.lang = lang;
  }

  // Every language currently spoken/read by someone in the meeting.
  languagesInUse(meetingCode: string): Set<string> {
    return new Set(this.list(meetingCode).map((p) => p.lang));
  }

  toPublic(peer: LivePeer): PublicPeer {
    return {
      socketId: peer.socketId,
      participantId: peer.participantId,
      name: peer.name,
      lang: peer.lang,
    };
  }
}
