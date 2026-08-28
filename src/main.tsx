import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { initializeWebModelContext } from '@mcp-b/global';
import { TAB_CHANNEL_ID } from '@/mcp/tunnelEnvelope';
import './index.css';
import App from './App';
import { theme } from './theme';

// 兜底：真正生效的初始化在 index.html 的内联脚本里（见那里的注释）。
// initializeWebModelContext 内部 `if (runtime) return`，所以正常路径下这里是 no-op；
// 只有当 index.html 的脚本没跑（换了别的 HTML 入口）时才会真正生效。
initializeWebModelContext({
  transport: {
    tabServer: {
      allowedOrigins: [window.location.origin],
      channelId: TAB_CHANNEL_ID,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  </StrictMode>
);
