/**
 * 宿主页面里的 agent widget：一个跨 origin 的 iframe，加上隧道转发器。
 *
 * iframe 常挂载（用 transform 收起而不是卸载），这样关掉再打开时对话历史还在，
 * 隧道也不会断。转发器只装一次，通过 ref 延迟取 contentWindow。
 */

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { startHostTunnel } from '@/mcp/hostTunnel';

const WIDGET_ORIGIN = 'http://localhost:8787';

export function AgentWidget() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stop = startHostTunnel({
      getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
      widgetOrigin: WIDGET_ORIGIN,
    });
    return stop;
  }, []);

  return (
    <>
      <Fab type="button" onClick={() => setOpen((o) => !o)} aria-label="Open AI assistant">
        AI
      </Fab>
      <Frame
        ref={iframeRef}
        $open={open}
        src={`${WIDGET_ORIGIN}/widget`}
        title="Wallet Assistant"
      />
    </>
  );
}

const Fab = styled.button`
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primaryText};
  font-family: ${({ theme }) => theme.font.body};
  font-weight: ${({ theme }) => theme.font.medium};
  font-size: 16px;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 18, 184, 0.3);
  z-index: 9600;
`;

const Frame = styled.iframe<{ $open: boolean }>`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  border: none;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
  z-index: 9700;
  transform: translateX(${({ $open }) => ($open ? '0' : '100%')});
  transition: transform 300ms ease;
  @media (max-width: 1023px) {
    width: 100%;
  }
`;
