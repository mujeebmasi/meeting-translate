// Exercises TranslateService against a fake local DeepSeek server (via
// DEEPSEEK_BASE_URL), so we can check the request/response wiring without
// spending real API credit.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import {
  TranslateService,
  englishSoFar,
  parseTranslation,
  replyTokenLimit,
  tidyEnglish,
} from './translate.service';

async function withFakeClaude(
  handler: http.RequestListener,
  run: () => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const prevBase = process.env.DEEPSEEK_BASE_URL;
  const prevKey = process.env.DEEPSEEK_API_KEY;
  const prevGroq = process.env.GROQ_API_KEY;
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  delete process.env.GROQ_API_KEY; // these tests are about DeepSeek alone
  try {
    await run();
  } finally {
    process.env.DEEPSEEK_BASE_URL = prevBase;
    process.env.DEEPSEEK_API_KEY = prevKey;
    if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
    await new Promise((resolve) => server.close(resolve));
  }
}

// A minimal, realistically-shaped *streamed* reply from the Messages API
// (server-sent events), with the text split into the given pieces the way
// it really arrives a few characters at a time.
function streamedReply(pieces: string[]): string {
  const event = (type: string, data: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return (
    event('message_start', {
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-flash',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    }) +
    event('content_block_start', {
      index: 0,
      content_block: { type: 'text', text: '' },
    }) +
    pieces
      .map((text) =>
        event('content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text },
        }),
      )
      .join('') +
    event('content_block_stop', { index: 0 }) +
    event('message_delta', {
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    }) +
    event('message_stop', {})
  );
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(JSON.parse(raw)));
  });
}

describe('TranslateService', () => {
  it('sends the transcript and language, streams the English, and returns english + romanized', async () => {
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
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(
          streamedReply([
            '{"english": "What happened',
            ' in today\'s meeting?", ',
            '"romanized": "aaj ki meeting mein kya hua"}',
          ]),
        );
      },
      async () => {
        const seen: string[] = [];
        const result = await translate.translate(
          'आज की मीटिंग में क्या हुआ',
          'hi',
          (englishSoFar) => seen.push(englishSoFar),
        );
        // The caption got the English as it arrived, not just at the end.
        expect(seen).toEqual([
          'What happened',
          "What happened in today's meeting?",
        ]);
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

describe('englishSoFar', () => {
  it('is empty until the English has started', () => {
    expect(englishSoFar('{"eng')).toBe('');
    expect(englishSoFar('{"english": ')).toBe('');
  });

  it('reads the English while the JSON is still incomplete', () => {
    expect(englishSoFar('{"english": "How are yo')).toBe('How are yo');
  });

  it('stops at the end of the English and ignores what follows', () => {
    expect(englishSoFar('{"english": "Hi.", "romanized": "nam')).toBe('Hi.');
  });

  it('handles escaped quotes, and waits on an escape cut off mid-way', () => {
    expect(englishSoFar('{"english": "He said \\"yes\\"')).toBe(
      'He said "yes"',
    );
    expect(englishSoFar('{"english": "It\\')).toBe('It');
  });
});

// A fake Groq server alongside the fake DeepSeek one, to check Groq is used
// first and DeepSeek takes over when Groq fails.
async function withFakeGroq(
  handler: http.RequestListener,
  run: () => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const prevBase = process.env.GROQ_BASE_URL;
  const prevKey = process.env.GROQ_API_KEY;
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.GROQ_API_KEY = 'groq-test-key';
  try {
    await run();
  } finally {
    process.env.GROQ_BASE_URL = prevBase;
    if (prevKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevKey;
    await new Promise((resolve) => server.close(resolve));
  }
}

// Groq streams in the OpenAI format: "data: {json}" lines, then [DONE].
function groqStream(pieces: string[]): string {
  return (
    pieces
      .map(
        (content) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      )
      .join('') + 'data: [DONE]\n\n'
  );
}

describe('TranslateService with Groq', () => {
  it('uses Groq first, streaming the English', async () => {
    const translate = new TranslateService();
    let received: { auth?: string; body?: Record<string, unknown> } = {};
    let deepSeekCalled = false;
    await withFakeClaude(
      (req, res) => {
        deepSeekCalled = true;
        res.end();
      },
      () =>
        withFakeGroq(
          async (req, res) => {
            received = {
              auth: req.headers.authorization,
              body: await readBody(req),
            };
            res.setHeader('Content-Type', 'text/event-stream');
            res.end(
              groqStream([
                '{"english": "How are',
                ' you?", "romanized": "aap kaise hain"}',
              ]),
            );
          },
          async () => {
            const seen: string[] = [];
            const result = await translate.translate(
              'आप कैसे हैं',
              'hi',
              (englishSoFar) => seen.push(englishSoFar),
            );
            expect(result).toEqual({
              english: 'How are you?',
              romanized: 'aap kaise hain',
            });
            expect(seen).toEqual(['How are', 'How are you?']);
            expect(received.auth).toBe('Bearer groq-test-key');
            expect(received.body?.model).toBe('qwen/qwen3.8-27b');
            expect(received.body?.stream).toBe(true);
            expect(deepSeekCalled).toBe(false);
          },
        ),
    );
  });

  it('gives the translator the recent sentences as background', async () => {
    const translate = new TranslateService();
    let system = '';
    await withFakeClaude(
      (req, res) => res.end(),
      () =>
        withFakeGroq(
          async (req, res) => {
            const body = await readBody(req);
            system = (body.messages as { content: string }[])[0].content;
            res.setHeader('Content-Type', 'text/event-stream');
            res.end(groqStream(['{"english": "Let\'s start the meeting."}']));
          },
          async () => {
            await translate.translate(
              'ಇಂದಿ ನಿಷ್ಠೆಯನ್ನು',
              'kn',
              () => {},
              undefined,
              ['Ravi: How are you?'],
            );
            expect(system).toContain('- Ravi: How are you?');
            expect(system).toContain('Do NOT translate');
          },
        ),
    );
  });

  it('falls back to DeepSeek when Groq is out of quota', async () => {
    const translate = new TranslateService();
    await withFakeClaude(
      (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(
          streamedReply(['{"english": "Hello.", "romanized": "namaste"}']),
        );
      },
      () =>
        withFakeGroq(
          (req, res) => {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end('{"error":{"message":"Rate limit reached"}}');
          },
          async () => {
            await expect(translate.translate('नमस्ते', 'hi')).resolves.toEqual({
              english: 'Hello.',
              romanized: 'namaste',
            });
          },
        ),
    );
  });

  it('does not fall back when the caller cancelled it', async () => {
    const translate = new TranslateService();
    let deepSeekCalled = false;
    const cancel = new AbortController();
    await withFakeClaude(
      (req, res) => {
        deepSeekCalled = true;
        res.end();
      },
      () =>
        withFakeGroq(
          () => cancel.abort(), // the speaker carried on mid-request
          async () => {
            await expect(
              translate.translate('नमस्ते', 'hi', () => {}, cancel.signal),
            ).rejects.toThrow();
            expect(deepSeekCalled).toBe(false);
          },
        ),
    );
  });
});

describe('runaway replies (a real garbled Telugu sentence did this)', () => {
  const runaway = 'Reddy, '.repeat(200);

  it('collapses a word repeated 5+ times in a row to one', () => {
    expect(tidyEnglish(`Hey ${runaway}`)).toBe('Hey Reddy,');
  });

  it('keeps ordinary repetition like "Okay, okay, okay"', () => {
    expect(tidyEnglish('Okay, okay, okay.')).toBe('Okay, okay, okay.');
  });

  it('never shows raw JSON when the reply was cut off mid-way', () => {
    const cutOff = `{"english": "${runaway}`;
    const result = parseTranslation(cutOff);
    expect(result.english).not.toContain('{');
    expect(result.english).toBe('Reddy,');
  });

  it('cuts anything still too long at a sentence end', () => {
    const long = 'This is a sentence. '.repeat(40);
    expect(tidyEnglish(long).length).toBeLessThanOrEqual(400);
    expect(tidyEnglish(long).endsWith('.')).toBe(true);
  });

  it('lets short sentences have short replies only', () => {
    expect(replyTokenLimit('ఘ')).toBe(82);
    expect(replyTokenLimit('x'.repeat(500))).toBe(300);
  });
});
