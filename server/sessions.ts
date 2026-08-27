/**
 * 一个 WebSocket 连接 = 一个 session = 一个 MCP Client。
 *
 * 服务器端不重建工具表、也不聚合多个页面 —— 隧道那头就是一个完整的 MCP
 * server，官方 SDK 的 Client 连上去之后 tools/list、通知、错误码都是现成的。
 *
 * 不直接依赖 ws 的类型：SessionSocket 只描述用得上的四个能力，这样单测里
 * 可以塞一个假页面进来，把 initialize 与 tools/list 真的跑完。
 *
 * create() 接受一个可选的 id：调用方可能需要在握手完成之前就把 session 帧
 * 发给客户端（例如先建立一个假的下行通道），所以 id 要能提前拿到，而不是
 * 等 create() resolve 之后才知道。
 */

import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketTunnelClientTransport } from './WebSocketTunnelClientTransport.js';

export interface SessionSocket {
  send: (data: string) => void;
  close: () => void;
  onMessage: (fn: (raw: string) => void) => void;
  onClose: (fn: () => void) => void;
}

export interface Session {
  id: string;
  client: Client;
  transport: WebSocketTunnelClientTransport;
  tools: McpTool[];
}

export class SessionRegistry {
  private readonly _sessions = new Map<string, Session>();

  get size(): number {
    return this._sessions.size;
  }

  async create(socket: SessionSocket, id: string = randomUUID()): Promise<Session> {
    const transport = new WebSocketTunnelClientTransport({
      send: (data) => socket.send(data),
      close: () => socket.close(),
    });

    socket.onMessage((raw) => transport.handleIncoming(raw));

    // 必须在 connect()/listTools() 之前就挂 onClose：握手是两次异步往返
    // （initialize 之后还有 tools/list），中途 socket 断开也得被捕捉到，
    // 不然没人调 transport.handleSocketClose()，只能干等 SDK 默认 60s 的
    // 单次请求超时。用 registered 标记而不是直接引用 session，因为这一刻
    // session 对象还不存在——没注册过就什么都不用删，是安全的空操作。
    let registered = false;
    socket.onClose(() => {
      transport.handleSocketClose();
      if (registered) this._sessions.delete(id);
    });

    const client = new Client({ name: 'webmcp-demo-server-agent', version: '1.0.0' });
    try {
      // Client.connect 内部会调 transport.start()，握手随之开始
      await client.connect(transport);
      const { tools } = await client.listTools();

      const session: Session = { id, client, transport, tools };
      this._sessions.set(id, session);
      registered = true;

      return session;
    } catch (err) {
      // 握手没走完就失败：client 不能悬着，map 里也不能留下半成品 session
      await client.close().catch(() => {});
      throw err;
    }
  }

  get(id: string): Session | undefined {
    return this._sessions.get(id);
  }

  list(): Session[] {
    return [...this._sessions.values()];
  }
}
