/**
 * 输入区：assistant-ui ComposerPrimitive + 项目主题皮肤。
 * Enter 发送、Shift+Enter 换行（primitive 默认行为）。
 */

import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ComposerPrimitive } from '@assistant-ui/react';

export function Composer({ focus }: { focus: boolean }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // ChatDrawer 常驻挂载（只用 transform 收起，为了保留对话历史），所以不能用无条件的
  // autoFocus——那会在页面刚加载、用户还没点开抽屉时，就把键盘焦点抢到这个屏幕外的
  // 输入框上，打断页面正常的初始焦点与 tab 顺序。改成抽屉打开时才主动 focus。
  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus]);

  return (
    <Root>
      <Input ref={inputRef} placeholder="问余额，或让我帮你转账…" />
      <Send>Send</Send>
    </Root>
  );
}

const Root = styled(ComposerPrimitive.Root)`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;
const Input = styled(ComposerPrimitive.Input)`
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  resize: none;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  color: ${({ theme }) => theme.colors.text};
  outline: none;
  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;
const Send = styled(ComposerPrimitive.Send)`
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primaryText};
  font-family: ${({ theme }) => theme.font.body};
  font-weight: ${({ theme }) => theme.font.medium};
  font-size: 14px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
