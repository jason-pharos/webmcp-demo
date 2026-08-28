/**
 * 服务器进程：一个端口同时干四件事 ——
 *   GET  /widget     由 vite（middleware mode）提供 iframe 页面，dev 下有 HMR
 *   WS   /tunnel     MCP 隧道，一个连接一个 session
 *   POST /api/chat   agent 跑在这里，SSE 回吐文本
 *   其余              交给 vite 处理（模块、HMR、静态资源）
 *
 * 宿主页面由另一个 vite dev server 提供（5273），与这里是**不同的 origin** ——
 * 这正是真实形状：widget 由 agent 服务商提供，嵌进客户的站点。跨 origin 是真跨，
 * postMessage 的 origin 校验会被真正执行。
 */

import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { WebSocketServer } from 'ws';
import { SessionRegistry } from './sessions.js';
import { streamChat } from './chat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8787;
const HOST_ORIGIN = 'http://localhost:5273';

const registry = new SessionRegistry();

const vite = await createViteServer({
  // 不读 vite.config.ts：那份配置是给宿主页面（5273）用的，里面也有一个
  // react() 插件。默认情况下 createViteServer 会加载根目录的 vite.config.ts
  // 并把它的 plugins 与这里内联的 plugins 拼接起来 —— 两个 react 插件会对
  // 同一个模块注入两次 react-refresh 引导代码，直接报 "inWebWorker /
  // $RefreshReg$ / $RefreshSig$ has already been declared"。这里要的是独立、
  // 自包含的 widget dev server，所以关掉 config 文件加载。
  configFile: false,
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  plugins: [react()],
  resolve: { alias: [{ find: '@', replacement: path.resolve(ROOT, 'src') }] },
  // 依赖预扫描只扫 widget 这一个入口。否则 vite 会扫遍整个仓库根目录下的所有
  // .html（包括 references/npm-packages-main 里那份 MCP-B v5 monorepo 的
  // 一堆示例页面），它们 import 的是 v5 的 @mcp-b/*，本仓库只装了 v4，扫描
  // 会失败并刷一屏报错。
  optimizeDeps: { entries: ['widget/index.html'] },
  // widget 页面要知道宿主 origin 才能做 postMessage 校验
  define: { __HOST_ORIGIN__: JSON.stringify(HOST_ORIGIN) },
});

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

  if (url === '/api/chat' && req.method === 'POST') {
    void handleChat(req, res);
    return;
  }

  if (url === '/widget' || url === '/widget/') {
    void (async () => {
      try {
        const template = await vite.transformIndexHtml(
          url,
          await import('node:fs/promises').then((fs) =>
            fs.readFile(path.join(ROOT, 'widget/index.html'), 'utf8')
          )
        );
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(template);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        res.writeHead(500).end(String(error));
      }
    })();
    return;
  }

  vite.middlewares(req, res);
});

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
  // 只有宿主页面里的 widget iframe 会调这个接口。最小实验里不做鉴权（见 README
  // 的安全边界），但仍然拒绝掉明显不属于本站的跨域请求。
  const origin = req.headers.origin;
  if (origin && origin !== `http://localhost:${PORT}`) {
    res.writeHead(403).end('forbidden origin');
    return;
  }

  let payload: { sessionId?: string; messages?: Array<{ role: string; content: string }> };
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400).end('invalid json');
    return;
  }

  const session = payload.sessionId ? registry.get(payload.sessionId) : undefined;
  if (!session) {
    // session 不在了，通常是宿主页面刷新过。给一个明确的错误，而不是让前端干等
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '与页面的连接已断开，请刷新宿主页面后重试。' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const abort = new AbortController();
  req.on('close', () => abort.abort());

  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const messages = (payload.messages ?? []).filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        m.role === 'user' || m.role === 'assistant'
    );
    for await (const text of streamChat({ session, messages, signal: abort.signal })) {
      send({ type: 'delta', text });
    }
    send({ type: 'done' });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
}

const wss = new WebSocketServer({ server, path: '/tunnel' });

wss.on('connection', (ws, req) => {
  // widget iframe 是本 origin 的页面，浏览器会带上 Origin 头。
  // 这不是鉴权（见 README 的安全边界），只是挡掉明显不对的来源。
  const origin = req.headers.origin;
  if (origin && origin !== `http://localhost:${PORT}`) {
    ws.close(1008, 'forbidden origin');
    return;
  }

  const sessionId = randomUUID();
  // session 帧必须早于 MCP 握手发出：widget 要先消费掉它再装隧道转发器，
  // 否则它会被转发进 tab channel，在宿主页面打出一条无意义的解析错误。
  ws.send(JSON.stringify({ type: 'session', sessionId }));

  void registry
    .create(
      {
        send: (data) => ws.send(data),
        close: () => ws.close(),
        onMessage: (fn) => ws.on('message', (raw) => fn(raw.toString())),
        onClose: (fn) => ws.on('close', fn),
      },
      sessionId
    )
    .then((session) => {
      console.log(
        `[server] session ${session.id} 就绪，页面提供 ${session.tools.length} 个工具：` +
          session.tools.map((t) => t.name).join(', ')
      );
    })
    .catch((error) => {
      console.error('[server] session 建立失败：', error);
      ws.close(1011, 'session setup failed');
    });

  ws.on('close', () => {
    console.log(`[server] session ${sessionId} 断开`);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] widget + agent  http://localhost:${PORT}/widget`);
  console.log(`[server] 宿主页面           ${HOST_ORIGIN}`);
});
