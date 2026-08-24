import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
/**
 * EIP-1193 钱包接入。不用 wagmi / Reown —— demo 追求依赖最少，
 * 且余额读取也走钱包 provider，因此不需要单独配置 RPC endpoint。
 */
import { BrowserProvider } from 'ethers6';
import { CHAIN_ID, CHAIN_NAME } from '@/config/env';

// window.ethereum 的最小类型声明，只覆盖本文件用到的部分。
interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export interface WalletState {
  hasWallet: boolean;
  address?: string;
  chainId?: number;
  isCorrectChain: boolean;
  provider?: BrowserProvider;
  connecting: boolean;
  lastError?: string;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
}

export const WalletContext = createContext<WalletState | undefined>(undefined);

// EIP-1193 标准错误码。
const ERR_USER_REJECTED = 4001;
const ERR_CHAIN_NOT_ADDED = 4902;

/** 从钱包返回的 16 进制 chainId 字符串解析成数字，非法值返回 undefined。 */
const parseChainId = (hex: unknown): number | undefined => {
  if (typeof hex !== 'string') return undefined;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : undefined;
};

/** 尝试从未知错误里提取 EIP-1193 code，取不到返回 undefined。 */
const errorCode = (err: unknown): number | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
};

const errorMessage = (err: unknown, fallback: string): string => {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const hasWallet = typeof window.ethereum !== 'undefined';
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  // 挂载时静默恢复已授权的账户和当前链，不弹钱包窗口。
  useEffect(() => {
    if (!window.ethereum) return;
    const eth = window.ethereum;

    (async () => {
      try {
        const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
        }
      } catch {
        // 静默恢复失败不影响后续手动连接，忽略即可。
      }
      try {
        const hex = await eth.request({ method: 'eth_chainId' });
        setChainId(parseChainId(hex));
      } catch {
        // 忽略，等待 chainChanged 事件或用户手动连接。
      }
    })();
  }, []);

  // 监听账户与链切换。
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;

    const handleAccountsChanged = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      setAddress(accounts && accounts.length > 0 ? accounts[0] : undefined);
    };
    const handleChainChanged = (...args: never[]) => {
      const hex = args[0] as unknown as string;
      setChainId(parseChainId(hex));
    };

    eth.on('accountsChanged', handleAccountsChanged);
    eth.on('chainChanged', handleChainChanged);

    return () => {
      eth.removeListener?.('accountsChanged', handleAccountsChanged);
      eth.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) return;
    setConnecting(true);
    setLastError(undefined);
    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      setAddress(accounts && accounts.length > 0 ? accounts[0] : undefined);
    } catch (err) {
      const code = errorCode(err);
      if (code === ERR_USER_REJECTED) {
        setLastError('已取消连接');
      } else {
        setLastError(errorMessage(err, '连接钱包失败'));
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchChain = useCallback(async () => {
    if (!window.ethereum) return;
    setLastError(undefined);
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + CHAIN_ID.toString(16) }],
      });
    } catch (err) {
      const code = errorCode(err);
      if (code === ERR_CHAIN_NOT_ADDED) {
        // wallet_addEthereumChain 必须传非空 rpcUrls，而 demo 未配置 RPC endpoint，
        // 因此这里不实现自动添加链，改为提示用户手动添加。
        setLastError(`请在钱包里手动添加 ${CHAIN_NAME} 网络`);
      } else if (code === ERR_USER_REJECTED) {
        setLastError('已取消切换网络');
      } else {
        setLastError(errorMessage(err, '切换网络失败'));
      }
    }
  }, []);

  // 链切换后必须重建 provider，否则 ethers 缓存的 network 信息会过期。
  const provider = useMemo(
    () => (window.ethereum ? new BrowserProvider(window.ethereum) : undefined),
    [chainId],
  );

  const isCorrectChain = chainId === CHAIN_ID;

  const value: WalletState = {
    hasWallet,
    address,
    chainId,
    isCorrectChain,
    provider,
    connecting,
    lastError,
    connect,
    switchChain,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
