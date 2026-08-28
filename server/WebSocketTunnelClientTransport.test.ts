import { describe, it, expect, vi } from 'vitest';
import { WebSocketTunnelClientTransport } from './WebSocketTunnelClientTransport';
import { CHECK_READY, SERVER_READY, SERVER_STOPPED } from './tunnelProtocol';

function make(readyTimeoutMs = 15000) {
  const sent: string[] = [];
  const close = vi.fn();
  const t = new WebSocketTunnelClientTransport({
    send: (d) => sent.push(d),
    close,
    readyTimeoutMs,
  });
  return { t, sent, close };
}

const REQ = { jsonrpc: '2.0' as const, id: 1, method: 'tools/list' };

describe('握手', () => {
  it('start() 主动发 check-ready —— 宿主 server 早已 start 过、那一次 ready 广播我们没赶上，靠这个让它补发', async () => {
    const { t, sent } = make();
    await t.start();
    expect(sent).toEqual([CHECK_READY]);
  });

  it('收到 server-ready 后 serverReadyPromise 兑现', async () => {
    const { t } = make();
    await t.start();
    t.handleIncoming(SERVER_READY);
    await expect(t.serverReadyPromise).resolves.toBeUndefined();
  });

  it('ready 之前 send 不发帧；ready 之后才发', async () => {
    const { t, sent } = make();
    await t.start();
    sent.length = 0;

    const pending = t.send(REQ);
    await Promise.resolve();
    expect(sent).toEqual([]);        // 还没 ready，压住

    t.handleIncoming(SERVER_READY);
    await pending;
    expect(sent).toEqual([JSON.stringify(REQ)]);
  });

  it('ready 超时后 send 抛错，而不是永远挂着（宿主页面没嵌 iframe 时就是这个情形）', async () => {
    vi.useFakeTimers();
    try {
      const { t } = make(50);
      await t.start();
      const p = t.send(REQ);
      const assertion = expect(p).rejects.toThrow(/ready/i);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('第一条 JSON-RPC 消息也算 ready 信号（ready 广播丢了也不至于死锁）', async () => {
    const { t } = make();
    await t.start();
    t.handleIncoming(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    await expect(t.serverReadyPromise).resolves.toBeUndefined();
  });
});

describe('消息', () => {
  it('JSON-RPC 帧解析后交给 onmessage', async () => {
    const { t } = make();
    const onmessage = vi.fn();
    t.onmessage = onmessage;
    await t.start();
    t.handleIncoming(SERVER_READY);

    const res = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
    t.handleIncoming(JSON.stringify(res));
    expect(onmessage).toHaveBeenCalledWith(res);
  });

  it('控制字符串不会被当成 JSON-RPC 交给 onmessage', async () => {
    const { t } = make();
    const onmessage = vi.fn();
    t.onmessage = onmessage;
    await t.start();
    t.handleIncoming(SERVER_READY);
    expect(onmessage).not.toHaveBeenCalled();
  });

  it('坏帧走 onerror，不抛、不打断连接', async () => {
    const { t } = make();
    const onerror = vi.fn();
    t.onerror = onerror;
    await t.start();
    t.handleIncoming(SERVER_READY);

    expect(() => t.handleIncoming('{ 这不是 json')).not.toThrow();
    expect(onerror).toHaveBeenCalledOnce();
  });

  it('形状不合法的 JSON 也走 onerror（能 parse 不等于是 JSON-RPC）', async () => {
    const { t } = make();
    const onerror = vi.fn();
    const onmessage = vi.fn();
    t.onerror = onerror;
    t.onmessage = onmessage;
    await t.start();
    t.handleIncoming(SERVER_READY);

    t.handleIncoming(JSON.stringify({ hello: 'world' }));
    expect(onmessage).not.toHaveBeenCalled();
    expect(onerror).toHaveBeenCalledOnce();
  });
});

describe('关闭', () => {
  it('宿主页面刷新会发 server-stopped，此时应关闭 transport 而不是继续等超时', async () => {
    const { t } = make();
    const onclose = vi.fn();
    t.onclose = onclose;
    await t.start();
    t.handleIncoming(SERVER_READY);

    t.handleIncoming(SERVER_STOPPED);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('close() 幂等：只回调一次 onclose', async () => {
    const { t } = make();
    const onclose = vi.fn();
    t.onclose = onclose;
    await t.start();
    await t.close();
    await t.close();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('socket 先断（handleSocketClose）也回调 onclose，且不再回头调 ws.close', async () => {
    const { t, close } = make();
    const onclose = vi.fn();
    t.onclose = onclose;
    await t.start();
    t.handleSocketClose();
    expect(onclose).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('关闭后 send 抛错', async () => {
    const { t } = make();
    await t.start();
    t.handleIncoming(SERVER_READY);
    await t.close();
    await expect(t.send(REQ)).rejects.toThrow(/closed/i);
  });

  it('ready 之前 close，挂起的 send 被拒绝而不是永久挂起', async () => {
    const { t } = make();
    await t.start();
    const p = t.send(REQ);
    const assertion = expect(p).rejects.toThrow();
    await t.close();
    await assertion;
  });
});
