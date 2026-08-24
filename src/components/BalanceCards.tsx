import styled from 'styled-components';
import { TOKENS } from '@/chain/tokens';
import type { BalancesState, TokenBalance } from '@/chain/useBalances';

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin: 24px 0;
`;

const Card = styled.div`
  padding: 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Symbol = styled.span`
  font-size: 14px;
  font-weight: ${({ theme }) => theme.font.medium};
  color: ${({ theme }) => theme.colors.textMuted};
`;

const RefreshButton = styled.button`
  padding: 2px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const Value = styled.div`
  margin-top: 8px;
  font-size: 22px;
  font-weight: ${({ theme }) => theme.font.medium};
  color: ${({ theme }) => theme.colors.text};
`;

const AddressHint = styled.p`
  margin: 6px 0 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const ErrorText = styled.p`
  margin: 8px 0 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger};
`;

/** 地址缩略显示：0x1234…abcd。 */
const shortenAddress = (addr: string): string => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function TokenCard({
  balance,
  loading,
  addressHint,
}: {
  balance: TokenBalance;
  loading: boolean;
  addressHint?: string;
}) {
  return (
    <Card>
      <Header>
        <Symbol>{balance.symbol}</Symbol>
      </Header>
      <Value>{loading ? '读取中…' : balance.balance ?? '--'}</Value>
      {addressHint && <AddressHint>{shortenAddress(addressHint)}</AddressHint>}
    </Card>
  );
}

export function BalanceCards({ balances }: { balances: BalancesState }) {
  const { pros, usdc, loading, error, refresh } = balances;

  return (
    <div>
      <Header>
        <Symbol>余额</Symbol>
        <RefreshButton onClick={refresh} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </RefreshButton>
      </Header>
      <Grid>
        <TokenCard balance={pros} loading={loading} />
        <TokenCard balance={usdc} loading={loading} addressHint={TOKENS.USDC.address} />
      </Grid>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
