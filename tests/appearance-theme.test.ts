import assert from 'node:assert/strict';
import test from 'node:test';
import { appearancePalette } from '../lib/appearance-theme';

test('extreme custom colors keep waveform controls and text readable on their background', () => {
  const luminance = (rgb: number[]) => rgb.map(channel => channel / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (a: number[], b: number[]) => {
    const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const color of ['#000000', '#ffffff', '#0000ff', '#ff0000', '#00ff00', '#ddbf92']) {
    const palette = appearancePalette(color);
    for (const foreground of [palette.accent, palette.text, palette.muted]) {
      assert.ok(ratio(foreground, palette.surface) >= 4.5, `${color} stays readable`);
    }
    assert.ok(ratio(palette.accent, palette.buttonText) >= 4.5, `${color} button text stays readable`);
  }
  assert.deepEqual(appearancePalette('#ddbf92').surface, [16, 17, 16], 'default amber keeps the original background');
});
