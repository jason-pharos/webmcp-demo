import { useState } from 'react';
import styled from 'styled-components';
import { useWallet } from '@/wallet/useWallet';
import { TOKENS, type TokenKey } from '@/chain/tokens';
import type { BalancesState } from '@/chain/useBalances';
import type { TransferState } from '@/chain/useTransfer';
import type { TransferConfirmState } from '@/chain/useTransferConfirm';
import { validateTransfer } from '@/chain/validateTransfer';
import { txUrl } from '@/config/env';

const Wrap = styled.div`
  margin: 24px 0;
  padding: 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h2`
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: ${({ theme }) => theme.font.medium};
  color: ${({ theme }) => theme.colors.text};
`;

const FieldRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
`;

const inputStyle = `
  padding: 8px 10px;
  border-radius: 8px;
`;

const Select = styled.select`
  ${inputStyle}
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const Input = styled.input`
  ${inputStyle}
  flex: 1;
  min-width: 200px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const AmountInput = styled(Input)`
  flex: none;
  min-width: 140px;
`;

const SubmitButton = styled.button`
  padding: 8px 16px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primaryText};
  font-size: 14px;
  font-weight: ${({ theme }) => theme.font.medium};
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const ErrorText = styled.p`
  margin: 8px 0 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
`;

const SuccessText = styled.p`
  margin: 8px 0 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};

  a {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const balanceOf = (balances: BalancesState, token: TokenKey): string | null =>
  token === 'PROS' ? balances.pros.balance : balances.usdc.balance;

export function TransferForm({
  balances,
  transfer,
  requestConfirm,
  lastError,
}: {
  balances: BalancesState;
  transfer: TransferState['transfer'];
  requestConfirm: TransferConfirmState['requestConfirm'];
  lastError?: string;
}) {
  const { address, isCorrectChain } = useWallet();
  const [token, setToken] = useState<TokenKey>('PROS');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [txHash, setTxHash] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setTxHash(undefined);

    const input = { token, to, amount };
    const result = validateTransfer(input, {
      connected: !!address,
      isCorrectChain,
      balance: balanceOf(balances, token),
    });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    // 从校验通过到拿到确认结果这段等待期也要进入禁用态，
    // 否则确认框还开着时再点一次提交，会把上一个 requestConfirm 的 promise 静默 resolve 成 false。
    setSubmitting(true);
    try {
      const ok = await requestConfirm({
        token,
        symbol: TOKENS[token].symbol,
        amount,
        to,
        balance: balanceOf(balances, token),
      });
      if (!ok) return;

      const hash = await transfer(input);
      if (hash) {
        setTxHash(hash);
        balances.refresh();
      } else {
        // transfer() 内部已经把具体原因记在 lastError 里（拒签 / RPC 错误等），
        // 优先展示这个原因，没有时才回退到通用文案。
        setError(lastError ?? '转账失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Wrap>
      <Title>转账</Title>
      <form onSubmit={handleSubmit}>
        <FieldRow>
          <Select value={token} onChange={(e) => setToken(e.target.value as TokenKey)}>
            <option value="PROS">{TOKENS.PROS.symbol}</option>
            <option value="USDC">{TOKENS.USDC.symbol}</option>
          </Select>
          <Input
            placeholder="收款地址 0x..."
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <AmountInput
            placeholder="金额"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <SubmitButton type="submit" disabled={submitting}>
            {submitting ? '处理中…' : '转账'}
          </SubmitButton>
        </FieldRow>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
      {txHash && (
        <SuccessText>
          已发出交易：
          <a href={txUrl(txHash)} target="_blank" rel="noreferrer">
            {txHash}
          </a>
        </SuccessText>
      )}
    </Wrap>
  );
}
