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

    const client = new Client({ name: 'webmcp-demo-server-agent', version: '1.0.0' });
    // Client.connect 内部会调 transport.start()，握手随之开始
    await client.connect(transport);

    const { tools } = await client.listTools();

    const session: Session = { id, client, transport, tools };
    this._sessions.set(session.id, session);

    // socket 断了就销毁 session，否则 map 会随着页面刷新无限增长
    socket.onClose(() => {
      transport.handleSocketClose();
      this._sessions.delete(session.id);
    });

    return session;
  }

  get(id: string): Session | undefined {
    return this._sessions.get(id);
  }

  list(): Session[] {
    return [...this._sessions.values()];
  }
}
