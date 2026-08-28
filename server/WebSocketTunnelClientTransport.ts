/**
 * 服务器端的 MCP client transport：把 JSON-RPC 消息从 WebSocket 送到浏览器，
 * 再由 iframe 与宿主页面两跳哑转发，最终落到宿主页面的 TabServerTransport。
 *
 * 形状就是 @mcp-b/transports 的 TabClientTransport，只是把 window.postMessage
 * 换成 ws.send —— 两端跑的是同一套 MCP 协议，所以官方 SDK 的 Client 可以直接用，
 * tools/list、通知、错误码全都免费拿到，不需要在服务器端重建一套工具表。
 *
 * 不直接持有 ws 实例，而是接收 send/close 两个回调：ws 的生命周期由 sessions.ts
 * 管，transport 只管协议，这样单测里也不必起一个真的 WebSocket。
 */

import { JSONRPCMessageSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CHECK_READY, SERVER_READY, SERVER_STOPPED } from './tunnelProtocol.js';

export interface WebSocketTunnelClientTransportOptions {
  send: (data: string) => void;
  close: () => void;
  /** 等宿主页面就绪的上限。超时后 send 抛错，而不是永远挂着 */
  readyTimeoutMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 15_000;

export class WebSocketTunnelClientTransport implements Transport {
  private readonly _send: (data: string) => void;
  private readonly _closeSocket: () => void;
  private readonly _readyTimeoutMs: number;

  private _started = false;
  private _closed = false;
  private _readySettled = false;
  private _readyTimer: ReturnType<typeof setTimeout> | undefined;
  private _resolveReady!: () => void;
  private _rejectReady!: (reason: unknown) => void;

  readonly serverReadyPromise: Promise<void>;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: WebSocketTunnelClientTransportOptions) {
    this._send = options.send;
    this._closeSocket = options.close;
    this._readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

    this.serverReadyPromise = new Promise<void>((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    // 没人 await 时不要变成 unhandled rejection：真正的错误会在 send() 里重新抛出
    this.serverReadyPromise.catch(() => {});
  }

  async start(): Promise<void> {
    if (this._closed) throw new Error('Transport is closed');
    if (this._started) throw new Error('Transport already started');
    this._started = true;

    // 宿主页面的 TabServerTransport 只在它自己 start() 时广播一次 ready，
    // 那一刻我们的 WS 多半还没连上。好在 v4 每收到一次 check-ready 都会补发
    // 一次 ready（已从 dist 确认），所以这里主动问一次，谁先启动都能握上手。
    this._send(CHECK_READY);

    this._readyTimer = setTimeout(() => {
      this._settleReady(
        new Error(
          `等待宿主页面 ready 超时（${this._readyTimeoutMs}ms）。` +
            '通常是宿主页面没有嵌入 widget iframe，或它的隧道转发器没有启动。'
        )
      );
    }, this._readyTimeoutMs);
  }

  /** 由 ws.on('message') 调用 */
  handleIncoming(raw: string): void {
    if (this._closed) return;

    if (raw === SERVER_READY) {
      this._settleReady();
      return;
    }
    if (raw === SERVER_STOPPED) {
      // 宿主页面刷新或跳走。立刻关闭，让上层拿到明确的断连，而不是苦等超时
      void this.close();
      return;
    }

    try {
      const message = JSONRPCMessageSchema.parse(JSON.parse(raw));
      // 能收到合法 JSON-RPC 就说明对端活着，哪怕 ready 广播丢了也不该继续压着 send
      this._settleReady();
      this.onmessage?.(message);
    } catch (error) {
      this.onerror?.(
        new Error(`收到无法解析的隧道消息: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }

  /** 由 ws.on('close') 调用。与 close() 的区别是不再回头去关那个已经没了的 socket */
  handleSocketClose(): void {
    this._finish(false);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) throw new Error('Transport is closed');
    if (!this._started) throw new Error('Transport not started');

    await this.serverReadyPromise;
    if (this._closed) throw new Error('Transport is closed');

    this._send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    this._finish(true);
  }

  private _finish(closeSocket: boolean): void {
    if (this._closed) return;
    this._closed = true;
    this._started = false;

    this._settleReady(new Error('Transport closed before server ready'));

    if (closeSocket) {
      try {
        this._closeSocket();
      } catch {
        // socket 可能已经没了，关不上不算错误
      }
    }
    this.onclose?.();
  }

  /** 兑现或拒绝 ready，只会生效一次 */
  private _settleReady(error?: Error): void {
    if (this._readyTimer !== undefined) {
      clearTimeout(this._readyTimer);
      this._readyTimer = undefined;
    }
    if (this._readySettled) return;
    this._readySettled = true;
    if (error) this._rejectReady(error);
    else this._resolveReady();
  }
}
