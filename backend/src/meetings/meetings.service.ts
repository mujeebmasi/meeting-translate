import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';

// Everything that touches the durable record of a meeting (who's ever
// joined, what was said) goes through here, backed by Postgres via Prisma.
// Who is connected *right now* is a separate concern -- see PresenceService.
@Injectable()
export class MeetingsService {
  constructor(private prisma: PrismaService) {}

  create(title: string) {
    // The short code is what goes in the invite link; separate from the
    // database id so the link isn't just a guessable incrementing number.
    const code = randomBytes(5).toString('hex');
    return this.prisma.meeting.create({
      data: { code, title: title.trim().slice(0, 80) || 'Untitled meeting' },
    });
  }

  async findByCode(code: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  addParticipant(meetingId: number, name: string, lang: string) {
    return this.prisma.participant.create({ data: { meetingId, name, lang } });
  }

  markLeft(participantId: number) {
    return this.prisma.participant.update({
      where: { id: participantId },
      data: { leftAt: new Date() },
    });
  }

  saveUtterance(
    meetingId: number,
    speakerId: number,
    lang: string,
    originalText: string,
    translations: Record<string, string>,
  ) {
    return this.prisma.utterance.create({
      data: { meetingId, speakerId, lang, originalText, translations },
    });
  }
}
