import { PresenceService, type LivePeer } from './presence.service';
import type { Socket } from 'socket.io';

// PresenceService never calls anything on the socket itself, just stores it,
// so a fake object is enough -- no real connection needed.
function fakePeer(overrides: Partial<LivePeer>): LivePeer {
  return {
    socketId: 'sock-1',
    participantId: 1,
    name: 'Alice',
    lang: 'en',
    socket: {} as Socket,
    ...overrides,
  };
}

describe('PresenceService', () => {
  it('adds a peer and finds it by meeting code + socket id', () => {
    const presence = new PresenceService();
    const peer = fakePeer({});
    presence.add('room1', peer);
    expect(presence.get('room1', 'sock-1')).toBe(peer);
    expect(presence.list('room1')).toEqual([peer]);
  });

  it('keeps different meetings separate', () => {
    const presence = new PresenceService();
    presence.add('room1', fakePeer({ socketId: 'a' }));
    presence.add('room2', fakePeer({ socketId: 'b' }));
    expect(presence.list('room1').map((p) => p.socketId)).toEqual(['a']);
    expect(presence.list('room2').map((p) => p.socketId)).toEqual(['b']);
  });

  it('remove() takes a peer out, and a lookup for an unknown room is just empty', () => {
    const presence = new PresenceService();
    presence.add('room1', fakePeer({ socketId: 'a' }));
    presence.remove('room1', 'a');
    expect(presence.list('room1')).toEqual([]);
    expect(presence.list('no-such-room')).toEqual([]);
  });

  it('setLang() updates the peer in place', () => {
    const presence = new PresenceService();
    presence.add('room1', fakePeer({ socketId: 'a', lang: 'en' }));
    presence.setLang('room1', 'a', 'hi');
    expect(presence.get('room1', 'a')?.lang).toBe('hi');
  });

  it('setLang() on someone not in the room does nothing (no throw)', () => {
    const presence = new PresenceService();
    expect(() => presence.setLang('room1', 'ghost', 'hi')).not.toThrow();
  });

  it('languagesInUse() is the set of distinct languages currently in the room', () => {
    const presence = new PresenceService();
    presence.add('room1', fakePeer({ socketId: 'a', lang: 'en' }));
    presence.add('room1', fakePeer({ socketId: 'b', lang: 'hi' }));
    presence.add('room1', fakePeer({ socketId: 'c', lang: 'en' })); // same language as 'a'
    expect(presence.languagesInUse('room1')).toEqual(new Set(['en', 'hi']));
  });

  it('toPublic() hides the socket, keeping only what others should see', () => {
    const presence = new PresenceService();
    const peer = fakePeer({
      socketId: 'a',
      participantId: 7,
      name: 'Alice',
      lang: 'en',
    });
    expect(presence.toPublic(peer)).toEqual({
      socketId: 'a',
      participantId: 7,
      name: 'Alice',
      lang: 'en',
    });
  });
});
