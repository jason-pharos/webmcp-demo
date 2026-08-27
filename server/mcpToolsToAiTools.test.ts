import { describe, it, expect, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { mcpToolsToAiTools, TOOL_CALL_TIMEOUT_MS } from './mcpToolsToAiTools';

const tool: McpTool = {
  name: 'wallet_transfer',
  description: '转账',
  inputSchema: { type: 'object', properties: {} },
};

describe('mcpToolsToAiTools', () => {
  it('execute 把 timeout 作为 callTool 的第三个参数原样传下去', async () => {
    // 这是本文件最重要的不变量：wallet_transfer 要等用户点确认弹窗 + 在钱包
    // 里签名，漏传 timeout 会让 SDK 默认的 60s 提前把请求判定为超时——那时
    // 用户签名可能已经给出去了。这条测试钉住这个第三参数不被悄悄漏掉或挪位。
    const callTool = vi.fn().mockResolvedValue({ structuredContent: { ok: true } });
    const client = { callTool } as unknown as Client;

    const toolSet = mcpToolsToAiTools([tool], client);
    await toolSet[tool.name].execute!({ to: '0xabc', amount: '1' }, {} as never);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool.mock.calls[0][2]).toEqual({ timeout: TOOL_CALL_TIMEOUT_MS });
  });

  it('callTool 失败时 execute 返回 { error }，不抛异常', async () => {
    // 生产代码里这条失败路径会 console.error 一份堆栈（这是对的，方便排查）；
    // 测试里把它静音，不然一次预期内的失败会在通过的测试输出里打印堆栈，
    // 让真正的失败更难从输出里被看见。
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const callTool = vi.fn().mockRejectedValue(new Error('用户拒绝了签名'));
      const client = { callTool } as unknown as Client;

      const toolSet = mcpToolsToAiTools([tool], client);
      const result = await toolSet[tool.name].execute!({}, {} as never);

      expect(result).toEqual({ error: '用户拒绝了签名' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
