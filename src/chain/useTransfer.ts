import { useCallback, useState } from 'react';
import { Contract, parseEther, parseUnits } from 'ethers6';
import { useWallet } from '@/wallet/useWallet';
import { ERC20_ABI, TOKENS, type TokenKey } from './tokens';

export interface TransferInput {
  token: TokenKey;
  to: string;
  amount: string;
}

export interface TransferState {
  transfer: (input: TransferInput) => Promise<string | null>;
  pending: boolean;
  lastError?: string;
}

// EIP-1193 用户拒签的标准 code / 部分钱包用字符串 code 表示同一含义。
const ERR_USER_REJECTED = 4001;
const ERR_USER_REJECTED_NAME = 'ACTION_REJECTED';

const errorCode = (err: unknown): number | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
};

const errorCodeName = (err: unknown): string | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
};

const errorMessage = (err: unknown): string => {
  if (typeof err === 'object' && err !== null) {
    const anyErr = err as { shortMessage?: unknown; message?: unknown };
    if (typeof anyErr.shortMessage === 'string' && anyErr.shortMessage) return anyErr.shortMessage;
    if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message;
  }
  return '转账失败';
};

/**
 * 发起转账（native 或 USDC）。
 *
 * 注意：这里只等交易被节点接受（拿到 tx.hash）就返回，不 await tx.wait()。
 * 这是有意取舍——工具调用（Task 5）不能被区块确认时间拖住，
 * 上链状态由用户自己去 explorer 上看。
 */
export function useTransfer(): TransferState {
  const { provider } = useWallet();
  const [pending, setPending] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  const transfer = useCallback(
    async ({ token, to, amount }: TransferInput): Promise<string | null> => {
      if (!provider) {
        setLastError('钱包未连接');
        return null;
      }

      setPending(true);
      setLastError(undefined);
      try {
        const signer = await provider.getSigner();
        const meta = TOKENS[token];

        if (meta.isNative) {
          const tx = await signer.sendTransaction({ to, value: parseEther(amount) });
          return tx.hash;
        }

        const contract = new Contract(meta.address as string, ERC20_ABI, signer);
        const tx = await contract.transfer(to, parseUnits(amount, meta.decimals));
        return tx.hash as string;
      } catch (err) {
        const code = errorCode(err);
        const codeName = errorCodeName(err);
        if (code === ERR_USER_REJECTED || codeName === ERR_USER_REJECTED_NAME) {
          setLastError('用户在钱包里拒绝了签名');
        } else {
          setLastError(errorMessage(err));
        }
        return null;
      } finally {
        setPending(false);
      }
    },
    [provider],
  );

  return { transfer, pending, lastError };
}
