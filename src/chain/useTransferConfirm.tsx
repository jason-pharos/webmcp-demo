import { useCallback, useRef, useState } from 'react';
import type { TokenKey } from './tokens';

export interface TransferConfirmRequest {
  token: TokenKey;
  symbol: string;
  amount: string;
  to: string;
  balance: string | null;
}

export interface TransferConfirmState {
  request?: TransferConfirmRequest;
  requestConfirm: (req: TransferConfirmRequest) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

/**
 * 转账前的人工确认闸门：手动表单与（Task 5）工具 handler 都要先弹这个确认框，
 * 拿到 true 才能真正调用 useTransfer().transfer()。
 *
 * 同一时刻只允许一个待确认请求——若已有未 resolve 的 promise，
 * 新请求进来时先把旧的 resolve(false) 掉，避免旧 promise 永挂。
 */
export function useTransferConfirm(): TransferConfirmState {
  const [request, setRequest] = useState<TransferConfirmRequest | undefined>(undefined);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const resolve = useCallback((ok: boolean) => {
    setRequest(undefined);
    resolverRef.current?.(ok);
    resolverRef.current = null;
  }, []);

  const requestConfirm = useCallback(
    (req: TransferConfirmRequest) => {
      if (resolverRef.current) {
        // 已有未决请求，视为取消旧的再接受新的。
        resolve(false);
      }
      setRequest(req);
      return new Promise<boolean>((res) => {
        resolverRef.current = res;
      });
    },
    [resolve],
  );

  return { request, requestConfirm, resolve };
}
