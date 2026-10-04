// Exercises AsrService against a fake local server (via ASR_URL), so we can
// check the request/response wiring without the real model running.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AsrService } from './asr.service';

async function withFakeAsr(
  handler: http.RequestListener,
  run: () => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const prev = process.env.ASR_URL;
  process.env.ASR_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run();
  } finally {
    process.env.ASR_URL = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('AsrService', () => {
  it('posts the WAV with the language and returns the trimmed text', async () => {
    const asr = new AsrService();
    let url = '';
    let bytes = 0;
    await withFakeAsr(
      (req, res) => {
        url = req.url ?? '';
        req.on('data', (chunk: Buffer) => (bytes += chunk.length));
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ text: '  మీరు ఎలా ఉన్నారు  ' }));
        });
      },
      async () => {
        const text = await asr.transcribe(Buffer.from('fake wav'), 'te');
        expect(text).toBe('మీరు ఎలా ఉన్నారు');
        expect(url).toBe('/transcribe?lang=te');
        expect(bytes).toBe(8);
      },
    );
  });

  it('surfaces the service error instead of swallowing it', async () => {
    const asr = new AsrService();
    await withFakeAsr(
      (req, res) => {
        res.writeHead(400);
        res.end('lang must be one of ...');
      },
      async () => {
        await expect(asr.transcribe(Buffer.from('x'), 'xx')).rejects.toThrow(
          /Local speech-to-text failed \(400\)/,
        );
      },
    );
  });

  it('says the service is not running when nothing answers', async () => {
    const asr = new AsrService();
    const prev = process.env.ASR_URL;
    process.env.ASR_URL = 'http://127.0.0.1:1'; // nothing listens on port 1
    try {
      await expect(asr.transcribe(Buffer.from('x'), 'hi')).rejects.toThrow(
        /not running at http:\/\/127\.0\.0\.1:1/,
      );
      await expect(asr.isUp()).resolves.toBe(false);
    } finally {
      process.env.ASR_URL = prev;
    }
  });
});
