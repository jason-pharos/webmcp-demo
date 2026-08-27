/**
 * iframe 侧哑转发：WebSocket ↔ 宿主页面 postMessage。
 *
 * 与宿主侧一样只搬运 payload、不理解 MCP。信封在这一侧加、在这一侧剥：
 * WS 上跑的是裸 payload（服务器那边不需要知道 postMessage 信封长什么样），
 * postMessage 上跑的是带信封的消息。
 *
 * 控制字符串必须原样收发，不能走 JSON.stringify —— 否则 'mcp-server-ready'
 * 会变成 '"mcp-server-ready"'，两端的等值判断全部失效，握手静默卡死。
 */

import { makeEnvelope, matchEnvelope, TUNNEL_CHANNEL_ID } from '@/mcp/tunnelEnvelope';

export interface WidgetTunnelOptions {
  socket: Pick<WebSocket, 'send' | 'addEventListener'>;
  /** 宿主页面 origin，双向校验用 */
  hostOrigin: string;
  /** 注入用，默认 globalThis.window */
  win?: Window;
  /** 注入用，默认 window.parent */
  parentWindow?: Window;
}

export function startWidgetTunnel(options: WidgetTunnelOptions): () => void {
  const win = options.win ?? window;
  const parentWindow = options.parentWindow ?? window.parent;
  const { socket, hostOrigin } = options;

  // WS → 宿主页面：包上信封
  socket.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : String(event.data);
    let payload: unknown = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // 不是 JSON 就是控制字符串，原样带过去
    }
    parentWindow.postMessage(
      makeEnvelope(TUNNEL_CHANNEL_ID, 'client-to-server', payload),
      hostOrigin
    );
  });

  // 宿主页面 → WS：剥掉信封
  const onMessage = (event: MessageEvent) => {
    // origin 只能证明消息来自宿主页面的 origin，不能证明是宿主页面本身发的
    // （同源下别的窗口也能伪造）；与 hostTunnel.ts 的两个分支对齐，origin
    // 和 source 都要校验，才是完整的来源保证
    if (event.origin !== hostOrigin) return;
    if (event.source !== parentWindow) return;
    if (!matchEnvelope(event.data, TUNNEL_CHANNEL_ID, 'server-to-client')) return;

    const { payload } = event.data;
    socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };

  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}
