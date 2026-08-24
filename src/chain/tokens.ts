import { NATIVE_SYMBOL, USDC_ADDRESS, USDC_DECIMALS } from '@/config/env';

export type TokenKey = 'PROS' | 'USDC';

export interface TokenMeta {
  key: TokenKey;
  symbol: string;
  decimals: number;
  isNative: boolean;
  address?: string;
}

/**
 * PROS 是原生代币，走 provider.getBalance；USDC 是 ERC20，走合约 balanceOf。
 * 地址 / decimals 统一从 @/config/env 读取，不在这里硬编码。
 */
export const TOKENS: Record<TokenKey, TokenMeta> = {
  PROS: { key: 'PROS', symbol: NATIVE_SYMBOL, decimals: 18, isNative: true },
  USDC: {
    key: 'USDC',
    symbol: 'USDC',
    decimals: USDC_DECIMALS,
    isNative: false,
    address: USDC_ADDRESS,
  },
};

// human-readable ABI（ethers6 支持）。只放这次 demo 用到的两个方法：
// balanceOf 用于余额读取，transfer 留给 Task 4 转账用；decimals 走 env，不额外调链上。
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
];
