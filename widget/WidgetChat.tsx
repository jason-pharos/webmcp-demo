/**
 * iframe 里的聊天面板。相当于原来的 ChatDrawer，但去掉了 portal / 抽屉动画 /
 * ESC 关闭 —— iframe 本身就是那个面板，这些由宿主页面的 AgentWidget 负责。
 *
 * 工具表不在这里：模型跑在服务器端，工具表是服务器从隧道那头 listTools 拿的。
 * 这一层只剩下 UI 与一个 SSE adapter。
 */

import { useMemo, useRef } from 'react';
import styled from 'styled-components';
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';
import { Thread } from '@/components/aiChat/Thread';
import { Composer } from '@/components/aiChat/Composer';
import { SamplePrompts } from '@/components/aiChat/SamplePrompts';
import { createSseChatAdapter } from './sseChatAdapter';

export function WidgetChat({ sessionId }: { sessionId: string | null }) {
  // sessionId 走 ref：它在 WS 连上之后才到位，而 adapter 只能创建一次
  // （重建 adapter 会重建 runtime，丢掉对话历史），所以不能进依赖数组。
  // ref 必须在 useMemo 之前声明，否则闭包捕获到的是 TDZ 里的绑定。
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // eslint-disable-next-line react-hooks/refs -- 读取发生在异步的 adapter.run() 里，不在渲染期间
  const adapter = useMemo(() => createSseChatAdapter(() => sessionIdRef.current), []);

  const runtime = useLocalRuntime(adapter);
  const fillComposer = (text: string) => runtime.thread.composer.setText(text);

  return (
    <Panel>
      <Header>
        <Title>Wallet Assistant</Title>
        <Status $ok={Boolean(sessionId)}>{sessionId ? 'connected' : 'connecting…'}</Status>
      </Header>
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
        <Composer focus />
      </AssistantRuntimeProvider>
    </Panel>
  );
}

const Panel = styled.div`
  /* 用 height: 100% 而非 position: fixed：widget 整个页面就是这块面板，
     不需要脱离文档流。height: 100% 依赖 html/body/#root 的 100% 链（见
     index.css），给出确定高度后，下面的 Thread 才能在内容溢出时垂直滚动。 */
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.surface};
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
