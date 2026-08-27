import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionRegistry, type Session } from './sessions';
import { SERVER_READY } from './tunnelProtocol';

// 每个测试创建的 session 都在这里登记，afterEach 统一关掉 —— 模拟真实调用方
// 该守的清理契约，即便测试里的假 socket 本身没有需要释放的资源。
const createdSessions: Session[] = [];
afterEach(async () => {
  await Promise.all(createdSessions.map((s) => s.client.close().catch(() => {})));
  createdSessions.length = 0;
});

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
    createdSessions.push(session);

    expect(session.tools.map((t) => t.name)).toEqual([
      'wallet_get_balances',
      'wallet_transfer',
    ]);
  });

  it('session 有唯一 id，可以按 id 取回', async () => {
    const registry = new SessionRegistry();
    const a = await registry.create(makeFakePage([{ name: 't' }]).socket);
    const b = await registry.create(makeFakePage([{ name: 't' }]).socket);
    createdSessions.push(a, b);

    expect(a.id).not.toBe(b.id);
    expect(registry.get(a.id)).toBe(a);
    expect(registry.get(b.id)).toBe(b);
    expect(registry.size).toBe(2);
  });

  it('socket 断开后 session 被移除，避免 map 无限增长', async () => {
    const registry = new SessionRegistry();
    const page = makeFakePage([{ name: 't' }]);
    const session = await registry.create(page.socket);
    createdSessions.push(session);
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
    createdSessions.push(session);
    expect(session.id).toBe('fixed-id');
    expect(registry.get('fixed-id')).toBe(session);
  });

  it('socket 在 initialize 之后、tools/list 之前断开：create 拒绝，且不留下半成品 session', async () => {
    // 只应答 initialize，故意不回 tools/list，模拟握手途中断连的窗口期
    let onMessage: ((raw: string) => void) | undefined;
    let onClose: (() => void) | undefined;

    const socket = {
      send: (data: string) => {
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
          // initialize 应答一送达，立刻掐断 socket —— 这时 listTools() 的
          // 请求已经发出去了，但永远等不到回应
          queueMicrotask(() => onClose?.());
        }
        // tools/list 故意不回应
      },
      close: vi.fn(),
      onMessage: (fn: (raw: string) => void) => {
        onMessage = fn;
      },
      onClose: (fn: () => void) => {
        onClose = fn;
      },
    };

    const registry = new SessionRegistry();
    await expect(registry.create(socket)).rejects.toThrow();
    expect(registry.size).toBe(0);
  });
});
