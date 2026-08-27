import { describe, it, expect, vi } from 'vitest';
import { SessionRegistry } from './sessions';
import { SERVER_READY } from './tunnelProtocol';

/**
 * 一个假的浏览器端：把服务器发来的 JSON-RPC 请求按 MCP 协议应答，
 * 让 Client 的 initialize 与 listTools 能真的跑完。
 */
function makeFakePage(tools: Array<{ name: string; description?: string }>) {
  let onMessage: ((raw: string) => void) | undefined;
  let onClose: (() => void) | undefined;
  const sentToServer: string[] = [];

  const socket = {
    send: (data: string) => {
      sentToServer.push(data);
      if (data === 'mcp-check-ready') {
        onMessage?.(SERVER_READY);
        return;
      }
      const msg = JSON.parse(data);
      if (msg.method === 'initialize') {
        onMessage?.(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake-page', version: '1.0.0' },
            },
          })
        );
      } else if (msg.method === 'tools/list') {
        onMessage?.(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description ?? '',
                inputSchema: { type: 'object', properties: {} },
              })),
            },
          })
        );
      }
      // notifications（无 id）不需要应答
    },
    close: vi.fn(),
    onMessage: (fn: (raw: string) => void) => {
      onMessage = fn;
    },
    onClose: (fn: () => void) => {
      onClose = fn;
    },
  };

  return { socket, sentToServer, triggerClose: () => onClose?.() };
}

describe('SessionRegistry', () => {
  it('create 完成握手并拿到页面的工具表', async () => {
    const registry = new SessionRegistry();
    const page = makeFakePage([{ name: 'wallet_get_balances' }, { name: 'wallet_transfer' }]);

    const session = await registry.create(page.socket);

    expect(session.tools.map((t) => t.name)).toEqual([
      'wallet_get_balances',
      'wallet_transfer',
    ]);
  });

  it('session 有唯一 id，可以按 id 取回', async () => {
    const registry = new SessionRegistry();
    const a = await registry.create(makeFakePage([{ name: 't' }]).socket);
    const b = await registry.create(makeFakePage([{ name: 't' }]).socket);

    expect(a.id).not.toBe(b.id);
    expect(registry.get(a.id)).toBe(a);
    expect(registry.get(b.id)).toBe(b);
    expect(registry.size).toBe(2);
  });

  it('socket 断开后 session 被移除，避免 map 无限增长', async () => {
    const registry = new SessionRegistry();
    const page = makeFakePage([{ name: 't' }]);
    const session = await registry.create(page.socket);
    expect(registry.size).toBe(1);

    page.triggerClose();
    await vi.waitFor(() => expect(registry.size).toBe(0));
    expect(registry.get(session.id)).toBeUndefined();
  });

  it('未知 id 返回 undefined，不抛', () => {
    const registry = new SessionRegistry();
    expect(registry.get('nope')).toBeUndefined();
  });

  it('可以指定 id —— 服务器要在握手之前就把 session 帧发出去，所以得先拿到 id', async () => {
    const registry = new SessionRegistry();
    const session = await registry.create(makeFakePage([{ name: 't' }]).socket, 'fixed-id');
    expect(session.id).toBe('fixed-id');
    expect(registry.get('fixed-id')).toBe(session);
  });
});
