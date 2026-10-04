import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { MeetingsService } from './meetings.service';
import { PresenceService } from './presence.service';
import { MeetingsGateway } from './meetings.gateway';
import { FishService } from '../fish/fish.service';
import { AsrService } from '../asr/asr.service';
import { TranslateService } from '../translate/translate.service';
import { MockService } from '../mock.service';
import { CreateMeetingDto } from './meetings.dto';
import { MOCK } from '../mock-flag';
import { TARGET_LANG, needsTranslation } from '../languages';

@Controller('meetings')
export class MeetingsController {
  private readonly logger = new Logger(MeetingsController.name);

  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
    private gateway: MeetingsGateway,
    private fish: FishService,
    private asr: AsrService,
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
  // pauses. We turn it into text, translate it into English if the speaker
  // used an Indian language and someone is listening in English, push that to
  // everyone as a caption, then send the spoken English version to the
  // English listeners. Note: express.raw() puts the WAV bytes straight into
  // req.body as a Buffer for this route -- see MeetingsModule.configure().
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
    let romanized = ''; // the original in English letters, e.g. "aaj ki meeting"
    try {
      // Each language goes to the recognizer that's actually good at it:
      // Fish for English, the local IndicConformer service for Indian
      // languages (Fish returned gibberish for Telugu/Tamil/Kannada).
      if (MOCK) original = await this.mock.transcribe();
      else if (speaker.lang === TARGET_LANG)
        original = await this.fish.transcribe(body, speaker.lang);
      else original = await this.asr.transcribe(body, speaker.lang);
      if (!original) return { empty: true }; // background noise, no words

      if (needsTranslation(speaker.lang, this.presence.languagesInUse(code))) {
        const result = MOCK
          ? await this.mock.translate(original)
          : await this.translate.translate(original, speaker.lang);
        translations[TARGET_LANG] = result.english;
        romanized = result.romanized;
      }
    } catch (err) {
      // Fish/DeepSeek errors (bad key, no credit, rate limit) would otherwise
      // surface as an opaque 500 -- this puts the real reason in the response.
      throw new BadGatewayException(
        err instanceof Error ? err.message : String(err),
      );
    }

    // 1. The text goes out the moment it exists. It used to wait for the
    //    spoken version to be synthesized too, which made captions slower.
    const serverMs = Date.now() - startedAt;
    this.gateway.broadcastCaption(code, {
      from: speaker.socketId,
      name: speaker.name,
      lang: speaker.lang,
      original,
      romanized,
      translations,
      serverMs,
      mock: MOCK,
    });
    this.logger.log(`[${code}] ${speaker.name}: "${original}" (${serverMs}ms)`);

    // 2. Then the spoken translation, pushed straight to the listeners who
    //    need it -- their browser plays it without having to ask for it
    //    (which used to cost a whole extra round trip after the caption).
    const translated = translations[TARGET_LANG];
    if (translated && !MOCK) {
      this.fish
        .speak(translated)
        .then((res) => res.arrayBuffer())
        .then((audio) => {
          this.gateway.sendVoice(code, TARGET_LANG, {
            from: speaker.socketId,
            audio: Buffer.from(audio).toString('base64'),
          });
          // Same clock as serverMs above: from receiving the WAV to sending
          // the English voice, so the two numbers can be compared.
          this.logger.log(`[${code}] voice sent (${Date.now() - startedAt}ms)`);
        })
        .catch((err: unknown) =>
          this.logger.error(
            `Voice failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    // 3. Saving the transcript doesn't need to hold anything up either.
    this.meetings
      .saveUtterance(
        meeting.id,
        participantId,
        speaker.lang,
        original,
        romanized,
        translations,
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return { serverMs };
  }
}
