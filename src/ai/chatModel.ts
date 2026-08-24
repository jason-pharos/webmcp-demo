/**
 * OpenAI 兼容协议（LLM_BASE_URL / LLM_MODEL / LLM_API_KEY 均来自 env）→
 * assistant-ui ChatModelAdapter 适配器。
 *
 * ⚠️ 浏览器直连，API key 来自 VITE_ 变量、会打进产物。仅 demo 用。
 *
 * tool-calling 循环由 AI SDK 的多步机制（stopWhen: stepCountIs）驱动：
 * 模型发 tool call → execute → 结果回灌 → 模型继续说话。
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, stepCountIs, APICallError, type ModelMessage, type ToolSet } from 'ai';
import type { ChatModelAdapter, ThreadMessage } from '@assistant-ui/react';
import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from '@/config/env';

const SYSTEM_PROMPT = `You are the assistant embedded in a WebMCP demo page for a crypto wallet on the Pharos chain.

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

/** 把 assistant-ui 的 ThreadMessage[] 转成 AI SDK 的 ModelMessage[]（只取文本片段） */
const toModelMessages = (messages: readonly ThreadMessage[]): ModelMessage[] => {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = m.content
      .map(part => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    if (!text) continue;
    out.push({ role: m.role, content: text });
  }
  return out;
};

export function createChatAdapter(getTools: () => ToolSet): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      if (!LLM_API_KEY) {
        throw new Error('AI chat 未配置：请在 .env 里设置 VITE_LLM_API_KEY');
      }

      const provider = createOpenAICompatible({
        name: 'llm',
        baseURL: LLM_BASE_URL,
        apiKey: LLM_API_KEY,
      });

      const result = streamText({
        model: provider(LLM_MODEL),
        system: SYSTEM_PROMPT,
        messages: toModelMessages(messages),
        tools: getTools(),
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal,
      });

      let text = '';
      // fullStream（不是 textStream）：textStream 只转发 text-delta，静默丢弃 error part——
      // 上游请求失败时（比如 401）循环会直接 0 次迭代收尾，什么都不抛，调用方看不出区别。
      // 下面两处 throw 会直接跳出这个 generator（不会走到循环之后的代码），所以走到
      // 循环外面、没抛异常，就意味着这一轮真的没出错——不需要额外的「见过错误」标记。
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          text += part.text;
          yield { content: [{ type: 'text' as const, text }] };
        } else if (part.type === 'error') {
          throw toUserFacingError(part.error);
        }
      }

      // 兜底二：有些失败不经过 stream 的 error part，而是直接 reject 掉结果的 promise
      // （比如整个请求在拿到第一个 chunk 之前就失败）。stream 循环已经消费完了，这里
      // 再 await 一次终态 promise，失败会在这里抛出来，而不是被当成「成功但没文本」。
      try {
        await result.finishReason;
      } catch (error) {
        throw toUserFacingError(error);
      }

      // 模型只调了工具、没产出文本时给个兜底，避免出现空气泡——能走到这里说明上面
      // 两道错误检查都没抛，这一轮是真的没出错，才适合说这种听起来像成功的话。
      if (!text.trim()) {
        yield {
          content: [
            {
              type: 'text' as const,
              text: '完成 —— 详情见页面上的提示。',
            },
          ],
        };
      }
    },
  };
}

/**
 * 把 AI SDK / provider 抛出的错误转成给用户看的文案，不透传原始错误里可能带的
 * Authorization header / API key（APICallError.responseHeaders / requestBodyValues
 * 都可能包含这些）。非 APICallError 的情况（网络错误等）保留原始 message，
 * 因为那类错误一般不带敏感字段，且 message 本身对排查更有用。
 */
function toUserFacingError(error: unknown): Error {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new Error('LLM 鉴权失败，请检查配置的 API key');
    }
    return new Error(`LLM 请求失败（状态码 ${error.statusCode ?? 'unknown'}）`);
  }
  return error instanceof Error ? error : new Error('LLM 请求失败');
}
