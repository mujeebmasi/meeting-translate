import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma.module';
import { FishModule } from './fish/fish.module';
import { AsrModule } from './asr/asr.module';
import { TranslateModule } from './translate/translate.module';
import { MeetingsModule } from './meetings/meetings.module';
import { MockModule } from './mock.module';
import { LanguagesController } from './languages.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Loads the .env file and makes process.env available everywhere.
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    FishModule,
    AsrModule,
    TranslateModule,
    MockModule,
    MeetingsModule,
  ],
  controllers: [LanguagesController, HealthController],
})
export class AppModule {}
