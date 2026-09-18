import { z } from 'zod';
import { contrastRatio } from './site-design.js';

export const voiceColorSchema = z.enum(['amber', 'slate', 'ocean', 'teal', 'jade', 'indigo', 'plum', 'rose', 'copper']);
export type VoiceColor = z.infer<typeof voiceColorSchema>;

/** One hue per choice. Light/dark shades keep the same identity on every site palette. */
export const VOICE_COLORS: Record<VoiceColor, { name: string; ink: string; light: string }> = {
  amber: { name: 'Amber', ink: '#966015', light: '#e1b773' },
  slate: { name: 'Slate', ink: '#526579', light: '#9baecc' },
  ocean: { name: 'Ocean', ink: '#2b66a0', light: '#81b6e1' },
  teal: { name: 'Teal', ink: '#167777', light: '#79c3bc' },
  jade: { name: 'Jade', ink: '#38794d', light: '#8bc798' },
  indigo: { name: 'Indigo', ink: '#5c5eb1', light: '#aaa5e7' },
  plum: { name: 'Plum', ink: '#85519b', light: '#c5a0db' },
  rose: { name: 'Rose', ink: '#a04e70', light: '#dda1b7' },
  copper: { name: 'Copper', ink: '#9c5c3c', light: '#dbad8c' },
};

export function voiceDesignTokens(color: VoiceColor, background: string, surface = background): Record<string, string> {
  const { ink, light } = VOICE_COLORS[color];
  const score = (value: string) => Math.min(contrastRatio(value, background), contrastRatio(value, surface));
  let accent = score(ink) >= score(light) ? ink : light;
  const target = accent === ink ? 0 : 255;
  const original = accent;
  for (let step = 1; score(accent) < 4.5 && step <= 20; step++) {
    accent = '#' + [1, 3, 5].map(start => {
      const value = parseInt(original.slice(start, start + 2), 16);
      return Math.round(value + (target - value) * step / 20).toString(16).padStart(2, '0');
    }).join('');
  }
  return { '--voice-accent': accent, '--voice-on-accent': contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#101110') ? '#ffffff' : '#101110' };
}
