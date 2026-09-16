import { z } from 'zod';

const customizationSchema = z.enum(['palette', 'typography', 'textSize', 'spacing', 'customAccent']);
/** Additive settings: an absent template keeps the saved legacy presentation. */
export const siteDesignSchema = z.object({
  layout: z.enum(['balanced', 'editorial', 'compact']),
  palette: z.enum(['midnight', 'forest', 'parchment', 'linen', 'ink', 'cloud', 'sage', 'cobalt', 'coral', 'orchid', 'sunshine']),
  paletteVersion: z.literal(2).optional(),
  entry: z.enum(['assistant', 'website']).optional(),
  template: z.enum(['editorial', 'showcase', 'clarity']).optional(),
  version: z.literal(1).optional(),
  typography: z.enum(['literary', 'modern', 'humanist']).optional(),
  textSize: z.enum(['standard', 'larger']).optional(),
  spacing: z.enum(['compact', 'comfortable', 'spacious']).optional(),
  customAccent: z.boolean().optional(),
  customized: z.array(customizationSchema).max(5).optional(),
}).strict();
export type SiteDesign = z.infer<typeof siteDesignSchema>;
export type WebsiteTemplate = NonNullable<SiteDesign['template']>;

export const SITE_PALETTES = {
  midnight: { label: 'Midnight', background: '#151a24', surface: '#202938', text: '#f2f5fb', muted: '#b6c4d8', line: '#52617a', accent: '#acbeff' },
  forest: { label: 'Forest', background: '#14201c', surface: '#21342b', text: '#f0f7ef', muted: '#b7cebb', line: '#526f5b', accent: '#b6ddae' },
  parchment: { label: 'Parchment', background: '#f8f3e9', surface: '#fffcf6', text: '#27231e', muted: '#625747', line: '#aa9980', accent: '#72542e' },
  linen: { label: 'Linen', background: '#fff7eb', surface: '#ffe9d4', text: '#3f2a23', muted: '#795547', line: '#ba8f78', accent: '#aa3f24' },
  ink: { label: 'Ink', background: '#171720', surface: '#292936', text: '#f8f7ff', muted: '#c8c6da', line: '#73718c', accent: '#a6c9ff' },
  cloud: { label: 'Cloud', background: '#f8fbff', surface: '#e5edff', text: '#202c4a', muted: '#516181', line: '#91a7d4', accent: '#284ddd' },
  sage: { label: 'Sage', background: '#e4f2df', surface: '#f7fcf2', text: '#173d2b', muted: '#406448', line: '#87aa8b', accent: '#176442' },
  cobalt: { label: 'Cobalt', background: '#1634a3', surface: '#2545bb', text: '#fffdf6', muted: '#d6e5ff', line: '#799ced', accent: '#ffe178' },
  coral: { label: 'Coral', background: '#ffbfae', surface: '#ffdfd3', text: '#44212a', muted: '#744047', line: '#b46a64', accent: '#9e173d' },
  orchid: { label: 'Orchid', background: '#421a75', surface: '#572890', text: '#fff4fc', muted: '#e8c7f2', line: '#a77ac6', accent: '#ffb0db' },
  sunshine: { label: 'Sunshine', background: '#ffe36d', surface: '#fff2b6', text: '#3f2c18', muted: '#6e4519', line: '#a98221', accent: '#4830a1' },
} as const;

export const CURATED_PALETTES = ['linen', 'ink', 'cloud', 'sage', 'cobalt', 'coral', 'orchid', 'sunshine'] as const;

// Saved publications keep their original colors until the publisher selects a
// refreshed palette. Styling edits unrelated to color must not opt them in.
const ORIGINAL_TEMPLATE_PALETTES = {
  linen: { label: 'Linen', background: '#f6f2ea', surface: '#fffdf8', text: '#292b25', muted: '#62645a', line: '#b9b6a9', accent: '#735039' },
  ink: { label: 'Ink', background: '#191d20', surface: '#252b2e', text: '#f5f5ed', muted: '#bdc3bf', line: '#66716c', accent: '#d3eaa4' },
  cloud: { label: 'Cloud', background: '#fafbf9', surface: '#eef2ee', text: '#24342e', muted: '#53655c', line: '#a2afa6', accent: '#315e4a' },
  sage: { label: 'Sage', background: '#edf0e6', surface: '#fbfcf7', text: '#253b32', muted: '#506558', line: '#a1b1a0', accent: '#3d6249' },
} as const;
export function sitePalette(style?: Pick<SiteDesign, 'palette' | 'paletteVersion'>) {
  const id = style?.palette ?? 'midnight';
  const original = ORIGINAL_TEMPLATE_PALETTES[id as keyof typeof ORIGINAL_TEMPLATE_PALETTES];
  return style?.paletteVersion !== 2 && original ? original : SITE_PALETTES[id];
}

export const FONT_PAIRINGS = {
  literary: { label: 'Literary', description: 'Newsreader + Manrope', heading: "'FlowPath Newsreader', Georgia, 'Times New Roman', serif", body: "'FlowPath Manrope', Arial, Helvetica, sans-serif", weight: '400' },
  modern: { label: 'Modern', description: 'Manrope + Manrope', heading: "'FlowPath Manrope', Arial, Helvetica, sans-serif", body: "'FlowPath Manrope', Arial, Helvetica, sans-serif", weight: '600' },
  humanist: { label: 'Familiar', description: 'Manrope + system sans', heading: "'FlowPath Manrope', Arial, Helvetica, sans-serif", body: "system-ui, -apple-system, 'Segoe UI', sans-serif", weight: '600' },
} as const;

export const WEBSITE_TEMPLATES: Record<WebsiteTemplate, { name: string; description: string; defaults: SiteDesign }> = {
  editorial: { name: 'Editorial', description: 'Warm typography, quiet details, room for your story.', defaults: { version: 1, template: 'editorial', layout: 'editorial', palette: 'linen', paletteVersion: 2, typography: 'literary', textSize: 'standard', spacing: 'spacious', customAccent: false } },
  showcase: { name: 'Showcase', description: 'Confident headlines, generous images, distinctive collections.', defaults: { version: 1, template: 'showcase', layout: 'balanced', palette: 'ink', paletteVersion: 2, typography: 'modern', textSize: 'standard', spacing: 'comfortable', customAccent: false } },
  clarity: { name: 'Clarity', description: 'An inviting introduction and a clear path to every detail.', defaults: { version: 1, template: 'clarity', layout: 'compact', palette: 'cloud', paletteVersion: 2, typography: 'humanist', textSize: 'standard', spacing: 'comfortable', customAccent: false } },
};

export function selectWebsiteTemplate(style: SiteDesign | undefined, template: WebsiteTemplate): SiteDesign {
  if (style?.template === template) return { ...style };
  const next = { ...WEBSITE_TEMPLATES[template].defaults, entry: style?.entry ?? 'website' };
  if (!style?.template) return next;
  const previous = WEBSITE_TEMPLATES[style.template].defaults;
  // Explicit choices travel with the publisher; untouched defaults follow the template.
  const customized = customizationSchema.options.filter(key => style.customized?.includes(key) || style[key] !== undefined && style[key] !== previous[key]);
  return { ...next, ...Object.fromEntries(customized.map(key => [key, style[key]])), ...(customized.includes('palette') ? { paletteVersion: style.paletteVersion } : {}), ...(customized.length ? { customized } : {}) };
}
export function resetWebsiteStyle(style: SiteDesign): SiteDesign {
  return { ...WEBSITE_TEMPLATES[style.template ?? 'editorial'].defaults, ...(style.entry ? { entry: style.entry } : {}) };
}
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
/** Brand color may decorate; text and buttons always have readable paired colors. */
export function websiteDesignTokens(style: SiteDesign, brand: string): Record<string, string> {
  const defaults = WEBSITE_TEMPLATES[style.template ?? 'editorial'].defaults;
  const palette = sitePalette(style);
  const font = FONT_PAIRINGS[style.typography ?? defaults.typography!];
  const accent = style.customAccent && /^#[\da-f]{6}$/i.test(brand) && contrastRatio(brand, palette.background) >= 4.5 && contrastRatio(brand, palette.surface) >= 4.5 ? brand : palette.accent;
  const onAccent = contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#171b19') ? '#ffffff' : '#171b19';
  return { '--site-accent': brand, '--platform-bg': palette.background, '--platform-surface': palette.surface, '--platform-panel': palette.surface,
    '--platform-text': palette.text, '--platform-muted': palette.muted, '--platform-line': palette.line, '--platform-border': palette.line,
    '--platform-accent': accent, '--platform-on-accent': onAccent, '--platform-heading-font': font.heading, '--platform-body-font': font.body,
    '--platform-heading-weight': font.weight, '--platform-text-scale': style.textSize === 'larger' ? '1.125' : '1',
    '--platform-space-scale': ({ compact: '.75', comfortable: '1', spacious: '1.3' })[style.spacing ?? defaults.spacing!],
    '--platform-radius': style.template === 'clarity' ? '18px' : style.template === 'showcase' ? '2px' : '0px', color: palette.text,
  };
}
