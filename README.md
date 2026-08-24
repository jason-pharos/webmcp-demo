# WebMCP Wallet Demo

## 1. 这是什么

一个最小化的 WebMCP 示例：宿主页面把自己已有的两个能力——**查余额**、**转账**——注册成 MCP 工具（`document.modelContext`），页内 AI agent（本 demo 内置的聊天面板，以及任何连到同一个 tab channel 的 MCP 客户端，比如 MCP-B 浏览器扩展）都可以发现并调用它们。宿主页面本身仍然保留一套普通 UI（连钱包 / 余额卡片 / 手动转账表单），工具只是把这些已有能力"复用"给 AI，而不是新写一套。

## 2. 快速开始

```bash
cp .env.example .env
# 编辑 .env，至少填 VITE_LLM_API_KEY（否则 chat 面板可用但会提示未配置）
```

**这是一个独立工程**，不属于本仓 pnpm workspace（根 `pnpm-workspace.yaml` 只匹配 `apps/*`），可以把 `webmcp-demo/` 整个目录拷到仓库外单独使用。

- **在本仓库内部执行**（当前所在位置）：

  ```bash
  pnpm install --ignore-workspace
  pnpm dev
  ```

  ⚠️ **踩坑提醒**：在本 monorepo 内部，直接跑 `pnpm install`（不加 `--ignore-workspace`）会被根目录的 `pnpm-workspace.yaml` 劫持成"根 install"——命令会正常退出（`exit 0`），日志显示 `Scope: all 3 workspace projects`，但 `webmcp-demo/` 下**什么依赖都不会装**（`node_modules` 目录都不会创建）。必须加 `--ignore-workspace`。

- **把目录拷出本仓库之后**（不再处于任何 pnpm workspace 内）：

  ```bash
  pnpm install    # 普通 install 即可，不需要 --ignore-workspace
  pnpm dev
  ```

其他脚本：`pnpm build`（`tsc -b && vite build`）、`pnpm preview`。

## 3. 配置项

全部在 `.env.example`（复制成 `.env` 后填写），由 `src/config/env.ts` 统一读取并给出默认值：

| 变量 | 说明 |
|---|---|
| `VITE_CHAIN_ID` | 期望链的 chainId，默认 `1672`（Pharos Mainnet）|
| `VITE_CHAIN_NAME` | 链名，用于 UI 文案与切链提示 |
| `VITE_NATIVE_SYMBOL` | 原生代币符号，默认 `PROS` |
| `VITE_EXPLORER_URL` | 区块浏览器根地址，用于拼交易详情链接（`txUrl(hash)`）|
| `VITE_USDC_ADDRESS` | USDC 合约地址 |
| `VITE_USDC_DECIMALS` | USDC 小数位数，默认 `6` |
| `VITE_LLM_BASE_URL` | 任意 OpenAI 兼容端点的 base URL，默认 DeepSeek（`https://api.deepseek.com/v1`）|
| `VITE_LLM_MODEL` | 模型名，默认 `deepseek-chat` |
| `VITE_LLM_API_KEY` | LLM API key。留空时 chat adapter 会直接抛出"未配置"的错误，不会静默失败 |

⚠️ 以上所有 `VITE_` 变量都会被打进前端产物（bundle），包括 `VITE_LLM_API_KEY`——见第 7 节。

## 4. 代码地图

**先看 `src/mcp/useWalletWebMcpTools.ts`**：这是理解本 demo 的入口，展示"宿主页面已有能力如何变成 MCP 工具"。

| 文件 | 作用 |
|---|---|
| `src/mcp/useWalletWebMcpTools.ts` | **核心**：把 `wallet_get_balances` / `wallet_transfer` 注册为 WebMCP 工具（`useWebMCP`），工具 handler 直接调用下面 `src/chain/*` 的既有能力 |
| `src/mcp/mcpClient.ts` | 页内 MCP client 单例 + `TabClientTransport`；`MCP_CHANNEL_ID` 必须与 `index.html` 内联脚本里的 channelId 一致（见第 6 节陷阱①②）|
| `src/mcp/mcpTools.ts` | 把 MCP 工具的 JSON Schema 转成 AI SDK 的 `ToolSet`（`mcpToolsToAiTools`），`execute` 失败时返回 `{ error }` 而不抛异常 |
| `src/ai/chatModel.ts` | OpenAI 兼容协议 → assistant-ui `ChatModelAdapter`（`createChatAdapter`），system prompt、错误脱敏（`toUserFacingError`）都在这里 |
| `src/chain/tokens.ts` | `TokenKey` / `TokenMeta` / `TOKENS`（PROS 原生代币 + USDC ERC20 描述）、最小 ERC20 ABI |
| `src/chain/useBalances.ts` | 读取 PROS / USDC 余额（`provider.getBalance` + `Contract.balanceOf`），导出 `refresh()` |
| `src/chain/useTransfer.ts` | 发起转账（`sendTransaction` / ERC20 `transfer`），只等 `tx.hash`，不等 receipt |
| `src/chain/useTransferConfirm.tsx` | 转账前的人工确认弹窗控制器，`requestConfirm(req) => Promise<boolean>` |
| `src/chain/validateTransfer.ts` | 转账前的本地校验闸门（未连接 / 链不对 / 地址非法 / 金额非法 / 超余额），手动表单与工具 handler 共用同一份逻辑 |
| `src/wallet/WalletProvider.tsx` + `useWallet.ts` | EIP-1193 钱包接入：连接、切链、监听 `accountsChanged`/`chainChanged` |
| `src/components/*` | 宿主页普通 UI：`ConnectButton`、`BalanceCards`、`TransferForm`、`TransferConfirmDialog`、`McpStatus`（展示 MCP 连接状态与已注册工具列表）|
| `src/components/aiChat/*` | 聊天面板 UI：`ChatLauncher`（悬浮按钮）、`ChatDrawer`（抽屉，内部只创建一次 `createChatAdapter`）、`Thread`、`Composer`、`SamplePrompts` |

## 5. 工具契约

### 5.1 `wallet_get_balances`（只读）

无入参——**始终读当前已连接的钱包**，不接受任意地址参数（防止模型代查别人地址）。

```ts
// 输出
{
  connected: boolean;        // false 时不含下面任何字段
  address?: string;
  chainId?: number;
  chainName?: string;
  correctChain?: boolean;    // 是否在期望的链上
  pros?: { symbol: string; balance?: string };
  usdc?: { symbol: string; balance?: string; address: string };
}
```

`annotations: { readOnlyHint: true }`。

### 5.2 `wallet_transfer`（写，有副作用）

```ts
// 入参
{
  token: 'PROS' | 'USDC';   // PROS 是原生代币
  to: string;               // 0x 地址，必须由用户在对话里明确给出
  amount: string;           // 该 token 单位下的人类可读金额，如 "0.1"
}

// 出参
{
  status: 'submitted' | 'declined' | 'rejected' | 'blocked' | 'failed';
  message: string;          // 人类可读说明
  token?: string; amount?: string; to?: string;
  txHash?: string; explorerUrl?: string;   // 仅 submitted 时有
}
```

`annotations: { readOnlyHint: false, destructiveHint: true }`。五种 `status` 的含义：

| status | 含义 |
|---|---|
| `submitted` | 交易已发出（拿到 `tx.hash`），**不代表已上链确认** |
| `declined` | 用户在确认弹窗里点了取消——message 会明确提示"不要重试" |
| `rejected` | 用户在钱包里拒绝签名，或交易发送失败 |
| `blocked` | 当前不允许执行（例如链不对），换个前提条件即可重试 |
| `failed` | 本地校验未通过（地址非法 / 金额非法 / 余额不足 / 未连接钱包）|

handler 内部闸门顺序：`validateTransfer`（未连接→`failed`；链不对→`blocked`；地址非法→`failed`；金额非法或超余额→`failed`）→ 弹确认框等待用户点击（取消→`declined`）→ `useTransfer().transfer(...)`（失败/拒签→`rejected`；成功→`submitted` 并触发 `refreshBalances()`）。模型**无法跳过**确认框和钱包签名这两步。

## 6. 接入你自己的页面要改哪几处

1. **`index.html`** 内联 `<script>` 里的 `window.__webModelContextOptions.transport.tabServer.channelId`——换成你自己的 channel 名。这段脚本必须在 `@mcp-b/global` 被 import 之前执行（该库一被 import 就会读取这个全局变量并自动初始化），所以只能放在 `index.html` 的内联脚本里，不能挪进 `main.tsx`。
2. **`src/mcp/mcpClient.ts`** 里的 `MCP_CHANNEL_ID` 常量必须与①里的 channelId **完全一致**——两边不同步会导致 client 永远连不上 server，只会在 `TabClientTransport` 的 `requestTimeout` 超时后收到 MCP `-32001`。
3. 参照 `src/mcp/useWalletWebMcpTools.ts` 写你自己的 `useXxxWebMcpTools`：用 `useWebMCP({ name, description, inputSchema, outputSchema, annotations, handler }, deps)` 把你页面已有的能力（读数据 / 触发某个动作）包装成工具；`deps` 数组一定要带上 handler 闭包里读到的所有最新值，否则工具会用陈旧的闭包数据。
4. 把 `<McpClientProvider client={...} transport={...}>` 包在需要用到工具的组件外层（参考 `src/App.tsx` 的 `App` 组件），再把聊天面板（`<ChatLauncher/>` + `<ChatDrawer/>`，或你自己的 UI）挂进页面——聊天面板通过 `useMcpClient()` 拿到已注册工具，再经 `mcpToolsToAiTools()` 转成 AI SDK 的 `ToolSet` 交给 `createChatAdapter()`。

## 7. 安全边界（必读）

1. **LLM API key 会暴露**：`VITE_` 前缀的变量会被打进前端产物，任何人都能从 bundle 里提取出来。这仅适用于本地 / 内网 demo；生产环境必须改成后端代理，不能让浏览器直连 LLM 服务商。交付物里 `VITE_LLM_API_KEY` 留空。
2. **工具对同 tab 的浏览器扩展可见，无法只对页内 chat 开放**：WebMCP 把工具注册到 `document.modelContext` 并通过 tab transport 广播，同一个浏览器 tab 内任何连接到这个 channel 的 MCP 客户端（包括 MCP-B 浏览器扩展）都能 list/call 这些工具。缓解措施：`allowedOrigins` 限制到本 origin；转账强制"确认框 + 钱包签名"两道人工闸门。如果要做到严格隔离（只对页内 chat 开放），就必须放弃 mcp-b、自己实现一套内存工具注册表——本 demo 不做这个。
3. **模型永远拿不到私钥**：最坏情况是模型诱导用户签一笔他不想签的交易，而这一步会被确认框（展示金额/地址全文/余额）和钱包签名各拦一次。

## 8. 手动验证清单

⚠️ 以下 10 条来自设计文档 §6，**尚未由真人跑过**——此前各 task 只做到了 `pnpm build` 通过 + headless 场景下的代码/断言检查；凡是需要真实钱包签名或会产生真实 LLM 调用费用的步骤，都标记为 `PENDING-HUMAN`，等交付后由使用方实际执行确认。

1. `PENDING-HUMAN` `pnpm install --ignore-workspace && pnpm build` —— tsc 与 vite build 通过（在本仓库内**必须**带 `--ignore-workspace`，把目录拷出仓库后用普通 `pnpm install` 即可；已用干净重装验证一次，见下方 Step 2 / Step 3 记录，仍建议交付方自己再跑一次）
2. `PENDING-HUMAN` `pnpm dev` 打开页面：未连钱包时提示连接；连接后余额卡片数值与 pharosscan 上一致
3. `PENDING-HUMAN` chat 问"我有多少 USDC 和 PROS"→ 数值与页面卡片一致
4. `PENDING-HUMAN` chat 说"转 0.0001 PROS 给 <自己另一个地址>"→ 弹确认框 → 签名 → 返回 txHash，pharosscan 能查到；页面余额自动刷新
5. `PENDING-HUMAN` 同一路径点"取消"→ 模型说明已取消且不重试
6. `PENDING-HUMAN` USDC 转账重复第 4、5 条
7. `PENDING-HUMAN` 手动转账表单走通同样两条路径（与工具共用确认框）
8. `PENDING-HUMAN` 钱包切到别的链 → chat 提示切链，`wallet_transfer` 返回 `blocked`
9. `PENDING-HUMAN` 断开钱包 → `wallet_get_balances` 返回 `connected:false`，模型让用户先连钱包
10. `PENDING-HUMAN` 清空 `VITE_LLM_API_KEY` → chat 面板显示未配置提示，不出现空气泡

## 9. 已知限制

- **无自动化测试**：本工程未引入任何测试框架，所有验证都是手动的（见第 8 节）。
- **只支持注入式钱包**：只接 `window.ethereum`（EIP-1193），没有 WalletConnect，没有其他连接方式。
- **只支持一条链**：期望的 chainId 由 `.env` 的 `VITE_CHAIN_ID` 决定，工具与 UI 都不支持多链切换调用，只会在链不对时提示切换到那一条链。
- **转账只等交易发出，不等上链确认**：`useTransfer` 只等 `tx.hash`（交易被节点接受），不 `await tx.wait()`。这意味着 `wallet_transfer` 返回 `submitted` 之后立刻触发的余额刷新，很可能还读到转账前的旧值——工具的 `message` 字段里会附带这句提醒，但如果你自己接入时改写了这部分逻辑，要注意别把"已发出"当成"已确认"。
