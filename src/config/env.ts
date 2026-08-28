/**
 * 集中读取 VITE_ 环境变量，给出默认值。
 *
 * 这里只剩链相关配置，LLM 相关配置已移到服务器端（不带 VITE_ 前缀，见 server/chat.ts）。
 */

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const CHAIN_ID = num(import.meta.env.VITE_CHAIN_ID, 1672);
export const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || 'Pharos Mainnet';
export const NATIVE_SYMBOL = import.meta.env.VITE_NATIVE_SYMBOL || 'PROS';
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || 'https://www.pharosscan.xyz/';
export const USDC_ADDRESS =
  import.meta.env.VITE_USDC_ADDRESS || '0xC879C018dB60520F4355C26eD1a6D572cdAC1815';
export const USDC_DECIMALS = num(import.meta.env.VITE_USDC_DECIMALS, 6);

/** 交易详情页链接。EXPLORER_URL 可能带或不带结尾斜杠，这里统一处理。 */
export const txUrl = (hash: string): string =>
  `${EXPLORER_URL.replace(/\/$/, '')}/tx/${hash}`;
