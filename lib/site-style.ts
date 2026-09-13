import type { SiteContent } from './site-model';

export const SITE_PALETTES = {
  midnight: { label: 'Midnight', background: '#151a24', surface: '#202938', text: '#f2f5fb', muted: '#b6c4d8', line: '#52617a', accent: '#acbeff' },
  forest: { label: 'Forest', background: '#14201c', surface: '#21342b', text: '#f0f7ef', muted: '#b7cebb', line: '#526f5b', accent: '#b6ddae' },
  parchment: { label: 'Parchment', background: '#f8f3e9', surface: '#fffcf6', text: '#27231e', muted: '#625747', line: '#aa9980', accent: '#72542e' },
} as const;
export function siteStyle(content: SiteContent): Record<string, string> {
  const palette = SITE_PALETTES[content.style?.palette ?? 'midnight'];
  return { '--site-accent': content.accent, '--platform-bg': palette.background, '--platform-surface': palette.surface, '--platform-text': palette.text,
    '--platform-panel': palette.surface, '--platform-line': palette.line,
    '--platform-muted': palette.muted, '--platform-border': palette.line, '--platform-accent': palette.accent, color: palette.text };
}
