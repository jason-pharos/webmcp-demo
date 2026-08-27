/**
 * postMessage 信封的构造与判定 —— 宿主侧与 iframe 侧共用这一份。
 *
 * 格式必须与实际安装的 @mcp-b/transports 4.0.0 逐字一致（见
 * node_modules/@mcp-b/transports/dist/index.js 里 TabServerTransport 的
 * _messageHandler）。v4 是内联的属性检查，没有导出 isMcpMessage/postMcpMessage
 * 这两个 helper —— 那是 v5 才有的，references/ 目录下的代码不能直接照抄。
 *
 * 格式对不上的症状是静默丢消息、不报错，所以这里集中一份、并用测试钉死。
 */

/** @mcp-b/global 的 tabServer channel，与 index.html 内联脚本里的配置必须一致 */
export const TAB_CHANNEL_ID = 'webmcp-wallet-demo';

/** 宿主 ↔ iframe 之间隧道自己的 channel，与 TAB_CHANNEL_ID 分开避免串台 */
export const TUNNEL_CHANNEL_ID = 'webmcp-tunnel';

/** v4 的三个控制字符串。它们与 JSON-RPC 消息共用 payload 字段，隧道必须原样透传 */
export const CHECK_READY = 'mcp-check-ready';
export const SERVER_READY = 'mcp-server-ready';
export const SERVER_STOPPED = 'mcp-server-stopped';

export type Direction = 'client-to-server' | 'server-to-client';

export interface McpEnvelope {
  channel: string;
  type: 'mcp';
  direction: Direction;
  payload: unknown;
}

export function makeEnvelope(
  channel: string,
  direction: Direction,
  payload: unknown
): McpEnvelope {
  return { channel, type: 'mcp', direction, payload };
}

export function matchEnvelope(
  data: unknown,
  channel: string,
  direction: Direction
): data is McpEnvelope {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  // 只校验前三个字段：payload 可能合法地是 false / 0 / null，不能用真值判断它是否存在
  return d.channel === channel && d.type === 'mcp' && d.direction === direction;
}
