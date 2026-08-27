import { describe, it, expect, vi } from 'vitest';
import { startWidgetTunnel } from './tunnel';
import {
  makeEnvelope,
  TUNNEL_CHANNEL_ID,
  CHECK_READY,
  SERVER_READY,
} from '@/mcp/tunnelEnvelope';

const HOST_ORIGIN = 'http://localhost:5273';

function makeFakeSocket() {
  const sent: string[] = [];
  let onMessage: ((e: MessageEvent) => void) | undefined;
  const socket = {
    send: (d: string) => sent.push(d),
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === 'message') onMessage = fn;
    },
  };
  return {
    socket,
    sent,
    receive: (data: string) => onMessage?.({ data } as MessageEvent),
  };
}

function makeFakeWindow() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const posted: Array<{ data: unknown; targetOrigin: string }> = [];
  return {
    win: {
      postMessage: (data: unknown, targetOrigin: string) => posted.push({ data, targetOrigin }),
      addEventListener: (t: string, fn: (e: MessageEvent) => void) => {
        if (t === 'message') listeners.add(fn);
      },
      removeEventListener: (t: string, fn: (e: MessageEvent) => void) => {
        if (t === 'message') listeners.delete(fn);
      },
    } as unknown as Window,
    posted,
    deliver: (e: { data: unknown; origin: string; source: unknown }) => {
      for (const fn of listeners) fn(e as unknown as MessageEvent);
    },
    listenerCount: () => listeners.size,
  };
}

function setup() {
  const sock = makeFakeSocket();
  const self = makeFakeWindow();
  const parent = makeFakeWindow();
  const stop = startWidgetTunnel({
    socket: sock.socket,
    hostOrigin: HOST_ORIGIN,
    win: self.win,
    parentWindow: parent.win,
  });
  return { sock, self, parent, stop };
}

describe('WS → 宿主页面', () => {
  it('把裸 payload 包上隧道信封发给 parent', () => {
    const { sock, parent } = setup();
    const req = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

    sock.receive(JSON.stringify(req));

    expect(parent.posted).toEqual([
      {
        data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', req),
        targetOrigin: HOST_ORIGIN,
      },
    ]);
  });

  it('控制字符串保持字符串形态，不被 JSON.parse 变形', () => {
    const { sock, parent } = setup();
    sock.receive(CHECK_READY);
    expect(parent.posted[0]?.data).toEqual(
      makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', CHECK_READY)
    );
  });
});

describe('宿主页面 → WS', () => {
  it('剥掉信封，把裸 payload 序列化后发进 WS', () => {
    const { sock, self } = setup();
    const res = { jsonrpc: '2.0', id: 1, result: { tools: [] } };

    self.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'server-to-client', res),
      origin: HOST_ORIGIN,
      source: undefined,   // 由实现填 parentWindow
    });

    expect(sock.sent).toEqual([JSON.stringify(res)]);
  });

  it('控制字符串原样发（不能 JSON.stringify 成带引号的字面量，否则服务器认不出）', () => {
    const { sock, self } = setup();
    self.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'server-to-client', SERVER_READY),
      origin: HOST_ORIGIN,
      source: undefined,
    });
    expect(sock.sent).toEqual([SERVER_READY]);
  });

  it('origin 不对的消息丢弃', () => {
    const { sock, self } = setup();
    self.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'server-to-client', { a: 1 }),
      origin: 'https://evil.example',
      source: undefined,
    });
    expect(sock.sent).toEqual([]);
  });

  it('方向不对的消息丢弃（自己发出去的那条不会被自己收回来）', () => {
    const { sock, self } = setup();
    self.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', { a: 1 }),
      origin: HOST_ORIGIN,
      source: undefined,
    });
    expect(sock.sent).toEqual([]);
  });
});

describe('stop()', () => {
  it('摘掉 window 监听器', () => {
    const { self, stop } = setup();
    stop();
    expect(self.listenerCount()).toBe(0);
  });
});
