import type { SiteContent } from './site-model';
import { sitePalette, websiteDesignTokens } from '@thevoice/platform-ui/site-design';
import { voiceDesignTokens } from '@thevoice/platform-ui/voice-design';
export { SITE_PALETTES } from '@thevoice/platform-ui/site-design';

function luminance(hex: string) {
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
export function siteStyle(content: SiteContent): Record<string, string> {
  const tokens = websiteStyle(content);
  const color = content.visitor?.conversation?.color;
  return color ? { ...tokens, ...voiceDesignTokens(color, tokens['--platform-bg'], tokens['--platform-surface']) } : tokens;
}
function websiteStyle(content: SiteContent): Record<string, string> {
  if (content.style?.template) return websiteDesignTokens(content.style, content.accent);
  const palette = sitePalette(content.style);
  const light = luminance(content.accent), background = luminance(palette.background);
  const contrast = (Math.max(light, background) + .05) / (Math.min(light, background) + .05);
  const accent = content.style?.entry !== undefined && contrast >= 4.5 ? content.accent : palette.accent;
  return { '--site-accent': content.accent, '--platform-bg': palette.background, '--platform-surface': palette.surface, '--platform-text': palette.text,
    '--platform-panel': palette.surface, '--platform-line': palette.line,
    '--platform-muted': palette.muted, '--platform-border': palette.line, '--platform-accent': accent, color: palette.text };
}
