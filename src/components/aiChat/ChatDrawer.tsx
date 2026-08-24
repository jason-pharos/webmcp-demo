/**
 * 右侧滑出的 AI chat 抽屉。
 *
 * runtime：assistant-ui 的 localRuntime + chatModel adapter；工具表来自页内 MCP client
 * （useMcpClient 拿到 tools，转成 AI SDK ToolSet）。工具表变化时通过 ref 传给 adapter，
 * 避免重建 runtime 丢掉对话历史。
 */

import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';
import { useMcpClient } from '@mcp-b/react-webmcp';
import type { ToolSet } from 'ai';
import { createChatAdapter } from '@/ai/chatModel';
import { mcpToolsToAiTools } from '@/mcp/mcpTools';
import { LLM_API_KEY } from '@/config/env';
import { Thread } from './Thread';
import { Composer } from './Composer';
import { SamplePrompts } from './SamplePrompts';

export function ChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client, tools, isConnected } = useMcpClient();

  const toolSet = useMemo<ToolSet>(
    () => (isConnected ? mcpToolsToAiTools(tools, client) : {}),
    [tools, client, isConnected]
  );
  // adapter 必须只创建一次：useLocalRuntime 用它初始化 runtime，重建 adapter
  // （哪怕只是因为 toolSet 引用变了）会重建 runtime，从而丢掉当前会话的聊天记录。
  // 所以工具表不能进 useMemo 的依赖数组，只能通过 ref 转交给它。
  const toolSetRef = useRef(toolSet);
  useEffect(() => {
    toolSetRef.current = toolSet;
  }, [toolSet]);
  // react-hooks/refs 静态分析看到 toolSetRef.current 出现在组件函数体里就会标红，但这里
  // 实际读取发生在 () => toolSetRef.current 这个闭包被调用的时候——即 adapter.run() 内部，
  // 由用户发消息异步触发，而不是在本次渲染期间同步读取，所以是安全的误报。
  // eslint-disable-next-line react-hooks/refs -- 读取发生在异步的 adapter.run() 里，不在渲染期间；见上方注释
  const adapter = useMemo(() => createChatAdapter(() => toolSetRef.current), []);
  const runtime = useLocalRuntime(adapter);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const fillComposer = (text: string) => {
    runtime.thread.composer.setText(text);
  };

  return createPortal(
    <Panel $open={open} role="dialog" aria-label="Wallet AI assistant">
      <Header>
        <Title>Wallet Assistant</Title>
        <Status $ok={isConnected}>{isConnected ? `${tools.length} tools` : 'connecting…'}</Status>
        <CloseButton type="button" onClick={onClose} aria-label="Close">
          ×
        </CloseButton>
      </Header>
      {!LLM_API_KEY && <Warning>未配置 VITE_LLM_API_KEY，chat 不可用</Warning>}
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread
          empty={
            <EmptyState>
              <EmptyTitle>问问这个钱包</EmptyTitle>
              <EmptyHint>Try one of these:</EmptyHint>
              <SamplePrompts onPick={fillComposer} />
            </EmptyState>
          }
        />
        <Composer focus={open} />
      </AssistantRuntimeProvider>
    </Panel>,
    document.body
  );
}

const Panel = styled.div<{ $open: boolean }>`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
  z-index: 9700;
  transform: translateX(${({ $open }) => ($open ? '0' : '100%')});
  transition: transform 300ms ease;
  @media (max-width: 1023px) {
    width: 100%;
  }
`;
const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;
const Title = styled.h3`
  margin: 0;
  flex: 1;
  font-family: ${({ theme }) => theme.font.body};
  font-weight: ${({ theme }) => theme.font.medium};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.text};
`;
const Status = styled.span<{ $ok: boolean }>`
  font-size: 12px;
  color: ${({ theme, $ok }) => ($ok ? theme.colors.textMuted : theme.colors.warning)};
`;
const CloseButton = styled.button`
  border: none;
  background: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textMuted};
  padding: 0 4px;
`;
const Warning = styled.div`
  margin: 12px 16px 0;
  padding: 8px 12px;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.bg};
  border: 1px solid ${({ theme }) => theme.colors.warning};
  color: ${({ theme }) => theme.colors.warning};
  font-size: 12px;
  line-height: 18px;
`;
const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
`;
const EmptyTitle = styled.p`
  margin: 0;
  font-family: ${({ theme }) => theme.font.body};
  font-weight: ${({ theme }) => theme.font.medium};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
`;
const EmptyHint = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textMuted};
`;
