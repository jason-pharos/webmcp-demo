# 把页面 WebMCP 工具接到服务器端 Agent —— 设计文档

日期：2026-08-27

## 目标

当前 demo 的 AI agent 跑在页面里。本次改造把 agent 搬到服务器端，让它仍然能调用**宿主页面**注册的 WebMCP 工具（`wallet_get_balances`、`wallet_transfer`）。中间由一个跨 origin 的 iframe widget 做桥梁。

成功标准：**最小可用链路打通**。端到端跑通一次——服务器端 agent 发现并调用页面工具，转账确认弹窗照常在宿主页面弹出。协议、鉴权、多会话都取最简。

## 背景：为什么 MCP-B 现成的包不够用

`references/npm-packages-main` 是 MCP-B 的 monorepo（v5.0.1）。调研结论：

**1. `@mcp-b/transports` 的 iframe transport 方向是反的。**

现有 4 对 transport：

| transport 对 | server 侧 | client 侧 |
|---|---|---|
| `TabServerTransport` / `TabClientTransport` | 同一个 window | 同一个 window |
| `IframeChildTransport` / `IframeParentTransport` | **iframe 里** | **宿主页面** |
| `ExtensionServerTransport` / `ExtensionClientTransport` | 页面 | 浏览器扩展 |

MCP-B 设想的 iframe 场景是「iframe 提供工具、宿主消费」（`@mcp-b/mcp-iframe` 的 `<mcp-iframe>` 自定义元素就是干这个：把子页面的工具加前缀挂到父页面的 `document.modelContext`）。我们要的是反过来：**宿主提供工具、iframe 里的 widget 消费**。

**2. `@mcp-b/global` 的 transport 选择写死，宿主页面挂不了第二个 transport。**

`packages/global/src/global.ts:95-111` 的 `createTransport()`：`window.parent !== window` 就用 `IframeChildTransport`，否则用 `TabServerTransport`，二选一。而且内部的 `BrowserMcpServer` 实例和 transport 是模块级私有（`let runtime`），只导出 `initializeWebModelContext` / `cleanupWebModelContext`。MCP SDK 的 `Server` 一个实例只能 `connect` 一个 transport。

结论：想让宿主页面「再挂一个面向 iframe 的 server transport」，绕不开 fork `@mcp-b/global`。

**3. `webmcp-local-relay` 形状对，但代价不对。**

`packages/webmcp-local-relay` 的架构正是「浏览器工具 → 服务器端 MCP」：页面 --postMessage--> 隐藏 blob iframe --WebSocket--> RelayBridgeServer --进程内--> LocalRelayMcpServer --stdio--> MCP 客户端。它的 widget 本身就是一个 iframe，职责是「postMessage 一端 + WebSocket 另一端」。

但它面向 localhost + stdio：`127.0.0.1` 绑定、端口扫描发现（`portStrategy.ts`）、server/client 双模式。更关键的是它**不传 MCP 协议**——`src/schemas.ts` 是一套自定义信封（`hello` / `tools/list` / `invoke` / `result` / `ping`），服务器侧用这些信息**重建**一个 MCP server（`mcpRelayServer.ts` 536 行 + `registry.ts` 332 行做多 tab 聚合与重名消歧）。代价是丢掉 MCP 原生语义（notifications、progress、`tools/list_changed`、resources/prompts），且要维护两套 schema。而云端真正需要的会话鉴权，它反而没有。

**4. 取巧点：MCP `Transport` 接口极小。**

`start()` / `send(msg)` / `close()` 加 `onmessage` / `onclose` / `onerror`，一共 6 个成员（`TabServerTransport.ts` 全文才 90 行）。所以可以**原样打隧道**：两端哑转发 JSON-RPC，服务器端自写一个 transport 交给官方 SDK 的 `Client`。约 180 行新代码，协议保真度反而比方案 3 更高。

### 方案选择

| 方案 | 描述 | 结论 |
|---|---|---|
| **A. 两跳哑转发 + JSON-RPC 原样打隧道** | 宿主与 iframe 都只转发字节，不理解 MCP；服务器端自写 WebSocket transport | **采用** |
| B. 镜像一对 transport | 写 `IframeHostServerTransport` + `IframeGuestClientTransport` | 否决：必须 fork `@mcp-b/global`，工作量翻倍，最小实验拿不到额外好处 |
| C. 抄 `webmcp-local-relay` 的自定义信封 | 服务器端重建 MCP server | 否决：约 2000 行要剥离 stdio/端口发现/双模式，两套 schema，丢 MCP 原生语义 |

A 在「最小可用」目标下同时是**最少代码**和**最高协议保真度**——两者通常互斥，这里不互斥的原因就是 `Transport` 接口本身极小。

B 是等这套东西产品化、且希望 iframe 内部也能本地用工具时才值得升级的形状。

## 1. 进程与拓扑

两个进程：

| 进程 | 端口 | 职责 |
|---|---|---|
| vite dev server | 5273 | **宿主页面**（现有 `src/`，扮演第三方站点） |
| Node 服务器 | 8787 | ① 提供 widget 页面 ② WebSocket 隧道端点 ③ `/api/chat` ④ **Agent 在这里跑** |

`<iframe src="http://localhost:8787/widget">`。widget 与 agent 同源，宿主是另一个 origin——这正是真实形状：widget 由 agent 服务商提供，嵌进客户的站点。跨 origin 是真跨，`postMessage` 的 origin 校验、`targetOrigin` 都会被真正执行。

widget 页面复用现有的 assistant-ui 聊天 UI（React），所以 Node 服务器用 `vite.createServer({ server: { middlewareMode: true } })` 挂载 widget 入口，dev 下有 HMR。这样避免起第三个 dev server，也避免手写一套无 React 的聊天 UI。

```
src/            宿主页面（现有，改动很小）
  mcp/hostTunnel.ts                  ← 新增：iframe ↔ tab channel 哑转发
widget/         iframe 页面（新增，复用 src/components/aiChat/*）
  main.tsx
  tunnel.ts                          ← WS ↔ parent postMessage 哑转发
  sseChatAdapter.ts                  ← 新的 ChatModelAdapter，走 SSE
server/         Node 进程（新增）
  index.ts                           ← http + ws + vite middleware
  WebSocketTunnelClientTransport.ts  ← MCP Transport 实现
  session.ts                         ← 一个 WS 连接 = 一个 MCP Client + 工具表
  chat.ts                            ← streamText + SSE
```

## 2. 浏览器侧的两跳转发

### 信封格式

tab channel 上的消息形状（`packages/transports/src/post-message.ts`）：

```ts
{ channel: channelId, type: 'mcp', direction: 'client-to-server' | 'server-to-client', payload }
```

`payload` 有**两类**，隧道必须原样透传两类，否则握手会挂：

- JSON-RPC 消息
- 三个控制字符串：`mcp-check-ready`（client→server）、`mcp-server-ready`、`mcp-server-stopped`（server→client）

### 宿主侧（`src/mcp/hostTunnel.ts`）

转发器就在同一个 window，天然满足 `TabServerTransport` 的 `event.source === window` 校验。

```
收 iframe.contentWindow 的 message，校验 event.origin === WIDGET_ORIGIN
  → postMcpMessage(window, location.origin, CHANNEL_ID, 'client-to-server', payload)

收 window 上 direction === 'server-to-client' 且 channel 匹配的 message
  → iframe.contentWindow.postMessage(同一个信封, WIDGET_ORIGIN)
```

两个方向靠 `direction` 区分，不会自己转给自己形成回环。转发器不解析 payload，控制字符串与 JSON-RPC 一视同仁。

### iframe 侧（`widget/tunnel.ts`）

- `ws.onmessage` → `parent.postMessage(信封, HOST_ORIGIN)`
- `window.onmessage`（校验 `event.origin === HOST_ORIGIN` 且 `event.source === parent`）→ `ws.send(payload)`

### 单会话取舍

tab channel 是**广播、无 session id** 的单会话通道。若宿主页面同时保留页内 MCP client，channel 上会有两个 client，`initialize` 打两次、响应互相可见，行为不可预测。因此：

- 宿主页面**移除**页内 MCP client（`src/mcp/mcpClient.ts`）与 `ChatDrawer`（聊天搬进 iframe）
- `McpStatus` 改为显示**隧道状态**（iframe 已连接 / WS 已连接 / 服务器已 listTools 到 N 个工具），数据来自转发器与 iframe 的 postMessage 回报，不再自己建 client
- `src/mcp/useWalletWebMcpTools.ts`（工具注册）保留，一行不改
- `src/mcp/mcpTools.ts`（MCP→AI SDK 转换）搬到服务器端复用，它本来就不依赖浏览器

代价：demo 不再演示「页内 chat」那条链路。它已在 git 历史里。要同时保留两条，就得给页内 client 和隧道各开一个 channel，而 `@mcp-b/global` 只挂一个 transport，绕不开 fork。

## 3. 服务器端 transport 与会话

### `WebSocketTunnelClientTransport implements Transport`

形状就是把 `TabClientTransport` 的 `postMessage` 换成 `ws.send`：

```
start()   → 监听 ws.message；发控制字符串 'mcp-check-ready'
            持有 serverReadyPromise，收到 'mcp-server-ready' 时 resolve
send(msg) → await serverReadyPromise; ws.send(JSON.stringify(msg))
close()   → ws.close(); onclose?.()
ws 收到   → 'mcp-server-ready'   → resolve ready
            'mcp-server-stopped' → this.close()
            其他                  → JSONRPCMessageSchema.parse → onmessage?.(msg)
```

`serverReadyPromise` 不能省：宿主页面的 `TabServerTransport` 只在 `start()` 时广播一次 `mcp-server-ready`，那一刻 iframe 的 WS 多半还没连上。所以服务器端必须主动发 `mcp-check-ready`，宿主的 server 收到会补发一次 ready。这是整条链路里唯一的握手逻辑。

给 ready 加上限（15s），超时抛明确错误，避免「宿主页面根本没连 iframe」时 `send` 无限挂起。

### 会话

一个 WS 连接 = 一个 `Session`，持有 `{ id, ws, transport, client, tools }`。`ws.on('close')` 时 `client.close()` 并从 map 删除。session id 由服务器生成，返给 iframe 用于关联 `/api/chat` 请求。

**超时**：现有 `wallet_transfer` 要等用户点确认 + 钱包签名，`REQUEST_TIMEOUT_MS = 10 * 60 * 1000` 必须原样带到服务器端 `client.callTool(..., { timeout })`。漏掉的症状是「转账走到一半模型收到 -32001」。

**鉴权**：最小实验**不做**。绑 `127.0.0.1`，WS 层只校验 `Origin` 头等于宿主 origin。**云端部署前必须替换成会话令牌**——这一条写进 README 的安全边界。

## 4. 聊天流

Agent 在服务器：`server/chat.ts` 把现有 `src/ai/chatModel.ts` 的 `streamText` + `SYSTEM_PROMPT` + `stopWhen: stepCountIs(5)` 整段搬过去，`tools` 来自 `mcpToolsToAiTools(session.tools, session.client)`。

`POST /api/chat { sessionId, messages }` → SSE 回 text delta。iframe 侧写一个新的 `ChatModelAdapter`（`widget/sseChatAdapter.ts`），`run()` 里 fetch + 读 SSE，逐段 yield。assistant-ui 那边接口不变，`Thread` / `Composer` / `SamplePrompts` 全部原样复用。

现有 `chatModel.ts` 里两处错误处理（`fullStream` 的 error part、`await result.finishReason` 兜底、`toUserFacingError` 不透传 API key）搬到服务器端保留。

一次 `wallet_transfer` 的完整路径（六跳）：

```
iframe 用户输入 → POST /api/chat → 服务器 streamText → 模型 tool call
  → client.callTool → WS → iframe 哑转发 → postMessage → 宿主哑转发
  → tab channel → document.modelContext → useWebMCP handler
  → 校验 / 确认弹窗 / 钱包签名（三道闸门，都在宿主页面，一道没少）
  → 结果原路回到服务器 → 回灌模型 → SSE → iframe
```

**API key 从此只在服务器**：`.env` 里 `VITE_LLM_API_KEY` 改成 `LLM_API_KEY`（去掉 `VITE_` 前缀就不会进前端产物）。README §5.2 那条安全边界被这次改造顺手消掉。

## 5. 错误、失败模式与验证

| 断点 | 表现 | 处理 |
|---|---|---|
| iframe WS 断 | 服务器 session 销毁 | iframe 指数退避重连，重连后新建 session；聊天记录留在 iframe 内存 |
| 宿主页面刷新 | tab channel 上 server 重启，广播 `mcp-server-stopped` | 该字符串经隧道到达服务器 transport → `close()` → session 失效，下次 chat 返回明确错误而非超时 |
| 工具调用超时 | `-32001` | `mcpToolsToAiTools` 已 catch 并返回 `{ error }` 不抛，模型能自己说明 |
| 宿主页面没连 iframe | `serverReadyPromise` 永远 pending | ready 上限 15s，超时抛明确错误 |

### 验证分三层

逐层确认，避免一次性调六跳：

1. **隧道层**：服务器起来后打印 `tools/list` 结果。看到 `wallet_get_balances` / `wallet_transfer` 两个名字 = 前四跳通了，此时还没有任何 LLM 参与。
2. **只读工具**：iframe 里问「我的余额」，服务器 agent 调 `wallet_get_balances`，数值与宿主页面卡片一致。
3. **写工具 + 人工闸门**：iframe 里说「转 0.001 PROS 给 0x…」，**确认弹窗必须在宿主页面弹出**（不是 iframe 里），签名后拿到 txHash。这一步同时验证了跨 origin 六跳链路没有削弱任何一道安全闸门。

## 6. README 改写

当前 README 的核心论点是「**server 和 client 都在同一个页面里**」（§1 末尾"关键认知"），整篇围绕它组织。改造后这句话直接失效——client 跑到服务器去了。所以不是打补丁，是重写主干。

| 现有节 | 命运 |
|---|---|
| 开头 + quickstart | **改**。定位从"注入给页内 widget"变成"注入给云端 agent"；`pnpm dev` 同时起两个进程；`VITE_LLM_API_KEY` → `LLM_API_KEY` |
| §1 依赖包分工表 | **改**。`@mcp-b/react-webmcp` 只剩 `useWebMCP`；`@mcp-b/transports` 从"直接用 `TabClientTransport`"变成"只复用信封格式，自写服务器端 transport"；新增"自写隧道"一行 |
| §2 连接链路（mermaid graph） | **重写**。改动最大：三跳变六跳，图里要出现 iframe、WS、服务器进程、跨 origin 边界 |
| §3 工具注册 | **基本不动**。`useWebMCP` 那套一行没改——这恰是本次改造最值得强调的一点，单独点出来 |
| §3 末尾 sequenceDiagram | **改**。participant 从 6 个变 9 个，但高亮的"两道人工闸门"矩形**原样保留**——六跳之后闸门一道没少 |
| §4 接到你自己的页面 | **重写**。步骤变成"页面侧接隧道转发器 + 嵌 widget iframe + 服务器侧起 session" |
| §5 安全边界 | **改**。删掉第 2 条（API key 进产物，本次改造消掉了）；保留第 1 条（同 tab 可见）；新增：跨 origin postMessage 双向校验、以及"最小实验没做 WS 鉴权，云端部署前必须加会话令牌" |
| **§6（新增）为什么不用 MCP-B 现成的方案** | 沉淀本文档"背景"一节的四点调研结论 |

顺手修两处过期信息：

1. §1 的 MCP-B 链接指向 `MiguelsPizza/WebMCP`，实际仓库已是 `WebMCP-org/npm-packages`
2. `src/mcp/mcpClient.ts` 文件头注释写"本 demo 没有独立 chat 抽屉"，与 §2 通篇讲 `ChatDrawer` 矛盾——删除该文件时一并消失

**README 与代码同步提交**，不留"代码改完 README 下次再说"的窗口。第 5 节三层验证跑通后再写 README 的链路描述，避免写出没验证过的形状。

## 实施注意事项

**版本差异（最容易踩的坑）**：项目 `pnpm-lock.yaml` 锁的是 `@mcp-b/*` **4.0.0**，而 `references/npm-packages-main` 是 **5.0.1**。已知差异：demo 给 `TabClientTransport` 传了 `requestTimeout`，v5 的 options 里没有该字段。**隧道的信封格式必须以实际安装的 v4 为准**——实现时先 `cat node_modules/@mcp-b/transports/dist/index.js` 核对 `isMcpMessage` / `postMcpMessage` 的字段名。照着 references 写而实际版本不符，症状是静默丢消息、无报错。

**`node_modules` 尚未安装**：第一步先 `pnpm install`。

## 不做的事

- WS 鉴权与会话令牌（云端部署前必须补，本次只留 README 提示）
- 多宿主 tab 聚合、工具重名消歧（`webmcp-local-relay` 的 `registry.ts` 做的事）
- MCP resources / prompts（隧道天然透传，但 demo 不注册也不验证）
- 保留页内 chat 那条旧链路
- 生产构建配置（widget 的静态产物、CSP、sandbox 属性）
