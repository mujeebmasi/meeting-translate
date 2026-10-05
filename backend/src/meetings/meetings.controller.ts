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
import { randomUUID } from 'node:crypto';
import { MeetingsService } from './meetings.service';
import { PresenceService } from './presence.service';
import { PhraseGate } from './phrase-gate.service';
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
    private phrases: PhraseGate,
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
  // used an Indian language and someone is listening in English, and push
  // that to everyone as a caption -- word by word as the translation streams
  // in -- then send the spoken English version to the English listeners.
  //
  // `phraseId` + `tentative`: the browser sends audio early, after only a
  // short pause, before it's sure the sentence is over (see PhraseGate).
  // Work starts at once, but nothing is shown until the browser confirms.
  //
  // Note: express.raw() puts the WAV bytes straight into req.body as a
  // Buffer for this route -- see MeetingsModule.configure().
  @Post(':code/utterance')
  async utterance(
    @Param('code') code: string,
    @Query('participantId') participantIdRaw: string,
    @Query('phraseId') phraseIdRaw: string | undefined,
    @Query('tentative') tentative: string | undefined,
    @Req() req: Request,
  ) {
    const startedAt = Date.now();
    const participantId = Number(participantIdRaw);
    const speaker = this.presence
      .list(code)
      .find((p) => p.participantId === participantId);
    if (!speaker) throw new NotFoundException('Not in this meeting');

    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestException('Send a WAV file');

    // Scoped to the meeting so one meeting can't confirm another's phrases.
    const phraseId = `${code}:${phraseIdRaw || randomUUID()}`;
    if (tentative !== '1') this.phrases.confirm(phraseId);

    const caption = {
      id: phraseId,
      from: speaker.socketId,
      name: speaker.name,
      lang: speaker.lang,
      original: '',
      romanized: '', // the original in English letters, e.g. "aaj ki meeting"
      translations: {} as Record<string, string>,
      final: false, // false while the English is still streaming in
      serverMs: 0,
      mock: MOCK,
    };
    let firstWordsMs = 0;
    // Sends the caption as it stands right now -- but only once the phrase
    // is confirmed. Before that, the latest state is just kept, and goes out
    // the moment the confirm arrives.
    const publish = () => {
      if (!this.phrases.isConfirmed(phraseId)) return;
      caption.serverMs = Date.now() - startedAt;
      if (!firstWordsMs && caption.translations[TARGET_LANG])
        firstWordsMs = caption.serverMs;
      this.gateway.broadcastCaption(code, caption);
    };
    void this.phrases.decided(phraseId).then((ok) => {
      if (ok && caption.original) publish();
    });

    try {
      // Each language goes to the recognizer that's actually good at it:
      // Fish for English, the local IndicConformer service for Indian
      // languages (Fish returned gibberish for Telugu/Tamil/Kannada).
      if (MOCK) caption.original = await this.mock.transcribe();
      else if (speaker.lang === TARGET_LANG)
        caption.original = await this.fish.transcribe(body, speaker.lang);
      else caption.original = await this.asr.transcribe(body, speaker.lang);
      if (!caption.original || this.phrases.isCancelled(phraseId)) {
        this.phrases.forget(phraseId);
        return caption.original ? { cancelled: true } : { empty: true }; // empty = just noise
      }

      if (needsTranslation(speaker.lang, this.presence.languagesInUse(code))) {
        const onEnglish = (englishSoFar: string) => {
          caption.translations[TARGET_LANG] = englishSoFar;
          publish();
        };
        const signal = this.phrases.signal(phraseId);
        const result = MOCK
          ? await this.mock.translate(caption.original, onEnglish, signal)
          : await this.translate.translate(
              caption.original,
              speaker.lang,
              onEnglish,
              signal,
            );
        caption.translations[TARGET_LANG] = result.english;
        caption.romanized = result.romanized;
      }
    } catch (err) {
      if (this.phrases.isCancelled(phraseId)) {
        this.phrases.forget(phraseId); // stopped on purpose, not a failure
        return { cancelled: true };
      }
      this.phrases.forget(phraseId);
      // Fish/DeepSeek errors (bad key, no credit, rate limit) would otherwise
      // surface as an opaque 500 -- this puts the real reason in the response.
      throw new BadGatewayException(
        err instanceof Error ? err.message : String(err),
      );
    }

    // Finished early? Wait for the browser to say the sentence really ended.
    const confirmed = await this.phrases.decided(phraseId);
    if (!confirmed) {
      this.phrases.forget(phraseId);
      return { cancelled: true };
    }

    caption.final = true;
    publish();
    this.phrases.forget(phraseId); // only after the last publish, which checks it
    const translated = caption.translations[TARGET_LANG];
    this.logger.log(
      `[${code}] ${speaker.name}: "${caption.original}" (` +
        (firstWordsMs ? `first words ${firstWordsMs}ms, ` : '') +
        `done ${caption.serverMs}ms)`,
    );

    // The spoken translation, pushed straight to the listeners who need it
    // -- their browser plays it without having to ask for it.
    if (translated && !MOCK) {
      this.fish
        .speak(translated)
        .then((res) => res.arrayBuffer())
        .then((audio) => {
          this.gateway.sendVoice(code, TARGET_LANG, {
            from: speaker.socketId,
            audio: Buffer.from(audio).toString('base64'),
          });
          // Same clock as the caption times above, so they can be compared.
          this.logger.log(`[${code}] voice sent (${Date.now() - startedAt}ms)`);
        })
        .catch((err: unknown) =>
          this.logger.error(
            `Voice failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    // Saving the transcript doesn't need to hold anything up either.
    this.meetings
      .findByCode(code)
      .then((meeting) =>
        this.meetings.saveUtterance(
          meeting.id,
          participantId,
          speaker.lang,
          caption.original,
          caption.romanized,
          caption.translations,
        ),
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return { serverMs: caption.serverMs };
  }
}
