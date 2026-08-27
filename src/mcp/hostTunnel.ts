/**
 * 宿主侧哑转发：iframe ↔ 同一个 window 的 tab channel。
 *
 * 这个转发器不理解 MCP，只搬运 payload —— 控制字符串与 JSON-RPC 一视同仁。
 * 因此隧道天然支持 MCP 的全部语义（通知、progress、tools/list_changed），
 * 不需要在任何一端维护第二套 schema。
 *
 * 之所以能这么简单，是因为 @mcp-b/global 的 TabServerTransport 只要求
 * event.source === window，而这个转发器就跑在同一个 window 里，天生满足。
 *
 * 两个方向靠 direction 区分：转发到 tab channel 的是 client-to-server，
 * 从 tab channel 收的是 server-to-client，所以自己发出的消息虽然也会回到
 * 自己的 message 监听器上，却永远匹配不上另一个方向的判定，不会形成回环。
 */

import {
  makeEnvelope,
  matchEnvelope,
  TAB_CHANNEL_ID,
  TUNNEL_CHANNEL_ID,
} from './tunnelEnvelope';

export interface HostTunnelOptions {
  /** 延迟取 contentWindow：iframe 可能还没挂载，或者中途被换掉 */
  getIframeWindow: () => Window | null;
  /** widget 的 origin，用于双向校验；跨 origin 场景下这是唯一的来源保证 */
  widgetOrigin: string;
  /** 注入用，默认 globalThis.window */
  win?: Window;
}

export function startHostTunnel(options: HostTunnelOptions): () => void {
  const win = options.win ?? window;
  const { getIframeWindow, widgetOrigin } = options;

  const onMessage = (event: MessageEvent) => {
    // 方向一：iframe → tab channel
    if (
      event.origin === widgetOrigin &&
      event.source === getIframeWindow() &&
      matchEnvelope(event.data, TUNNEL_CHANNEL_ID, 'client-to-server')
    ) {
      win.postMessage(
        makeEnvelope(TAB_CHANNEL_ID, 'client-to-server', event.data.payload),
        win.origin
      );
      return;
    }

    // 方向二：tab channel → iframe
    if (
      event.source === win &&
      matchEnvelope(event.data, TAB_CHANNEL_ID, 'server-to-client')
    ) {
      const iframeWindow = getIframeWindow();
      if (!iframeWindow) return;   // iframe 还没挂载，安静丢弃
      iframeWindow.postMessage(
        makeEnvelope(TUNNEL_CHANNEL_ID, 'server-to-client', event.data.payload),
        widgetOrigin
      );
    }
  };

  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}
