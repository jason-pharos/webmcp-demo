/**
 * assistant-ui 的 ChatModelAdapter，但模型不在这里跑 —— 它跑在服务器端。
 * 这一层只负责：把消息 POST 出去，把 SSE 回吐的累计文本 yield 回 assistant-ui。
 *
 * 服务器发的是**累计**文本（不是增量片段），所以这里直接透传，不需要自己拼。
 */

import type { ChatModelAdapter, ThreadMessage } from '@assistant-ui/react';

/** 只取文本片段，与原 src/ai/chatModel.ts 的 toModelMessages 一致 */
const toPlainMessages = (messages: readonly ThreadMessage[]) => {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = m.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    if (!text) continue;
    out.push({ role: m.role, content: text });
  }
  return out;
};

export function createSseChatAdapter(getSessionId: () => string | null): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const sessionId = getSessionId();
      if (!sessionId) {
        throw new Error('与宿主页面的连接尚未建立，请稍候再试。');
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messages: toPlainMessages(messages) }),
        signal: abortSignal,
      });

      if (!res.ok) {
        // 409 = session 已失效（宿主页面刷新过），服务器在 body 里给了人话
        let message = `请求失败（${res.status}）`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // body 不是 JSON 就用上面的兜底文案
        }
        throw new Error(message);
      }
      if (!res.body) throw new Error('服务器没有返回响应体');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以空行分隔；最后一段可能不完整，留在 buffer 里等下一轮
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;

          const event = JSON.parse(line.slice(6)) as
            | { type: 'delta'; text: string }
            | { type: 'error'; message: string }
            | { type: 'done' };

          if (event.type === 'delta') {
            yield { content: [{ type: 'text' as const, text: event.text }] };
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else {
            return;
          }
        }
      }
    },
  };
}
