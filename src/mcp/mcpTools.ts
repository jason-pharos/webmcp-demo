/**
 * 把页内 MCP server 暴露的工具（JSON Schema）转成 AI SDK 的 ToolSet，
 * execute 内部走 mcpClient.callTool 回到 useWebMCP 的 handler。
 *
 * execute 不抛异常：失败也返回 { error } 交给模型转述，避免一次工具失败
 * 把整轮对话打断。
 */

import { jsonSchema, type ToolSet } from 'ai';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';

/** MCP 结果里没有 structuredContent 时，把 content 里的 text 片段拼起来 */
const textOf = (content: unknown): string => {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      part && typeof part === 'object' && 'text' in part
        ? String((part as { text: unknown }).text)
        : ''
    )
    .filter(Boolean)
    .join('\n');
};

export function mcpToolsToAiTools(tools: McpTool[], client: Client): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = {
      description: t.description ?? '',
      inputSchema: jsonSchema(
        (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
      ),
      execute: async (args: unknown) => {
        try {
          const res = await client.callTool({
            name: t.name,
            arguments: (args ?? {}) as Record<string, unknown>,
          });
          return res.structuredContent ?? textOf(res.content) ?? {};
        } catch (e) {
          console.error(`[webmcp-demo] tool ${t.name} failed`, e);
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    };
  }
  return set;
}
