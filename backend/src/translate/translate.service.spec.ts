// Exercises TranslateService against a fake local DeepSeek server (via
// DEEPSEEK_BASE_URL), so we can check the request/response wiring without
// spending real API credit.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { TranslateService, parseTranslation } from './translate.service';

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
  it('sends the transcript and language, and returns english + romanized', async () => {
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
        res.end(
          claudeReply(
            '{"english": "What happened in today\'s meeting?", "romanized": "aaj ki meeting mein kya hua"}',
          ),
        );
      },
      async () => {
        const result = await translate.translate(
          'आज की मीटिंग में क्या हुआ',
          'hi',
        );
        expect(result).toEqual({
          english: "What happened in today's meeting?",
          romanized: 'aaj ki meeting mein kya hua',
        });
        expect(received.method).toBe('POST');
        expect(received.url).toBe('/v1/messages');
        expect(received.apiKey).toBe('test-key');
        expect(received.body?.system).toEqual(expect.stringContaining('Hindi'));
        expect(received.body?.messages).toEqual([
          { role: 'user', content: 'आज की मीटिंग में क्या हुआ' },
        ]);
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
        await expect(translate.translate('नमस्ते', 'hi')).rejects.toThrow(
          /credit balance is too low/,
        );
      },
    );
  });
});

describe('parseTranslation', () => {
  it('reads plain JSON and trims the fields', () => {
    expect(
      parseTranslation('{"english": " Hi ", "romanized": " em chestunna ra "}'),
    ).toEqual({ english: 'Hi', romanized: 'em chestunna ra' });
  });

  it('reads JSON wrapped in ```json fences', () => {
    expect(
      parseTranslation('```json\n{"english": "Hi", "romanized": "hai"}\n```'),
    ).toEqual({ english: 'Hi', romanized: 'hai' });
  });

  it('falls back to the whole reply as English if it is not JSON', () => {
    expect(parseTranslation('  Just some text ')).toEqual({
      english: 'Just some text',
      romanized: '',
    });
  });
});
