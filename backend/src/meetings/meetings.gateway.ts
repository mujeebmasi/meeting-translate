import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { LANGUAGES } from '../languages';
import { MOCK } from '../mock-flag';
import { MeetingsService } from './meetings.service';
import { PresenceService } from './presence.service';

// Video and audio go straight between browsers (WebRTC). Before they can,
// the browsers must swap connection details, and this gateway is the
// go-between -- it passes "signal" messages along without reading them.
// Joining/leaving here also updates the durable Participant record in
// Postgres via MeetingsService, on top of the live, in-memory PresenceService.

// Video is peer-to-peer (every person connects to every other person), so it
// gets heavy past a handful of people.
const MAX_PEOPLE = 6;

interface JoinMessage {
  code: string;
  name: string;
  lang: string;
}

// socket.io types client.data as `any` (it's meant to hold whatever a given
// app wants), so every read of it needs a cast -- this is that cast's shape,
// written once instead of scattered as inline `as` everywhere it's read.
interface SocketData {
  code?: string;
  participantId?: number;
}
function socketData(client: Socket): SocketData {
  return client.data as SocketData;
}

@Injectable()
@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: (process.env.FRONTEND_URL ?? 'http://localhost:3000').split(','),
  },
})
export class MeetingsGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(MeetingsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
  ) {}

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinMessage,
  ): Promise<void> {
    const meeting = await this.meetings.findByCode(body.code).catch(() => null);
    if (!meeting) {
      client.disconnect(true);
      return;
    }

    const others = this.presence.list(body.code);
    if (others.length >= MAX_PEOPLE) {
      client.emit('full');
      client.disconnect(true);
      return;
    }

    const name =
      String(body.name || '')
        .trim()
        .slice(0, 40) || 'Guest';
    const lang = LANGUAGES[body.lang] ? body.lang : 'en';
    const participant = await this.meetings.addParticipant(
      meeting.id,
      name,
      lang,
    );

    void client.join(body.code); // socket.io "room" -- lets us broadcast with server.to(code)
    socketData(client).code = body.code;
    socketData(client).participantId = participant.id;

    const peer = {
      socketId: client.id,
      participantId: participant.id,
      name,
      lang,
      socket: client,
    };
    this.presence.add(body.code, peer);

    client.emit('welcome', {
      you: client.id,
      participantId: participant.id,
      title: meeting.title,
      peers: others.map((p) => this.presence.toPublic(p)),
      mock: MOCK,
    });
    client
      .to(body.code)
      .emit('peer-joined', { peer: this.presence.toPublic(peer) });
  }

  // `to` is the other browser's socket id (from the peer list in "welcome"
  // or a "peer-joined" message) -- socket.io lets us target one connection
  // directly by treating its id as a room of one.
  @SubscribeMessage('signal')
  handleSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { to: string; data: unknown },
  ): void {
    this.server
      .to(body.to)
      .emit('signal', { from: client.id, data: body.data });
  }

  @SubscribeMessage('set-lang')
  handleSetLang(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lang: string },
  ): void {
    const code = socketData(client).code;
    if (!code || !LANGUAGES[body.lang]) return;
    this.presence.setLang(code, client.id, body.lang);
    const peer = this.presence.get(code, client.id);
    if (peer)
      this.server
        .to(code)
        .emit('peer-updated', { peer: this.presence.toPublic(peer) });
  }

  handleDisconnect(client: Socket): void {
    const { code, participantId } = socketData(client);
    if (!code) return;
    this.presence.remove(code, client.id);
    if (participantId) {
      this.meetings.markLeft(participantId).catch((err: unknown) => {
        this.logger.warn(err instanceof Error ? err.message : String(err));
      });
    }
    client.to(code).emit('peer-left', { socketId: client.id });
  }

  // Called by MeetingsController once a phrase has been transcribed and
  // translated, so everyone in the room sees it as a caption.
  broadcastCaption(code: string, payload: unknown): void {
    this.server.to(code).emit('caption', payload);
  }
}
