/**
 * 隧道里的三个控制字符串。
 *
 * 刻意与 src/mcp/tunnelEnvelope.ts 各写一份而不跨端共享：服务器只处理裸
 * payload（信封是 iframe 那一侧加的），把浏览器模块引进 Node 编译单元只会
 * 把 DOM 类型一起拖进来。两处是否一致由 server/tunnel.integration.test.ts 保证。
 */
export const CHECK_READY = 'mcp-check-ready';
export const SERVER_READY = 'mcp-server-ready';
export const SERVER_STOPPED = 'mcp-server-stopped';
