import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
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
import { UsageService } from '../usage.service';
import { TARGET_LANG, needsTranslation } from '../languages';

const CONTEXT_LINES = 3;
const MAX_MEETINGS_REMEMBERED = 500;

@Controller('meetings')
export class MeetingsController {
  private readonly logger = new Logger(MeetingsController.name);

  // The last few sentences of each meeting, as "Name: English", handed to
  // the translator as background (see systemPrompt in translate.service).
  // Kept in memory only; the oldest meetings are dropped past a limit.
  private recent = new Map<string, string[]>();
  private remember(code: string, line: string): void {
    const lines = [...(this.recent.get(code) ?? []), line].slice(
      -CONTEXT_LINES,
    );
    this.recent.delete(code); // re-insert so this meeting counts as newest
    this.recent.set(code, lines);
    if (this.recent.size > MAX_MEETINGS_REMEMBERED) {
      const [oldest] = this.recent.keys(); // a Map keeps insertion order
      if (oldest !== undefined) this.recent.delete(oldest);
    }
  }

  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
    private phrases: PhraseGate,
    private gateway: MeetingsGateway,
    private fish: FishService,
    private asr: AsrService,
    private translate: TranslateService,
    private mock: MockService,
    private usage: UsageService,
  ) {}

  // Needs the access code (header x-access-code) when the server has one,
  // so strangers with the site's address can't open meetings on it.
  @Post()
  async create(
    @Body() dto: CreateMeetingDto,
    @Headers('x-access-code') accessCode?: string,
  ) {
    this.usage.checkAccessCode(accessCode);
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
    if (this.usage.meetingFull(code))
      throw new HttpException(
        'This meeting has reached its limit of sentences. Start a new meeting to continue.',
        HttpStatus.TOO_MANY_REQUESTS,
      );

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

      // Safety net for the speaker's real voice: once the sentence is
      // confirmed, pass the recording itself on too, for anyone whose live
      // connection to the speaker is blocked (see sendOriginalVoice). Sent
      // as soon as it's known to be speech, without waiting for translation.
      void this.phrases.decided(phraseId).then((ok) => {
        if (ok)
          this.gateway.sendOriginalVoice(code, speaker, {
            id: phraseId,
            from: speaker.socketId,
            audio: body.toString('base64'),
          });
      });

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
              this.recent.get(code),
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
    this.usage.countSentence(code);
    const translated = caption.translations[TARGET_LANG];
    this.remember(code, `${speaker.name}: ${translated || caption.original}`);
    this.logger.log(
      `[${code}] ${speaker.name}: "${caption.original}" (` +
        (firstWordsMs ? `first words ${firstWordsMs}ms, ` : '') +
        `done ${caption.serverMs}ms)`,
    );

    // The spoken translation, pushed straight to the listeners who need it.
    // takeVoice() is the daily cap on paid voice generation; past it the
    // caption still arrives, just without the spoken version.
    if (translated && !MOCK && this.usage.takeVoice())
      void this.streamVoice(
        code,
        caption.id,
        speaker.socketId,
        translated,
        startedAt,
      );

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

  // Fish sends the audio in pieces as it generates it: the first after
  // ~0.35s, the last after ~1.1s. Each piece goes to the English listeners
  // straight away (their browser starts playing on the first one), instead
  // of waiting for the whole file. "voice-end" always follows -- even after
  // a failure -- so a listener's player never waits for audio that won't come.
  private async streamVoice(
    code: string,
    id: string,
    from: string,
    text: string,
    startedAt: number,
  ): Promise<void> {
    let firstMs = 0;
    try {
      const res = await this.fish.speak(text);
      if (!res.body) throw new Error('Fish sent no audio');
      for await (const piece of res.body) {
        if (!firstMs) firstMs = Date.now() - startedAt;
        this.gateway.sendVoice(code, TARGET_LANG, 'voice-chunk', {
          id,
          from,
          audio: Buffer.from(piece).toString('base64'),
        });
      }
      // Same clock as the caption times, so they can be compared.
      this.logger.log(
        `[${code}] voice: first audio ${firstMs}ms, all audio ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(
        `Voice failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.gateway.sendVoice(code, TARGET_LANG, 'voice-end', { id, from });
    }
  }
}
