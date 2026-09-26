import { NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import type { PrismaService } from '../prisma.service';

// A fake PrismaService: just enough of the shape MeetingsService actually
// calls, as jest.fn() stubs -- no real database needed to test this class's
// own logic (defaulting a title, generating a code, throwing when a meeting
// isn't found).
function fakePrisma() {
  return {
    meeting: { create: jest.fn(), findUnique: jest.fn() },
    participant: { create: jest.fn(), update: jest.fn() },
    utterance: { create: jest.fn() },
  } as unknown as PrismaService & {
    meeting: { create: jest.Mock; findUnique: jest.Mock };
    participant: { create: jest.Mock; update: jest.Mock };
    utterance: { create: jest.Mock };
  };
}

describe('MeetingsService', () => {
  it('create() generates a short code and passes the title through', () => {
    const prisma = fakePrisma();
    const service = new MeetingsService(prisma);
    service.create('Standup');
    expect(prisma.meeting.create).toHaveBeenCalledWith({
      data: { code: expect.stringMatching(/^[0-9a-f]{10}$/), title: 'Standup' },
    });
  });

  it('create() falls back to a default title when none is given', () => {
    const prisma = fakePrisma();
    const service = new MeetingsService(prisma);
    service.create('   ');
    expect(prisma.meeting.create).toHaveBeenCalledWith({
      data: { code: expect.any(String), title: 'Untitled meeting' },
    });
  });

  it('findByCode() returns the meeting Prisma found', async () => {
    const prisma = fakePrisma();
    const meeting = { id: 1, code: 'abc123', title: 'Standup' };
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    const service = new MeetingsService(prisma);
    await expect(service.findByCode('abc123')).resolves.toBe(meeting);
    expect(prisma.meeting.findUnique).toHaveBeenCalledWith({
      where: { code: 'abc123' },
    });
  });

  it('findByCode() throws NotFoundException for an unknown code', async () => {
    const prisma = fakePrisma();
    prisma.meeting.findUnique.mockResolvedValue(null);
    const service = new MeetingsService(prisma);
    await expect(service.findByCode('nope')).rejects.toThrow(NotFoundException);
  });

  it('addParticipant() creates a Participant row under the meeting', () => {
    const prisma = fakePrisma();
    const service = new MeetingsService(prisma);
    service.addParticipant(1, 'Alice', 'en');
    expect(prisma.participant.create).toHaveBeenCalledWith({
      data: { meetingId: 1, name: 'Alice', lang: 'en' },
    });
  });

  it('markLeft() stamps leftAt on the participant', () => {
    const prisma = fakePrisma();
    const service = new MeetingsService(prisma);
    service.markLeft(42);
    expect(prisma.participant.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { leftAt: expect.any(Date) },
    });
  });

  it('saveUtterance() records the phrase and its translations', () => {
    const prisma = fakePrisma();
    const service = new MeetingsService(prisma);
    service.saveUtterance(1, 2, 'en', 'hello', { hi: 'namaste' });
    expect(prisma.utterance.create).toHaveBeenCalledWith({
      data: {
        meetingId: 1,
        speakerId: 2,
        lang: 'en',
        originalText: 'hello',
        translations: { hi: 'namaste' },
      },
    });
  });
});
