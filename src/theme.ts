/** 中性主题 token，不带任何品牌资源。styled-components 通过 ThemeProvider 注入。 */
export const theme = {
  colors: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    text: '#14161a',
    textMuted: '#6b7280',
    border: '#e3e6eb',
    primary: '#2f6bff',
    primaryText: '#ffffff',
    danger: '#d92d20',
    dangerBg: '#fdecec',
    warning: '#b54708',
  },
  radius: { sm: '8px', md: '12px', lg: '16px' },
  font: {
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    medium: 600,
  },
} as const;

export type AppTheme = typeof theme;
