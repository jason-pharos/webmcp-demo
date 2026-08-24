/**
 * 示例问题 chips。点击只把文字填进输入框，不自动发送 —— 让用户能先改金额再发。
 */

import styled from 'styled-components';

export const SAMPLE_PROMPTS = [
  '我现在有多少 PROS 和 USDC？',
  '帮我转 0.0001 PROS 给 0x…（填你的收款地址）',
  '这个页面暴露了哪些工具？',
] as const;

export function SamplePrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <Wrap>
      {SAMPLE_PROMPTS.map(p => (
        <Chip key={p} type="button" onClick={() => onPick(p)}>
          {p}
        </Chip>
      ))}
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;
const Chip = styled.button`
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
  }
`;
