/**
 * 服务器端 agent：streamText + tool-calling 循环。
 *
 * 从 src/ai/chatModel.ts 搬来。区别只有两点：
 * 1. 不再是 assistant-ui 的 ChatModelAdapter，而是一个 async generator，
 *    由 server/index.ts 包成 SSE 发给 iframe。
 * 2. API key 从 process.env 读，不带 VITE_ 前缀 —— 它再也不会进前端产物。
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, stepCountIs, APICallError, type ModelMessage } from 'ai';
import { mcpToolsToAiTools } from './mcpToolsToAiTools.js';
import type { Session } from './sessions.js';

export const SYSTEM_PROMPT = `You are the assistant embedded in a WebMCP demo page for a crypto wallet on the Pharos chain.

You can read the connected wallet's balances and initiate transfers, using the tools this page exposes. Always call a tool instead of guessing or making up numbers.

Rules:
- PROS is the chain's native token; USDC is an ERC20 contract. Never confuse the two, and never convert between them — they are different assets with no fixed rate.
- To transfer, call wallet_transfer with the token, the recipient address, and the amount. The recipient address must come explicitly from the user in this conversation — never invent, complete, or reuse an address from anywhere else. If the user has not given a full 0x address, ask for it.
- The user must confirm in a dialog and sign in their wallet, so you cannot complete a transfer on your own.
- Report the tool result honestly. status "declined" means the user cancelled — say so and do not retry. "blocked" or "failed" — explain the reason from the message field.
- Never invent a transaction hash. Only cite one that a tool returned.
- Stay on topic: this wallet's balances and transfers. Decline anything else politely.
- Do not give financial or investment advice.
- Be concise, and answer in the language the user used.`;

const MAX_STEPS = 5;

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

/**
 * 把 AI SDK / provider 抛出的错误转成给用户看的文案，不透传原始错误里可能带的
 * Authorization header / API key（APICallError.responseHeaders / requestBodyValues
 * 都可能包含这些）。非 APICallError 的情况（网络错误等）保留原始 message。
 */
export function toUserFacingError(error: unknown): Error {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new Error('LLM 鉴权失败，请检查配置的 API key');
    }
    return new Error(`LLM 请求失败（状态码 ${error.statusCode ?? 'unknown'}）`);
  }
  return error instanceof Error ? error : new Error('LLM 请求失败');
}

export async function* streamChat(opts: {
  session: Session;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
}): AsyncGenerator<string, void, unknown> {
  if (!LLM_API_KEY) {
    throw new Error('AI chat 未配置：请在 .env 里设置 LLM_API_KEY');
  }

  const provider = createOpenAICompatible({
    name: 'llm',
    baseURL: LLM_BASE_URL,
    apiKey: LLM_API_KEY,
  });

  const result = streamText({
    model: provider(LLM_MODEL),
    system: SYSTEM_PROMPT,
    messages: opts.messages as ModelMessage[],
    tools: mcpToolsToAiTools(opts.session.tools, opts.session.client),
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: opts.signal,
  });

  let text = '';
  // fullStream（不是 textStream）：textStream 只转发 text-delta，静默丢弃 error part——
  // 上游请求失败时（比如 401）循环会直接 0 次迭代收尾，什么都不抛，调用方看不出区别。
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text;
      yield text;
    } else if (part.type === 'error') {
      throw toUserFacingError(part.error);
    }
  }

  // 兜底二：有些失败不经过 stream 的 error part，而是直接 reject 掉结果的 promise
  // （比如整个请求在拿到第一个 chunk 之前就失败）。
  try {
    await result.finishReason;
  } catch (error) {
    throw toUserFacingError(error);
  }

  // 模型只调了工具、没产出文本时给个兜底，避免出现空气泡
  if (!text.trim()) {
    yield '完成 —— 详情见页面上的提示。';
  }
}
