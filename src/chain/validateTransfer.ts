import { isAddress } from 'ethers6';
import { CHAIN_NAME } from '@/config/env';
import { TOKENS } from './tokens';
import type { TransferInput } from './useTransfer';

export interface ValidateContext {
  connected: boolean;
  isCorrectChain: boolean;
  balance: string | null; // 该 token 的可读余额
}

export type ValidateResult = { ok: true } | { ok: false; status: 'failed' | 'blocked'; message: string };

/**
 * 转账前的闸门校验，手动表单（TransferForm）与 Task 5 的工具 handler 共用同一份逻辑，
 * 避免两处各写一套导致行为不一致。
 *
 * 校验顺序（spec §4.2）：
 * 未连钱包 → 链不对 → 地址非法 → 金额非法 → 超余额。
 */
export function validateTransfer(input: TransferInput, ctx: ValidateContext): ValidateResult {
  if (!ctx.connected) {
    return { ok: false, status: 'failed', message: '请先连接钱包' };
  }

  if (!ctx.isCorrectChain) {
    return { ok: false, status: 'blocked', message: `请切换到 ${CHAIN_NAME}` };
  }

  if (!isAddress(input.to)) {
    return { ok: false, status: 'failed', message: '收款地址不是合法的 0x 地址' };
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 'failed', message: '转账金额必须是正数' };
  }

  const balance = ctx.balance !== null ? Number(ctx.balance) : null;
  if (balance !== null && amount > balance) {
    const meta = TOKENS[input.token];
    const message = meta.isNative
      ? '余额不足（原生代币转账还需要留一点余额付 gas）'
      : '余额不足';
    return { ok: false, status: 'failed', message };
  }

  return { ok: true };
}
