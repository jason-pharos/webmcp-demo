/**
 * 把三段拼起来跑一遍：服务器 transport ↔ iframe 转发 ↔ 宿主转发 ↔ 一个假的
 * TabServerTransport（行为照抄 @mcp-b/transports 4.0.0 的 dist）。
 *
 * 单测里三段各自用的都是替身，这里才第一次验证它们真的能对上话 —— 尤其是
 * server/tunnelProtocol.ts 与 src/mcp/tunnelEnvelope.ts 里各写一份的那三个
 * 控制字符串，一致性全靠这个测试。
 */

import { describe, it, expect, vi } from 'vitest';
import { WebSocketTunnelClientTransport } from './WebSocketTunnelClientTransport';
import { startHostTunnel } from '../src/mcp/hostTunnel';
import { startWidgetTunnel } from '../widget/tunnel';
import {
  makeEnvelope,
  matchEnvelope,
  TAB_CHANNEL_ID,
  CHECK_READY,
  SERVER_READY,
} from '../src/mcp/tunnelEnvelope';

const HOST_ORIGIN = 'http://localhost:5273';
const WIDGET_ORIGIN = 'http://localhost:8787';

/** 一个能收发 message 的 window 替身，postMessage 会真的投递给目标 */
function makeWindow(origin: string) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const self: any = {
    origin,
    addEventListener: (t: string, fn: (e: MessageEvent) => void) => {
      if (t === 'message') listeners.add(fn);
    },
    removeEventListener: (t: string, fn: (e: MessageEvent) => void) => {
      if (t === 'message') listeners.delete(fn);
    },
    /** 供外部（另一个 window 或本 window）投递消息进来 */
    _deliver: (data: unknown, origin: string, source: unknown) => {
      for (const fn of [...listeners]) fn({ data, origin, source } as MessageEvent);
    },
  };
  return self;
}

/**
 * 搭一整条链路。返回：
 * - transport：服务器端那一头
 * - tabServerInbox：假 TabServerTransport 收到的 payload
 * - replyFromPage：让假页面回一条消息
 */
function buildChain() {
  const hostWin = makeWindow(HOST_ORIGIN);
  const widgetWin = makeWindow(WIDGET_ORIGIN);

  // 宿主 window 的 postMessage：同 window 广播（tab channel 就靠这个）
  hostWin.postMessage = (data: unknown) => hostWin._deliver(data, HOST_ORIGIN, hostWin);
  // iframe 里 parent.postMessage 的替身：真实浏览器里这一跳是跨 origin 的，
  // 宿主收到的 event.origin 是 iframe 的 origin、event.source 是 iframe 的 window
  const parentProxy: any = {
    postMessage: (data: unknown) => hostWin._deliver(data, WIDGET_ORIGIN, widgetWin),
  };
  // iframe 的 contentWindow：宿主转发器往这里投，source 是宿主那一侧的 window 对象
  widgetWin.postMessage = (data: unknown) => widgetWin._deliver(data, HOST_ORIGIN, parentProxy);

  // 假的 TabServerTransport：行为照抄 v4 dist —— 收到 check-ready 就补发 ready
  const tabServerInbox: unknown[] = [];
  hostWin.addEventListener('message', (e: MessageEvent) => {
    if (!matchEnvelope(e.data, TAB_CHANNEL_ID, 'client-to-server')) return;
    const { payload } = e.data;
    if (payload === CHECK_READY) {
      hostWin.postMessage(makeEnvelope(TAB_CHANNEL_ID, 'server-to-client', SERVER_READY));
      return;
    }
    tabServerInbox.push(payload);
  });

  startHostTunnel({
    getIframeWindow: () => widgetWin,
    widgetOrigin: WIDGET_ORIGIN,
    win: hostWin,
  });

  // WS 的两头：socket.send 把帧交给服务器 transport，服务器 transport 的 send
  // 把帧交给 iframe 的 socket
  let onSocketMessage: ((e: MessageEvent) => void) | undefined;
  const transport = new WebSocketTunnelClientTransport({
    send: (data) => onSocketMessage?.({ data } as MessageEvent),
    close: () => {},
    readyTimeoutMs: 1000,
  });

  const fakeSocket = {
    send: (data: string) => transport.handleIncoming(data),
    addEventListener: (t: string, fn: (e: MessageEvent) => void) => {
      if (t === 'message') onSocketMessage = fn;
    },
  };

  startWidgetTunnel({
    socket: fakeSocket,
    hostOrigin: HOST_ORIGIN,
    win: widgetWin,
    parentWindow: parentProxy,
  });

  const replyFromPage = (payload: unknown) =>
    hostWin.postMessage(makeEnvelope(TAB_CHANNEL_ID, 'server-to-client', payload));

  return { transport, tabServerInbox, replyFromPage };
}

describe('端到端隧道（不含 LLM）', () => {
  it('握手：服务器发 check-ready，假页面补发 ready，三跳后 serverReadyPromise 兑现', async () => {
    const { transport } = buildChain();
    await transport.start();
    await expect(transport.serverReadyPromise).resolves.toBeUndefined();
  });

  it('请求走通三跳，原封不动地到达页面的 tab channel', async () => {
    const { transport, tabServerInbox } = buildChain();
    await transport.start();
    await transport.serverReadyPromise;

    const req = { jsonrpc: '2.0' as const, id: 1, method: 'tools/list' };
    await transport.send(req);

    expect(tabServerInbox).toEqual([req]);
  });

  it('响应原路回到服务器的 onmessage', async () => {
    const { transport, replyFromPage } = buildChain();
    const onmessage = vi.fn();
    transport.onmessage = onmessage;
    await transport.start();
    await transport.serverReadyPromise;

    const res = {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'wallet_get_balances' }] },
    };
    replyFromPage(res);

    expect(onmessage).toHaveBeenCalledWith(res);
  });

  it('通知（无 id）也能双向穿过，说明隧道没有丢掉 MCP 的非请求语义', async () => {
    const { transport, tabServerInbox, replyFromPage } = buildChain();
    const onmessage = vi.fn();
    transport.onmessage = onmessage;
    await transport.start();
    await transport.serverReadyPromise;

    const outbound = { jsonrpc: '2.0' as const, method: 'notifications/initialized' };
    await transport.send(outbound);
    expect(tabServerInbox).toEqual([outbound]);

    const inbound = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' };
    replyFromPage(inbound);
    expect(onmessage).toHaveBeenCalledWith(inbound);
  });

  it('页面卸载（server-stopped）穿过隧道，服务器侧收到明确的 close', async () => {
    const { transport, replyFromPage } = buildChain();
    const onclose = vi.fn();
    transport.onclose = onclose;
    await transport.start();
    await transport.serverReadyPromise;

    replyFromPage('mcp-server-stopped');

    expect(onclose).toHaveBeenCalledOnce();
  });
});
