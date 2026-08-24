/**
 * 右下角悬浮入口：控制抽屉开关。抽屉常挂载（用 transform 收起），
 * 保证关闭再打开时对话历史还在。
 */

import { useState } from 'react';
import styled from 'styled-components';
import { ChatDrawer } from './ChatDrawer';

export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Fab type="button" onClick={() => setOpen(o => !o)} aria-label="Open AI assistant">
        AI
      </Fab>
      <ChatDrawer open={open} onClose={() => setOpen(false)} />
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
