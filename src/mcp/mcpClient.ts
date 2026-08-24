/**
 * 页内 MCP 客户端单例。
 *
 * 页面（本 demo 没有独立 chat 抽屉，但结构与 apps/port 的 apc chat 一致）通过
 * TabClientTransport（window.postMessage）连接同一个 tab 内的 BrowserMcpServer
 * （由 @mcp-b/global 在 main.tsx 初始化），从而 list/call 页面用 useWebMCP 注册的工具。
 *
 * 必须是模块级单例：React 重渲染时若重建 client/transport 会反复建连断连。
 *
 * React 19 StrictMode 下 <McpClientProvider>（@mcp-b/react-webmcp，第三方，不可改）
 * 的 connect effect 会 mount→cleanup→mount 两次。它自己的 connectionState 只是一个
 * ref，cleanup 时被重置为 'disconnected'，但从不调用 client.close() —— 于是第二次
 * mount 会在同一个 client 实例上再调一次 `client.connect(transport, opts)`，而 SDK
 * 的 Protocol.connect() 只要发现 `this._transport` 已经被第一次调用设置就同步抛出
 * "Already connected to a transport"，没有「同一个 transport 再连一次」的容错。
 *
 * 这里不碰 node_modules、也不去关 StrictMode，而是在拿到 client 单例时给它的
 * connect 方法包一层幂等：同一个 transport 的重复调用直接复用第一次的 promise；
 * 传入其它 transport（真的换连接对象）或真实连接失败，仍然按原样抛错，不吞。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { TabClientTransport } from '@mcp-b/transports';

/**
 * 与 @mcp-b/global 的 tabServer 使用同一个 channel，避免与页面上其它 MCP 通道串台。
 *
 * 必须和 webmcp-demo/index.html 里内联 <script> 设置的 window.__webModelContextOptions
 * 里的 channelId 保持完全一致 —— 那里才是 server 端真正生效的初始化配置（见该文件
 * 内的注释：@mcp-b/global 一被 import 就会读取那个全局变量并自动初始化，跑在
 * main.tsx 自己的显式调用之前）。这两处一旦不同步，client/server 就会连到两个不同的
 * channel 上，永远连不上，只会在超时后收到 MCP -32001。
 */
export const MCP_CHANNEL_ID = 'webmcp-wallet-demo';

/**
 * 请求超时。默认 10s 不够：wallet_transfer 要等用户在确认框点击 + 钱包签名 + 等待节点接受，
 * 放到 10 分钟，让「用户去泡杯咖啡再回来签名」也不会被 transport 抢先超时。
 */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

let client: Client | null = null;
let transport: TabClientTransport | null = null;

/** 记录 client 已经/正在连接的那个 transport 实例，用来判断「重复调用」vs「换了个新连接」 */
let connectingTransport: Transport | null = null;
/** 上一次（仍在进行或已完成）的 connect() promise，重复调用时直接复用它 */
let connectPromise: Promise<void> | null = null;

/**
 * 把 client 的 connect 方法包成幂等版本：
 * - 同一个 transport 实例的重复调用（StrictMode 双调用）→ 复用同一个 promise，不重新调用底层 connect。
 * - 换成另一个 transport 实例 → 视为真正的新连接，照常调用底层 connect，让失败正常抛出。
 * 只包一次：client 是模块级单例，重复调用 getMcpClient() 不应该再包一层。
 */
function makeConnectIdempotent(c: Client): Client {
  const realConnect = c.connect.bind(c);
  c.connect = (transportArg: Transport, options?: RequestOptions) => {
    if (connectPromise && connectingTransport === transportArg) {
      return connectPromise;
    }
    connectingTransport = transportArg;
    connectPromise = realConnect(transportArg, options).catch((error) => {
      // 真实失败：清掉记录，让下一次调用（不管是重试还是换 transport）走真实 connect
      connectingTransport = null;
      connectPromise = null;
      throw error;
    });
    return connectPromise;
  };
  return c;
}

export function getMcpClient(): Client {
  if (!client) {
    client = makeConnectIdempotent(new Client({ name: 'webmcp-wallet-demo-chat', version: '1.0.0' }));
  }
  return client;
}

export function getMcpTransport(): TabClientTransport {
  if (!transport) {
    transport = new TabClientTransport({
      targetOrigin: window.location.origin,
      channelId: MCP_CHANNEL_ID,
      requestTimeout: REQUEST_TIMEOUT_MS,
    });
  }
  return transport;
}
