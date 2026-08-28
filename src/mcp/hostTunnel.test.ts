import { describe, it, expect, vi } from 'vitest';
import { startHostTunnel } from './hostTunnel';
import {
  makeEnvelope,
  TAB_CHANNEL_ID,
  TUNNEL_CHANNEL_ID,
  CHECK_READY,
  SERVER_READY,
} from './tunnelEnvelope';

const HOST_ORIGIN = 'http://localhost:5273';
const WIDGET_ORIGIN = 'http://localhost:8787';

/** 一个够用的 window 替身：能收发 message、能记下 postMessage 的调用 */
function makeFakeWindow(origin: string) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const posted: Array<{ data: unknown; targetOrigin: string }> = [];
  const win = {
    origin,
    postMessage: (data: unknown, targetOrigin: string) => {
      posted.push({ data, targetOrigin });
    },
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === 'message') listeners.delete(fn);
    },
  };
  const deliver = (e: { data: unknown; origin: string; source: unknown }) => {
    for (const fn of listeners) fn(e as unknown as MessageEvent);
  };
  return { win: win as unknown as Window, posted, deliver, listenerCount: () => listeners.size };
}

function setup() {
  const host = makeFakeWindow(HOST_ORIGIN);
  const iframe = makeFakeWindow(WIDGET_ORIGIN);
  const stop = startHostTunnel({
    getIframeWindow: () => iframe.win,
    widgetOrigin: WIDGET_ORIGIN,
    win: host.win,
  });
  return { host, iframe, stop };
}

describe('iframe → tab channel', () => {
  it('换上 tab channel 的信封后发给自己这个 window', () => {
    const { host, iframe } = setup();
    const req = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

    host.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', req),
      origin: WIDGET_ORIGIN,
      source: iframe.win,
    });

    expect(host.posted).toEqual([
      { data: makeEnvelope(TAB_CHANNEL_ID, 'client-to-server', req), targetOrigin: HOST_ORIGIN },
    ]);
  });

  it('控制字符串一视同仁地转发 —— 漏了它握手就永远完不成', () => {
    const { host, iframe } = setup();
    host.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', CHECK_READY),
      origin: WIDGET_ORIGIN,
      source: iframe.win,
    });
    expect(host.posted[0]?.data).toEqual(
      makeEnvelope(TAB_CHANNEL_ID, 'client-to-server', CHECK_READY)
    );
  });

  it('origin 不对的消息丢弃（跨 origin 场景下这是唯一的来源校验）', () => {
    const { host, iframe } = setup();
    host.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', { a: 1 }),
      origin: 'https://evil.example',
      source: iframe.win,
    });
    expect(host.posted).toEqual([]);
  });

  it('origin 对但 source 不是我们那个 iframe 的消息丢弃', () => {
    const { host } = setup();
    host.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', { a: 1 }),
      origin: WIDGET_ORIGIN,
      source: { not: 'our iframe' },
    });
    expect(host.posted).toEqual([]);
  });
});

describe('tab channel → iframe', () => {
  it('换上隧道信封后发给 iframe，targetOrigin 收窄到 widget origin', () => {
    const { host, iframe } = setup();
    const res = { jsonrpc: '2.0', id: 1, result: { tools: [] } };

    host.deliver({
      data: makeEnvelope(TAB_CHANNEL_ID, 'server-to-client', res),
      origin: HOST_ORIGIN,
      source: host.win,
    });

    expect(iframe.posted).toEqual([
      { data: makeEnvelope(TUNNEL_CHANNEL_ID, 'server-to-client', res), targetOrigin: WIDGET_ORIGIN },
    ]);
  });

  it('server-ready 也转发', () => {
    const { host, iframe } = setup();
    host.deliver({
      data: makeEnvelope(TAB_CHANNEL_ID, 'server-to-client', SERVER_READY),
      origin: HOST_ORIGIN,
      source: host.win,
    });
    expect(iframe.posted[0]?.data).toEqual(
      makeEnvelope(TUNNEL_CHANNEL_ID, 'server-to-client', SERVER_READY)
    );
  });

  it('iframe 还没挂载时安静丢弃，不抛异常', () => {
    const host = makeFakeWindow(HOST_ORIGIN);
    startHostTunnel({
      getIframeWindow: () => null,
      widgetOrigin: WIDGET_ORIGIN,
      win: host.win,
    });
    expect(() =>
      host.deliver({
        data: makeEnvelope(TAB_CHANNEL_ID, 'server-to-client', SERVER_READY),
        origin: HOST_ORIGIN,
        source: host.win,
      })
    ).not.toThrow();
  });
});

describe('不形成回环', () => {
  it('自己刚转发到 tab channel 的那条 client-to-server 不会被自己再收一次', () => {
    const { host, iframe } = setup();
    const req = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

    // 转发一次
    host.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', req),
      origin: WIDGET_ORIGIN,
      source: iframe.win,
    });
    // 模拟这条消息回到自己的 message 监听器上
    host.deliver({
      data: makeEnvelope(TAB_CHANNEL_ID, 'client-to-server', req),
      origin: HOST_ORIGIN,
      source: host.win,
    });

    expect(host.posted).toHaveLength(1);  // 没有第二次转发
    expect(iframe.posted).toHaveLength(0);
  });
});

describe('stop()', () => {
  it('摘掉监听器，之后不再转发', () => {
    const { host, iframe, stop } = setup();
    stop();
    expect(host.listenerCount()).toBe(0);

    host.deliver({
      data: makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', { a: 1 }),
      origin: WIDGET_ORIGIN,
      source: iframe.win,
    });
    expect(host.posted).toEqual([]);
  });
});
