import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }],
  },
  server: { port: 5273 },
  // 依赖预扫描只扫宿主页面这一个入口。仓库根目录下还有 references/npm-packages-main
  // （MCP-B v5 的 monorepo，只作参考、已 gitignore），里面一堆 .html 会 import v5 的
  // @mcp-b/*，而本仓库只装了 v4，默认的全目录扫描会因此失败并刷屏。
  optimizeDeps: { entries: ['index.html'] },
});
