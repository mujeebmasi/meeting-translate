import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { raw } from 'express';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingsGateway } from './meetings.gateway';
import { PresenceService } from './presence.service';

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingsGateway, PresenceService],
})
export class MeetingsModule implements NestModule {
  // The utterance route receives a raw WAV file, not JSON, so it needs its
  // own body parser instead of the JSON one Nest sets up by default.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(raw({ type: 'audio/wav', limit: '5mb' })).forRoutes({
      path: 'meetings/:code/utterance',
      method: RequestMethod.POST,
    });
  }
}
