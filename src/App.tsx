import styled from 'styled-components';
import { McpClientProvider } from '@mcp-b/react-webmcp';
import { WalletProvider } from '@/wallet/WalletProvider';
import { useWallet } from '@/wallet/useWallet';
import { ConnectButton } from '@/components/ConnectButton';
import { useBalances } from '@/chain/useBalances';
import { BalanceCards } from '@/components/BalanceCards';
import { useTransfer } from '@/chain/useTransfer';
import { useTransferConfirm } from '@/chain/useTransferConfirm';
import { TransferForm } from '@/components/TransferForm';
import { TransferConfirmDialog } from '@/components/TransferConfirmDialog';
import { getMcpClient, getMcpTransport } from '@/mcp/mcpClient';
import { useWalletWebMcpTools } from '@/mcp/useWalletWebMcpTools';
import { McpStatus } from '@/components/McpStatus';
import { ChatLauncher } from '@/components/aiChat';

const Main = styled.main`
  max-width: 880px;
  margin: 0 auto;
  padding: 48px 24px;
`;

const Title = styled.h1`
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: ${({ theme }) => theme.font.medium};
  color: ${({ theme }) => theme.colors.text};
`;

const Description = styled.p`
  margin: 0 0 24px;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

// 抽成 Page 组件，因为 useBalances 依赖 useWallet，必须在 WalletProvider 内部调用；
// 同一份 balances / transfer / confirm 状态被手动表单与 WebMCP 工具共用。
function Page() {
  const { address, chainId, isCorrectChain } = useWallet();
  const balances = useBalances();
  const transfer = useTransfer();
  const confirm = useTransferConfirm();

  useWalletWebMcpTools({
    address,
    chainId,
    isCorrectChain,
    prosBalance: balances.pros.balance,
    usdcBalance: balances.usdc.balance,
    transfer: transfer.transfer,
    lastTransferError: transfer.lastError,
    requestConfirm: confirm.requestConfirm,
    refreshBalances: balances.refresh,
  });

  return (
    <Main>
      <Title>WebMCP Wallet Demo</Title>
      <Description>
        这是一个 WebMCP 能力暴露示例：宿主页面把余额查询与转账能力通过 WebMCP 暴露给页内 AI
        agent。跑法 / 工具契约 / 安全边界见项目根目录的 README.md。
      </Description>
      <McpStatus />
      <ConnectButton />
      <BalanceCards balances={balances} />
      <TransferForm
        balances={balances}
        transfer={transfer.transfer}
        requestConfirm={confirm.requestConfirm}
        lastError={transfer.lastError}
      />
      <TransferConfirmDialog confirm={confirm} />
      <ChatLauncher />
    </Main>
  );
}

function App() {
  return (
    <WalletProvider>
      <McpClientProvider client={getMcpClient()} transport={getMcpTransport()} opts={{}}>
        <Page />
      </McpClientProvider>
    </WalletProvider>
  );
}

export default App;
