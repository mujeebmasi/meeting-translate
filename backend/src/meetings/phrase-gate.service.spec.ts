import { PhraseGate } from './phrase-gate.service';

describe('PhraseGate', () => {
  it('a confirm resolves the wait with true', async () => {
    const gate = new PhraseGate();
    const decided = gate.decided('m:1');
    expect(gate.isConfirmed('m:1')).toBe(false);
    gate.confirm('m:1');
    await expect(decided).resolves.toBe(true);
    expect(gate.isConfirmed('m:1')).toBe(true);
  });

  it('a cancel resolves the wait with false and stops running work', async () => {
    const gate = new PhraseGate();
    const signal = gate.signal('m:1');
    const decided = gate.decided('m:1');
    gate.cancel('m:1');
    await expect(decided).resolves.toBe(false);
    expect(signal.aborted).toBe(true);
  });

  it('works when the confirm arrives before the audio does', async () => {
    const gate = new PhraseGate();
    gate.confirm('m:1'); // over the WebSocket, ahead of the HTTP upload
    await expect(gate.decided('m:1')).resolves.toBe(true);
  });

  it('a late cancel cannot undo a confirm', () => {
    const gate = new PhraseGate();
    gate.confirm('m:1');
    gate.cancel('m:1');
    expect(gate.isConfirmed('m:1')).toBe(true);
    expect(gate.signal('m:1').aborted).toBe(false);
  });

  it('keeps phrases from different meetings apart', () => {
    const gate = new PhraseGate();
    gate.confirm('meetingA:1');
    expect(gate.isConfirmed('meetingB:1')).toBe(false);
  });
});
