import { iceServers } from './ice-servers';

describe('iceServers', () => {
  it('is just the public STUN server when no TURN relay is configured', () => {
    expect(iceServers({})).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('adds the TURN relay over UDP and TCP when it is configured', () => {
    const servers = iceServers({
      TURN_URL: 'turn:free.expressturn.com:3478',
      TURN_USERNAME: 'user',
      TURN_PASSWORD: 'pass',
    });
    expect(servers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:free.expressturn.com:3478',
        username: 'user',
        credential: 'pass',
      },
      {
        urls: 'turn:free.expressturn.com:3478?transport=tcp',
        username: 'user',
        credential: 'pass',
      },
    ]);
  });

  it('skips the relay if its login is missing', () => {
    expect(iceServers({ TURN_URL: 'turn:example.com:3478' })).toHaveLength(1);
  });
});
