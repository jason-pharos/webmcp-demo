import styled from 'styled-components';
import { CHAIN_NAME } from '@/config/env';
import { useWallet } from '@/wallet/useWallet';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Button = styled.button`
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

const Hint = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const AccountBadge = styled.span`
  padding: 6px 12px;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const ChainBadge = styled.span<{ $ok: boolean }>`
  font-size: 13px;
  color: ${({ theme, $ok }) => ($ok ? theme.colors.textMuted : theme.colors.warning)};
`;

const ErrorText = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
`;

/** 地址缩略显示：0x1234…abcd。 */
const shortenAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export function ConnectButton() {
  const { hasWallet, address, isCorrectChain, connecting, lastError, connect, switchChain } =
    useWallet();

  if (!hasWallet) {
    return (
      <Wrap>
        <Hint>未检测到浏览器钱包，请安装 MetaMask 或 OKX Wallet 后重试。</Hint>
      </Wrap>
    );
  }

  if (!address) {
    return (
      <Wrap>
        <Button onClick={connect} disabled={connecting}>
          {connecting ? '连接中…' : '连接钱包'}
        </Button>
        {lastError && <ErrorText>{lastError}</ErrorText>}
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Row>
        <AccountBadge>{shortenAddress(address)}</AccountBadge>
        <ChainBadge $ok={isCorrectChain}>{isCorrectChain ? CHAIN_NAME : '网络不正确'}</ChainBadge>
        {!isCorrectChain && <Button onClick={switchChain}>切换到 {CHAIN_NAME}</Button>}
      </Row>
      {lastError && <ErrorText>{lastError}</ErrorText>}
    </Wrap>
  );
}
