/**
 * 把宿主页面既有的钱包能力（查余额、转账）注册为 WebMCP 工具，
 * 供页内 AI agent（以及任何连到 document.modelContext 的 MCP 客户端）调用。
 *
 * 安全边界：
 * - wallet_get_balances 是纯只读（readOnlyHint），不接受任意地址参数，只读当前连接的钱包。
 * - wallet_transfer 是本 demo 唯一的写操作：先复用 Task 4 的 validateTransfer 做本地校验，
 *   再弹确认框等用户点击，最后才走 useTransfer().transfer() → 钱包签名。模型无法绕过
 *   「确认框 + 钱包签名」这两道人工闸门。
 * - 工具注册在 document.modelContext 上（@mcp-b/global），同一个 tab 内任何连接到这个
 *   channel 的 MCP 客户端都能看到并调用这些工具 —— 包括同 tab 的 MCP-B 浏览器扩展，
 *   无法做到「只对页内 chat 开放」。
 */

import { useWebMCP } from '@mcp-b/react-webmcp';
import { CHAIN_NAME } from '@/config/env';
import { TOKENS, type TokenKey } from '@/chain/tokens';
import { validateTransfer } from '@/chain/validateTransfer';
import type { TransferInput } from '@/chain/useTransfer';
import type { TransferConfirmRequest } from '@/chain/useTransferConfirm';
import { txUrl } from '@/config/env';

export interface WalletWebMcpToolsDeps {
  address?: string;
  chainId?: number;
  isCorrectChain: boolean;
  prosBalance: string | null;
  usdcBalance: string | null;
  transfer: (input: TransferInput) => Promise<string | null>;
  lastTransferError?: string;
  requestConfirm: (req: TransferConfirmRequest) => Promise<boolean>;
  refreshBalances: () => void;
}

export function useWalletWebMcpTools(deps: WalletWebMcpToolsDeps): void {
  const {
    address,
    chainId,
    isCorrectChain,
    prosBalance,
    usdcBalance,
    transfer,
    lastTransferError,
    requestConfirm,
    refreshBalances,
  } = deps;

  // ---- 工具 1：查余额（只读）----
  useWebMCP(
    {
      name: 'wallet_get_balances',
      description:
        "Get the connected wallet's balances on Pharos: native PROS and USDC. Takes no arguments — it always reads the currently connected wallet, and cannot query an arbitrary address.",
      inputSchema: {},
      annotations: { title: 'Get wallet balances', readOnlyHint: true },
      outputSchema: {
        type: 'object',
        properties: {
          connected: { type: 'boolean', description: 'Whether a wallet is connected' },
          address: { type: 'string' },
          chainId: { type: 'number' },
          chainName: { type: 'string' },
          correctChain: { type: 'boolean', description: 'Whether the wallet is on the expected chain' },
          pros: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              balance: { type: 'string', description: 'Human-readable amount; null when it could not be read' },
            },
          },
          usdc: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              balance: { type: 'string' },
              address: { type: 'string', description: 'ERC20 contract address' },
            },
          },
        },
        required: ['connected'],
      } as const,
      handler: () => {
        if (!address) return { connected: false as const };
        return {
          connected: true as const,
          address,
          chainId,
          chainName: CHAIN_NAME,
          correctChain: isCorrectChain,
          pros: { symbol: TOKENS.PROS.symbol, balance: prosBalance ?? undefined },
          usdc: { symbol: TOKENS.USDC.symbol, balance: usdcBalance ?? undefined, address: TOKENS.USDC.address },
        };
      },
    },
    [address, chainId, isCorrectChain, prosBalance, usdcBalance]
  );

  // ---- 工具 2：转账（写，需用户确认 + 钱包签名）----
  useWebMCP(
    {
      name: 'wallet_transfer',
      description:
        "Transfer native PROS or USDC from the connected wallet on Pharos. The recipient address must be given explicitly by the user — never guess, complete, or reuse an address from elsewhere. The user must confirm in a dialog and then sign in their wallet, so you cannot complete a transfer on your own. Always report the status and message from the result.",
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', enum: ['PROS', 'USDC'], description: 'PROS is the native token; USDC is an ERC20' },
          to: { type: 'string', description: 'Recipient 0x address, exactly as given by the user' },
          amount: { type: 'string', description: 'Human-readable amount in that token, e.g. "0.1"' },
        },
        required: ['token', 'to', 'amount'],
      } as const,
      annotations: { title: 'Transfer tokens', readOnlyHint: false, destructiveHint: true },
      outputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              "One of: 'submitted' (tx sent), 'declined' (user cancelled the dialog), 'rejected' (user rejected the wallet signature or the tx failed), 'blocked' (not allowed right now), 'failed' (validation error)",
          },
          token: { type: 'string' },
          amount: { type: 'string' },
          to: { type: 'string' },
          txHash: { type: 'string' },
          explorerUrl: { type: 'string' },
          message: {
            type: 'string',
            description:
              "Human-readable status explanation. On 'submitted', notes that the balance refresh only waits for the tx to be sent, not for on-chain confirmation, so a balance re-query right after may still show pre-transfer numbers.",
          },
        },
        required: ['status', 'message'],
      } as const,
      handler: async ({ token, to, amount }) => {
        const key = token as TokenKey;
        const meta = TOKENS[key];
        const balance = key === 'PROS' ? prosBalance : usdcBalance;
        // 入参规范化只做一次，后面所有使用点（校验 / 确认框 / 发交易 / 返回值）都用这两个常量，
        // 避免同一个表达式散落多处、将来改一处漏一处。
        const toAddress = String(to ?? '').trim();
        const amountText = String(amount ?? '').trim();

        // 校验复用 Task 4 的 validateTransfer，不在这里重写一遍闸门逻辑。
        const v = validateTransfer(
          { token: key, to: toAddress, amount: amountText },
          { connected: Boolean(address), isCorrectChain, balance }
        );
        if (!v.ok)
          return { status: v.status, token: key, amount: amountText, to: toAddress, message: v.message };

        const confirmed = await requestConfirm({
          token: key,
          symbol: meta.symbol,
          amount: amountText,
          to: toAddress,
          balance,
        });
        if (!confirmed) {
          return {
            status: 'declined',
            token: key,
            amount: amountText,
            to: toAddress,
            message: '用户在确认框里取消了这笔转账。除非用户再次要求，不要重试。',
          };
        }

        const txHash = await transfer({ token: key, to: toAddress, amount: amountText });
        if (!txHash) {
          // lastTransferError 是渲染时的快照，可能落后一拍；读到 undefined 时用兜底文案。
          return {
            status: 'rejected',
            token: key,
            amount: amountText,
            to: toAddress,
            message: lastTransferError ?? '转账没有完成：用户拒签或交易失败。',
          };
        }
        // 只等 tx.hash（交易已发出），不等 receipt（上链确认）；refreshBalances()
        // 之后立刻查到的余额可能还是转账前的数，所以在 message 里明确提醒模型
        // 不要把这次刷新当成「已确认」的真值。
        refreshBalances();
        return {
          status: 'submitted',
          token: key,
          amount: amountText,
          to: toAddress,
          txHash,
          explorerUrl: txUrl(txHash),
          message: `已发出 ${amountText} ${meta.symbol} 转账，交易哈希 ${txHash}。余额更新可能有延迟（本 demo 只等交易发出、不等上链确认）。`,
        };
      },
    },
    [address, chainId, isCorrectChain, prosBalance, usdcBalance, transfer, lastTransferError, requestConfirm, refreshBalances]
  );
}
