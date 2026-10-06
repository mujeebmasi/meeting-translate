// The servers a browser uses to set up the live video/voice connection.
//
// STUN only tells each browser its own public address, so two browsers can
// try to connect directly. Between some networks that's blocked (it was,
// between two home Wi-Fis in a real call: no video, no real voice). A TURN
// server relays the media instead. It's sent to browsers in the "welcome"
// message, so only people who joined a meeting get the TURN login.
//
// TURN_URL is like "turn:free.expressturn.com:3478" (ExpressTURN's free
// tier: 1000 GB/month, no card). Both UDP and TCP are offered, because some
// networks block UDP entirely.
export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export function iceServers(env: NodeJS.ProcessEnv = process.env): IceServer[] {
  const servers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const url = env.TURN_URL;
  if (url && env.TURN_USERNAME && env.TURN_PASSWORD) {
    const login = {
      username: env.TURN_USERNAME,
      credential: env.TURN_PASSWORD,
    };
    servers.push({ urls: url, ...login });
    if (!url.includes('?'))
      servers.push({ urls: `${url}?transport=tcp`, ...login });
  }
  return servers;
}
