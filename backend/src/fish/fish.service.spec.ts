// Exercises FishService against a fake local Fish server (via FISH_BASE_URL),
// so we can check the request/response wiring without a real API key.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FishService } from './fish.service';

// Starts a throwaway server and points FISH_BASE_URL at it for the test body.
async function withFakeFish(
  handler: http.RequestListener,
  run: () => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const prevBase = process.env.FISH_BASE_URL;
  const prevKey = process.env.FISH_API_KEY;
  process.env.FISH_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.FISH_API_KEY = 'test-key';
  try {
    await run();
  } finally {
    process.env.FISH_BASE_URL = prevBase;
    process.env.FISH_API_KEY = prevKey;
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('FishService', () => {
  it('transcribe() sends the WAV as multipart and strips speaker markers', async () => {
    const fish = new FishService();
    let received: { method?: string; url?: string; auth?: string } = {};
    await withFakeFish(
      (req, res) => {
        received = {
          method: req.method,
          url: req.url,
          auth: req.headers.authorization,
        };
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({ text: '<|speaker:0|> hello there', duration: 1.2 }),
        );
      },
      async () => {
        const text = await fish.transcribe(Buffer.from('fake wav bytes'), 'en');
        expect(text).toBe('hello there');
        expect(received.method).toBe('POST');
        expect(received.url).toBe('/asr');
        expect(received.auth).toBe('Bearer test-key');
      },
    );
  });

  it('transcribe() surfaces the server error instead of swallowing it', async () => {
    const fish = new FishService();
    await withFakeFish(
      (req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Invalid Token' }));
      },
      async () => {
        await expect(fish.transcribe(Buffer.from('x'), 'en')).rejects.toThrow(
          /Fish speech-to-text failed \(401\)/,
        );
      },
    );
  });

  it('speak() posts JSON with the text and returns the audio stream', async () => {
    const fish = new FishService();
    let body = '';
    await withFakeFish(
      (req, res) => {
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          res.setHeader('Content-Type', 'audio/mpeg');
          res.end(Buffer.from('fake mp3 bytes'));
        });
      },
      async () => {
        const res = await fish.speak('hello');
        expect(JSON.parse(body).text).toBe('hello');
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.toString()).toBe('fake mp3 bytes');
      },
    );
  });
});
