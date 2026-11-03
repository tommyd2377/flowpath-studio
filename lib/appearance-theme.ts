import type { CSSProperties } from 'react';
import { WAVEFORM_DEFAULT_COLOR } from './account-model';

type RGB = [number, number, number];
const mix = (from: RGB, to: RGB, amount: number): RGB => from.map((channel, index) =>
  Math.round(channel * (1 - amount) + to[index] * amount)) as RGB;
const hex = (rgb: RGB) => `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
const luminance = (rgb: RGB) => rgb.reduce((total, channel, index) => {
  const value = channel / 255;
  return total + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
}, 0);
const contrast = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05)
  / (Math.min(luminance(a), luminance(b)) + 0.05);

export function accentRGB(color: string): RGB {
  const valid = /^#[0-9a-f]{6}$/i.test(color) ? color : WAVEFORM_DEFAULT_COLOR;
  return [1, 3, 5].map(index => parseInt(valid.slice(index, index + 2), 16)) as RGB;
}

/** Only accents follow the color wheel; surfaces and reading text stay neutral. */
export function appearancePalette(color: string) {
  const chosen = accentRGB(color);
  const surface: RGB = [16, 17, 16];
  let accent = chosen;
  for (let step = 1; contrast(accent, surface) < 4.5 && step <= 20; step++) {
    accent = mix(chosen, [255, 255, 255], step / 20);
  }
  const text: RGB = [231, 223, 205];
  const muted: RGB = [197, 187, 166];
  const buttonText: RGB = contrast(accent, [16, 17, 16]) >= 4.5 ? [16, 17, 16] : [255, 255, 255];
  return { chosen, accent, surface, text, muted, buttonText };
}

export function appearanceTheme(color: string): CSSProperties {
  const palette = appearancePalette(color);
  return {
    '--accent': hex(palette.accent),
    '--accent-rgb': palette.chosen.join(', '),
    '--surface': hex(palette.surface),
    '--text': hex(palette.text),
    '--muted': hex(palette.muted),
    '--border': hex(mix(palette.surface, palette.accent, 0.7)),
    '--button-text': hex(palette.buttonText),
  } as CSSProperties;
}
