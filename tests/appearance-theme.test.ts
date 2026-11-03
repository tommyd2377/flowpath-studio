import assert from 'node:assert/strict';
import test from 'node:test';
import { appearancePalette, appearanceTheme } from '../lib/appearance-theme';
import { WAVEFORM_DEFAULT_COLOR } from '../lib/account-model';

test('extreme custom colors keep waveform controls and text readable on their background', () => {
  const luminance = (rgb: number[]) => rgb.map(channel => channel / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (a: number[], b: number[]) => {
    const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const color of ['#000000', '#ffffff', '#0000ff', '#ff0000', '#00ff00', '#ddbf92', WAVEFORM_DEFAULT_COLOR]) {
    const palette = appearancePalette(color);
    for (const foreground of [palette.accent, palette.text, palette.muted]) {
      assert.ok(ratio(foreground, palette.surface) >= 4.5, `${color} stays readable`);
    }
    assert.ok(ratio(palette.accent, palette.buttonText) >= 4.5, `${color} button text stays readable`);
  }
  assert.equal(WAVEFORM_DEFAULT_COLOR, '#3a66ff', 'the default is sampled from the P in the FlowPath logo');
  assert.deepEqual(appearancePalette(WAVEFORM_DEFAULT_COLOR).chosen, [58, 102, 255]);
  assert.deepEqual(appearancePalette(WAVEFORM_DEFAULT_COLOR).surface, [16, 17, 16], 'brand blue keeps the original background');
  assert.deepEqual(appearancePalette('#ddbf92').surface, [16, 17, 16], 'saved amber keeps its original background');
});

test('changing accents never recolors the page surface or reading text', () => {
  const baseline = appearanceTheme(WAVEFORM_DEFAULT_COLOR);
  for (const color of ['#00ff00', '#ff0000', '#000000', '#ffffff', '#36a489']) {
    const theme = appearanceTheme(color) as Record<string, string>;
    for (const property of ['--surface', '--text', '--muted']) {
      assert.equal(theme[property], (baseline as Record<string, string>)[property]);
    }
  }
  assert.notEqual((appearanceTheme('#00ff00') as Record<string, string>)['--accent'],
    (appearanceTheme('#ff0000') as Record<string, string>)['--accent']);
});
