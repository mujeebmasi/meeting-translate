import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { MeetingsService } from './meetings.service';
import { PresenceService } from './presence.service';
import { MeetingsGateway } from './meetings.gateway';
import { FishService } from '../fish/fish.service';
import { TranslateService } from '../translate/translate.service';
import { MockService } from '../mock.service';
import { CreateMeetingDto, SpeakTtsDto } from './meetings.dto';
import { MOCK } from '../mock-flag';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
    private gateway: MeetingsGateway,
    private fish: FishService,
    private translate: TranslateService,
    private mock: MockService,
  ) {}

  @Post()
  async create(@Body() dto: CreateMeetingDto) {
    const meeting = await this.meetings.create(dto.title ?? '');
    return { code: meeting.code, title: meeting.title };
  }

  @Get(':code')
  async get(@Param('code') code: string) {
    const meeting = await this.meetings.findByCode(code);
    return {
      code: meeting.code,
      title: meeting.title,
      people: this.presence.list(code).length,
    };
  }

  // The browser sends one spoken phrase (a WAV file) whenever the speaker
  // pauses. We turn it into text, translate it into every language someone
  // in the room reads, save it, and push the result to everyone as a caption.
  // Note: express.raw() puts the WAV bytes straight into req.body as a
  // Buffer for this route -- see MeetingsModule.configure().
  @Post(':code/utterance')
  async utterance(
    @Param('code') code: string,
    @Query('participantId') participantIdRaw: string,
    @Req() req: Request,
  ) {
    const startedAt = Date.now();
    const meeting = await this.meetings.findByCode(code);
    const participantId = Number(participantIdRaw);
    const speaker = this.presence
      .list(code)
      .find((p) => p.participantId === participantId);
    if (!speaker) throw new NotFoundException('Not in this meeting');

    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestException('Send a WAV file');

    let original: string;
    const translations: Record<string, string> = {};
    // Translated speech, one per language, base64 mp3 -- generated here,
    // in parallel with translating, and sent *with* the caption. Earlier
    // this only happened after a listener's browser had already received
    // the caption and made its own separate request for the audio, which
    // stacked a full extra network round trip (plus another wait for Fish
    // to synthesize it) on top of the delay already spent transcribing and
    // translating. Doing it here removes that second wait entirely.
    const voices: Record<string, string> = {};
    try {
      original = MOCK
        ? await this.mock.transcribe()
        : await this.fish.transcribe(body, speaker.lang);
      if (!original) return { empty: true }; // background noise, no words

      // One translation (and its spoken version) per language other than
      // the speaker's own, all at once.
      const wanted = this.presence.languagesInUse(code);
      wanted.delete(speaker.lang);
      await Promise.all(
        [...wanted].map(async (lang) => {
          const text = MOCK
            ? await this.mock.translate(original, speaker.lang, lang)
            : await this.translate.translate(original, speaker.lang, lang);
          translations[lang] = text;

          if (MOCK) {
            await this.mock.speak();
          } else {
            const audioRes = await this.fish.speak(text);
            const audioBytes = Buffer.from(await audioRes.arrayBuffer());
            voices[lang] = audioBytes.toString('base64');
          }
        }),
      );
    } catch (err) {
      // Fish/Claude errors (bad key, no credit, rate limit) would otherwise
      // surface as an opaque 500 -- this puts the real reason in the response.
      throw new BadGatewayException(
        err instanceof Error ? err.message : String(err),
      );
    }

    await this.meetings.saveUtterance(
      meeting.id,
      participantId,
      speaker.lang,
      original,
      translations,
    );

    const serverMs = Date.now() - startedAt;
    this.gateway.broadcastCaption(code, {
      from: speaker.socketId,
      name: speaker.name,
      lang: speaker.lang,
      original,
      translations,
      voices,
      serverMs,
      mock: MOCK,
    });
    console.log(`[${code}] ${speaker.name}: "${original}" (${serverMs}ms)`);
    return { serverMs };
  }

  // Optional: read a translated caption aloud in a Fish Audio voice.
  @Post(':code/tts')
  async tts(
    @Param('code') code: string,
    @Query('participantId') participantIdRaw: string,
    @Body() dto: SpeakTtsDto,
    @Res() res: Response,
  ) {
    const participantId = Number(participantIdRaw);
    // Only people in the meeting may use this, because it spends Fish credit.
    const inMeeting = this.presence
      .list(code)
      .some((p) => p.participantId === participantId);
    if (!inMeeting) return res.sendStatus(404);

    if (MOCK) {
      await this.mock.speak();
      return res.sendStatus(204); // no real audio to send back
    }

    try {
      const fishRes = await this.fish.speak(dto.text);
      res.set('Content-Type', 'audio/mpeg');
      Readable.fromWeb(
        fishRes.body as import('node:stream/web').ReadableStream,
      ).pipe(res);
    } catch (err) {
      // @Res() means Nest's own exception filter won't format this for us.
      res
        .status(502)
        .json({ message: err instanceof Error ? err.message : String(err) });
    }
  }
}
