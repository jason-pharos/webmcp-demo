/**
 * 消息列表：assistant-ui 的 ThreadPrimitive/MessagePrimitive headless 组件 + 项目主题皮肤。
 * 只渲染文本片段（tool call 过程不展示，结果由模型转述）。
 */

import styled from 'styled-components';
import { ThreadPrimitive, MessagePrimitive, ErrorPrimitive } from '@assistant-ui/react';

export function Thread({ empty }: { empty?: React.ReactNode }) {
  return (
    <ThreadPrimitive.Root>
      <Viewport>
        <ThreadPrimitive.Empty>{empty}</ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <UserRow>
      <UserBubble>
        <MessagePrimitive.Parts />
      </UserBubble>
    </UserRow>
  );
}

function AssistantMessage() {
  return (
    <AssistantRow>
      <AssistantBubble>
        <MessagePrimitive.Parts />
        <MessagePrimitive.Error>
          <ErrorBox>
            <ErrorPrimitive.Message />
          </ErrorBox>
        </MessagePrimitive.Error>
      </AssistantBubble>
    </AssistantRow>
  );
}

const Viewport = styled(ThreadPrimitive.Viewport)`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
`;
const UserRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;
const AssistantRow = styled.div`
  display: flex;
  justify-content: flex-start;
`;
const Bubble = styled.div`
  max-width: 85%;
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 14px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
`;
const UserBubble = styled(Bubble)`
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primaryText};
`;
const AssistantBubble = styled(Bubble)`
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
`;
const ErrorBox = styled.div`
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.dangerBg};
  color: ${({ theme }) => theme.colors.danger};
  font-size: 13px;
  line-height: 18px;
`;
