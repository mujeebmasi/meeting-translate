// Exercises TranslateService against a fake local DeepSeek server (via
// DEEPSEEK_BASE_URL), so we can check the request/response wiring without
// spending real API credit.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { TranslateService } from './translate.service';

async function withFakeClaude(
  handler: http.RequestListener,
  run: () => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const prevBase = process.env.DEEPSEEK_BASE_URL;
  const prevKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  try {
    await run();
  } finally {
    process.env.DEEPSEEK_BASE_URL = prevBase;
    process.env.DEEPSEEK_API_KEY = prevKey;
    await new Promise((resolve) => server.close(resolve));
  }
}

// A minimal, realistically-shaped success response from the Messages API.
function claudeReply(text: string): string {
  return JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(JSON.parse(raw)));
  });
}

describe('TranslateService', () => {
  it('sends the text and language names, and returns the reply', async () => {
    const translate = new TranslateService();
    let received: {
      method?: string;
      url?: string;
      apiKey?: string;
      body?: Record<string, unknown>;
    } = {};
    await withFakeClaude(
      async (req, res) => {
        received = {
          method: req.method,
          url: req.url,
          apiKey: req.headers['x-api-key'] as string,
          body: await readBody(req),
        };
        res.setHeader('Content-Type', 'application/json');
        res.end(claudeReply('Namaste, kya sab log sun sakte hain?'));
      },
      async () => {
        const result = await translate.translate(
          'Hi, can everyone hear me?',
          'en',
          'hi',
        );
        expect(result).toBe('Namaste, kya sab log sun sakte hain?');
        expect(received.method).toBe('POST');
        expect(received.url).toBe('/v1/messages');
        expect(received.apiKey).toBe('test-key');
        expect(received.body?.system).toEqual(
          expect.stringContaining('English'),
        );
        expect(received.body?.system).toEqual(expect.stringContaining('Hindi'));
        expect(received.body?.messages).toEqual([
          { role: 'user', content: 'Hi, can everyone hear me?' },
        ]);
      },
    );
  });

  it('trims stray whitespace off the reply', async () => {
    const translate = new TranslateService();
    await withFakeClaude(
      (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(claudeReply('  Andaru bagunnara  \n'));
      },
      async () => {
        const result = await translate.translate('Hello everyone', 'en', 'te');
        expect(result).toBe('Andaru bagunnara');
      },
    );
  });

  it('surfaces an API error instead of swallowing it', async () => {
    const translate = new TranslateService();
    await withFakeClaude(
      (req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'credit balance is too low',
            },
          }),
        );
      },
      async () => {
        await expect(translate.translate('Hi', 'en', 'hi')).rejects.toThrow(
          /credit balance is too low/,
        );
      },
    );
  });
});
