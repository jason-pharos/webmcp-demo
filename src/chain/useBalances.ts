import { useCallback, useEffect, useState } from 'react';
import { Contract, formatUnits } from 'ethers6';
import { useWallet } from '@/wallet/useWallet';
import { ERC20_ABI, TOKENS } from './tokens';

export interface TokenBalance {
  symbol: string;
  balance: string | null; // null = 读取失败或未就绪
}

export interface BalancesState {
  pros: TokenBalance;
  usdc: TokenBalance;
  loading: boolean;
  error?: string;
  refresh: () => void;
}

const idle = (symbol: string): TokenBalance => ({ symbol, balance: null });

/**
 * 读取 PROS（原生代币）与 USDC（ERC20）余额。
 * 依赖 useWallet 的 address / provider / isCorrectChain，三者任一缺失就不发请求。
 */
export function useBalances(): BalancesState {
  const { address, provider, isCorrectChain } = useWallet();
  const [pros, setPros] = useState<TokenBalance>(idle(TOKENS.PROS.symbol));
  const [usdc, setUsdc] = useState<TokenBalance>(idle(TOKENS.USDC.symbol));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // 三者任一缺失：直接回到未就绪态，不发请求。
    if (!address || !provider || !isCorrectChain) {
      setPros(idle(TOKENS.PROS.symbol));
      setUsdc(idle(TOKENS.USDC.symbol));
      setLoading(false);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    (async () => {
      const usdcContract = new Contract(TOKENS.USDC.address as string, ERC20_ABI, provider);
      const [prosResult, usdcResult] = await Promise.allSettled([
        provider.getBalance(address),
        usdcContract.balanceOf(address) as Promise<bigint>,
      ]);

      if (cancelled) return; // 竞态保护：依赖变化或卸载后丢弃迟到结果。

      if (prosResult.status === 'fulfilled') {
        setPros({ symbol: TOKENS.PROS.symbol, balance: formatUnits(prosResult.value, TOKENS.PROS.decimals) });
      } else {
        setPros(idle(TOKENS.PROS.symbol));
      }

      if (usdcResult.status === 'fulfilled') {
        setUsdc({ symbol: TOKENS.USDC.symbol, balance: formatUnits(usdcResult.value, TOKENS.USDC.decimals) });
      } else {
        setUsdc(idle(TOKENS.USDC.symbol));
      }

      const firstFailure = [prosResult, usdcResult].find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      if (firstFailure) {
        const reason = firstFailure.reason as { message?: unknown } | undefined;
        setError(typeof reason?.message === 'string' ? reason.message : '余额读取失败');
      }

      setLoading(false);
    })().catch((err: unknown) => {
      if (cancelled) return;
      const reason = err as { message?: unknown } | undefined;
      setPros(idle(TOKENS.PROS.symbol));
      setUsdc(idle(TOKENS.USDC.symbol));
      setError(typeof reason?.message === 'string' ? reason.message : '余额读取失败');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [address, provider, isCorrectChain, nonce]);

  return { pros, usdc, loading, error, refresh };
}
