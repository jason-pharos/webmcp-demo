/**
 * 工具注册状态展示行 —— 不依赖 chat 就能验证 Task 5 的产出：
 * 连接状态、工具数量、工具名列表。
 */

import styled from 'styled-components';
import { useMcpClient } from '@mcp-b/react-webmcp';

const Status = styled.p`
  margin: 0 0 24px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textMuted};
`;

export function McpStatus() {
  const { tools, isConnected } = useMcpClient();

  return (
    <Status>
      {isConnected
        ? `MCP 已连接 · ${tools.length} 个工具：${tools.map((t) => t.name).join(', ')}`
        : 'MCP 连接中…'}
    </Status>
  );
}
