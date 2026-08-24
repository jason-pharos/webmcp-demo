import { useContext } from 'react';
import { WalletContext, type WalletState } from './WalletProvider';

/** 读取钱包状态，必须在 <WalletProvider> 内部使用。 */
export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet 必须在 <WalletProvider> 内部使用');
  }
  return ctx;
}
