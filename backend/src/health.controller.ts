import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AsrService } from './asr/asr.service';
import { MOCK } from './mock-flag';

// GET /api/health -- a quick "is everything this app needs running?" check,
// for before a demo or a two-person test. Fish and DeepSeek aren't called
// here on purpose: every call to them costs credit.
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private asr: AsrService,
  ) {}

  @Get()
  async check() {
    const database = await this.prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    // In demo mode the speech-to-text service isn't used, so it doesn't matter.
    const speechToText = MOCK ? true : await this.asr.isUp();
    return { ok: database && speechToText, database, speechToText, mock: MOCK };
  }
}
