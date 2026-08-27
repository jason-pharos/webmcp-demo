/**
 * iframe 入口：连 WS、装隧道转发器、渲染聊天面板。
 *
 * 顺序很关键 —— 服务器在连上之后立刻发一帧 {"type":"session"}，那一帧在隧道
 * 协议之外。所以先装一个只认这一帧的临时监听器，拿到 sessionId 之后再把
 * startWidgetTunnel 接上；之后所有帧都是隧道的。
 *
 * 重连用指数退避：宿主页面刷新会让服务器端 session 失效，重连后拿到新的
 * sessionId，聊天记录留在这个 iframe 的内存里、不受影响。
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import '../src/index.css';
import { theme } from '@/theme';
import { startWidgetTunnel } from './tunnel';
import { WidgetChat } from './WidgetChat';

const WS_URL = `ws://${location.host}/tunnel`;
const MAX_BACKOFF_MS = 30_000;

function Widget() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let stopTunnel: (() => void) | undefined;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(WS_URL);

      // 第一帧是 session 通告，不属于隧道协议。服务器保证它早于任何 MCP 帧发出，
      // 所以先只装这个临时监听器，消费掉它之后再把隧道接上 —— 顺序反过来的话，
      // session 帧会被转发进宿主页面的 tab channel，在那边打出一条无意义的解析错误。
      const onFirstFrame = (event: MessageEvent) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;   // 不是 JSON 就不是 session 帧，留给隧道处理
        }
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as { type?: unknown }).type === 'session'
        ) {
          socket!.removeEventListener('message', onFirstFrame);
          setSessionId((parsed as { sessionId: string }).sessionId);
          retryMs = 1000;   // 连上了就重置退避
          // 隧道在这里才接上。服务器的 check-ready 是在 client.connect() 内部发的，
          // 严格晚于 session 帧，而每个 WS 帧各自派发一次事件，所以不会漏。
          stopTunnel = startWidgetTunnel({ socket: socket!, hostOrigin: __HOST_ORIGIN__ });
        }
      };
      socket.addEventListener('message', onFirstFrame);

      socket.addEventListener('close', () => {
        if (stopped) return;
        stopTunnel?.();
        setSessionId(null);
        timer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, MAX_BACKOFF_MS);
      });
    };

    connect();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stopTunnel?.();
      socket?.close();
    };
  }, []);

  return <WidgetChat sessionId={sessionId} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <Widget />
    </ThemeProvider>
  </StrictMode>
);
