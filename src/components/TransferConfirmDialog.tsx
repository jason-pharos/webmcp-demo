import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import type { TransferConfirmState } from '@/chain/useTransferConfirm';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Card = styled.div`
  width: min(420px, calc(100vw - 32px));
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.radius.lg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 24px;
`;

const Title = styled.h2`
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: ${({ theme }) => theme.font.medium};
  color: ${({ theme }) => theme.colors.text};
`;

const Amount = styled.div`
  font-size: 26px;
  font-weight: ${({ theme }) => theme.font.medium};
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 16px;
`;

const Field = styled.div`
  margin-bottom: 12px;
`;

const FieldLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textMuted};
  margin-bottom: 4px;
`;

// 收款地址必须显示全文、可换行、等宽字体——这是防钓鱼的关键，不能为了美观缩略。
const AddressValue = styled.div`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  word-break: break-all;
  white-space: pre-wrap;
`;

const BalanceValue = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const SignHint = styled.p`
  margin: 12px 0 20px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const ButtonRow = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`;

const CancelButton = styled.button`
  padding: 8px 16px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  cursor: pointer;
`;

const ConfirmButton = styled.button`
  padding: 8px 16px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: none;
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primaryText};
  font-size: 14px;
  font-weight: ${({ theme }) => theme.font.medium};
  cursor: pointer;
`;

export function TransferConfirmDialog({ confirm }: { confirm: TransferConfirmState }) {
  const { request, resolve } = confirm;

  // ESC 等同取消。
  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolve(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [request, resolve]);

  if (!request) return null;

  return createPortal(
    <Overlay onMouseDown={() => resolve(false)}>
      <Card onMouseDown={(e) => e.stopPropagation()}>
        <Title>确认转账</Title>
        <Amount>
          {request.amount} {request.symbol}
        </Amount>
        <Field>
          <FieldLabel>收款地址</FieldLabel>
          <AddressValue>{request.to}</AddressValue>
        </Field>
        <Field>
          <FieldLabel>当前余额</FieldLabel>
          <BalanceValue>
            {request.balance ?? '--'} {request.symbol}
          </BalanceValue>
        </Field>
        <SignHint>点击确认后需要在钱包里签名。</SignHint>
        <ButtonRow>
          <CancelButton onClick={() => resolve(false)}>取消</CancelButton>
          <ConfirmButton onClick={() => resolve(true)}>确认</ConfirmButton>
        </ButtonRow>
      </Card>
    </Overlay>,
    document.body,
  );
}
