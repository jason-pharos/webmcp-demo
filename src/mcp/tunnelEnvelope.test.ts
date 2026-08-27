import { describe, it, expect } from 'vitest';
import { makeEnvelope, matchEnvelope, TAB_CHANNEL_ID } from './tunnelEnvelope';

describe('makeEnvelope', () => {
  it('产出 v4 TabServerTransport 认得的四个字段', () => {
    expect(makeEnvelope('ch', 'client-to-server', { jsonrpc: '2.0' })).toEqual({
      channel: 'ch',
      type: 'mcp',
      direction: 'client-to-server',
      payload: { jsonrpc: '2.0' },
    });
  });

  it('控制字符串原样放进 payload，不做包装', () => {
    expect(makeEnvelope('ch', 'client-to-server', 'mcp-check-ready').payload).toBe(
      'mcp-check-ready'
    );
  });
});

describe('matchEnvelope', () => {
  const ok = makeEnvelope(TAB_CHANNEL_ID, 'server-to-client', { a: 1 });

  it('四个字段全中才算匹配', () => {
    expect(matchEnvelope(ok, TAB_CHANNEL_ID, 'server-to-client')).toBe(true);
  });

  it('channel 不同 → 不匹配（这是隧道与 tab channel 不串台的唯一保证）', () => {
    expect(matchEnvelope(ok, 'other-channel', 'server-to-client')).toBe(false);
  });

  it('方向不同 → 不匹配（哑转发靠它避免把自己发的消息又收回来，形成回环）', () => {
    expect(matchEnvelope(ok, TAB_CHANNEL_ID, 'client-to-server')).toBe(false);
  });

  it('type 不是 mcp → 不匹配', () => {
    expect(matchEnvelope({ ...ok, type: 'other' }, TAB_CHANNEL_ID, 'server-to-client')).toBe(false);
  });

  it('null / 字符串 / undefined 不会抛异常', () => {
    expect(matchEnvelope(null, TAB_CHANNEL_ID, 'server-to-client')).toBe(false);
    expect(matchEnvelope('nope', TAB_CHANNEL_ID, 'server-to-client')).toBe(false);
    expect(matchEnvelope(undefined, TAB_CHANNEL_ID, 'server-to-client')).toBe(false);
  });

  it('payload 为 false / 0 / null 时仍算匹配（不能用真值判断 payload 是否存在）', () => {
    for (const p of [false, 0, null]) {
      expect(matchEnvelope(makeEnvelope('ch', 'client-to-server', p), 'ch', 'client-to-server')).toBe(
        true
      );
    }
  });
});
