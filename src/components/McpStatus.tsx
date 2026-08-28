/**
 * 工具注册状态行 —— 展示宿主页面注册了哪些 WebMCP 工具。
 *
 * 原来这里读的是页内 MCP client 的连接状态，但 agent 搬到服务器之后页内已经
 * 没有 client 了。工具名改为直接从注册处传进来：这是宿主页面本地的事实，
 * 不依赖隧道通不通。隧道那一端是否真的拿到了这些工具，看服务器进程的日志。
 */

import styled from 'styled-components';

const Status = styled.p`
  margin: 0 0 24px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

export function McpStatus({ toolNames }: { toolNames: readonly string[] }) {
  return (
    <Status>
      本页已注册 {toolNames.length} 个 WebMCP 工具：{toolNames.join(', ')}
    </Status>
  );
}
