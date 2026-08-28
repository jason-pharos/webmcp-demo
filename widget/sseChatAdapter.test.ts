import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSseChatAdapter } from './sseChatAdapter';

/** 把若干 SSE 事件拼成一个 Response，喂给 adapter */
function sseResponse(events: unknown[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const userMessage = {
  role: 'user' as const,
  content: [{ type: 'text' as const, text: '余额多少' }],
};

async function collect(adapter: ReturnType<typeof createSseChatAdapter>) {
  const out: string[] = [];
  const iterator = adapter.run({
    messages: [userMessage] as never,
    abortSignal: new AbortController().signal,
  } as never) as AsyncGenerator<{ content: Array<{ type: string; text: string }> }>;
  for await (const chunk of iterator) {
    out.push(chunk.content[0]!.text);
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSseChatAdapter', () => {
  it('把 delta 事件依次 yield 出去', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'delta', text: '你' },
          { type: 'delta', text: '你有' },
          { type: 'delta', text: '你有 1 PROS' },
          { type: 'done' },
        ])
      )
    );

    expect(await collect(createSseChatAdapter(() => 'sess-1'))).toEqual([
      '你',
      '你有',
      '你有 1 PROS',
    ]);
  });

  it('error 事件转成异常抛出，让 assistant-ui 显示错误气泡', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([{ type: 'error', message: 'LLM 鉴权失败' }]))
    );

    await expect(collect(createSseChatAdapter(() => 'sess-1'))).rejects.toThrow('LLM 鉴权失败');
  });

  it('还没拿到 sessionId 时给出明确提示，而不是发一个必然失败的请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(createSseChatAdapter(() => null))).rejects.toThrow(/连接/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 错误（例如 409 session 已失效）转成异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: '与页面的连接已断开，请刷新宿主页面后重试。' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    await expect(collect(createSseChatAdapter(() => 'stale'))).rejects.toThrow(/连接已断开/);
  });

  it('请求体带上 sessionId 与压平成文本的消息', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      sseResponse([{ type: 'done' }])
    );
    vi.stubGlobal('fetch', fetchMock);

    await collect(createSseChatAdapter(() => 'sess-42'));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      sessionId: 'sess-42',
      messages: [{ role: 'user', content: '余额多少' }],
    });
  });
});
