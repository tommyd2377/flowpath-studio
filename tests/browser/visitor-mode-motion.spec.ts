import { test, expect, type Page } from '@playwright/test';
import { prepareCarouselVoice } from './helpers/carousel-voice';

const picker = (page: Page) => page.getByRole('group', { name: 'Conversation mode' });

// Sample the actual DOM transform and text geometry across the switch. A final
// screenshot alone would also pass if the highlight simply disappeared/snapped.
async function sampleSwitch(page: Page, destination: 'Voice' | 'Chat', reverse = false) {
  return picker(page).evaluate(async (element, { destination, reverse }) => {
    const selection = element.querySelector<HTMLElement>('[data-mode-selection]')!;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
    const button = (name: string) => buttons.find(node => node.textContent?.trim() === name)!;
    const samples: { x: number; labelWidths: number[]; labelX: number[]; labelY: number[]; centered: number; sameNode: boolean; scale: number }[] = [];
    const sample = () => {
      const bounds = element.getBoundingClientRect(), highlight = selection.getBoundingClientRect();
      const labels = buttons.map(node => node.querySelector('span')!.getBoundingClientRect());
      const divider = element.closest('[data-ai-controls]')!.getBoundingClientRect().bottom;
      samples.push({ x: highlight.x - bounds.x, labelWidths: labels.map(rect => rect.width), labelX: labels.map(rect => rect.x - bounds.x), labelY: labels.map(rect => rect.y - bounds.y), centered: Math.abs(bounds.y + bounds.height / 2 - divider), sameNode: element.querySelector('[data-mode-selection]') === selection, scale: new DOMMatrix(getComputedStyle(selection).transform).a });
    };
    sample(); button(destination).click();
    const start = performance.now(); let reversed = false;
    while (performance.now() - start < 750) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      sample();
      if (reverse && !reversed && performance.now() - start >= 90) { reversed = true; button(destination === 'Chat' ? 'Voice' : 'Chat').click(); }
    }
    return samples;
  }, { destination, reverse });
}

async function expectSelected(page: Page, name: 'Voice' | 'Chat') {
  const controls = picker(page), selected = controls.getByRole('button', { name, exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => controls.evaluate((element, name) => {
    const indicator = element.querySelector('[data-mode-selection]')!.getBoundingClientRect();
    const button = [...element.querySelectorAll('button')].find(node => node.textContent?.trim() === name)!.getBoundingClientRect();
    return Math.max(Math.abs(indicator.x - button.x), Math.abs(indicator.width - button.width));
  }, name)).toBeLessThan(1);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await prepareCarouselVoice(page);
  await expectSelected(page, 'Voice');
});

for (const width of [320, 393, 1440]) test(`mode highlight slides in both directions without stretching labels at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 931 });
  const controls = picker(page);
  for (const name of ['Chat', 'Voice'] as const) {
    const frames = await sampleSwitch(page, name);
    const from = frames[0].x, to = frames.at(-1)!.x;
    expect(Math.abs(to - from)).toBeGreaterThan(50);
    expect(frames.filter(frame => frame.x > Math.min(from, to) + 1 && frame.x < Math.max(from, to) - 1).length).toBeGreaterThan(3);
    expect(new Set(frames.map(frame => frame.x.toFixed(1))).size).toBeGreaterThan(6);
    for (const frame of frames) {
      expect(frame.sameNode).toBe(true);
      expect(frame.scale).toBe(1);
      expect(frame.centered).toBeLessThan(1);
      frame.labelWidths.forEach((value, index) => expect(Math.abs(value - frames[0].labelWidths[index])).toBeLessThan(.5));
      frame.labelX.forEach((value, index) => expect(Math.abs(value - frames[0].labelX[index])).toBeLessThan(.5));
      frame.labelY.forEach((value, index) => expect(Math.abs(value - frames[0].labelY[index])).toBeLessThan(.5));
    }
    await expectSelected(page, name);
    await expect(controls.locator('[data-mode-selection]')).toHaveCount(1);
    await expect(controls).toHaveCSS('border-top-width', '0px');
    await expect(controls).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const button of await controls.getByRole('button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`mode-${name.toLowerCase()}-${width}.png`) });
  }
  const reversal = await sampleSwitch(page, 'Chat', true);
  expect(Math.max(...reversal.map(frame => frame.x)) - reversal[0].x).toBeGreaterThan(2);
  expect(Math.abs(reversal.at(-1)!.x - reversal[0].x)).toBeLessThan(1);
  await expectSelected(page, 'Voice');
  await controls.getByRole('button', { name: 'Voice', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(controls.getByRole('button', { name: 'Chat', exact: true })).toBeFocused();
  expect(await controls.getByRole('button', { name: 'Chat', exact: true }).evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter'); await expectSelected(page, 'Chat');
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
});

test('mode highlight respects reduced motion and live preference changes', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectSelected(page, 'Voice');
  const frames = await sampleSwitch(page, 'Chat');
  const from = frames[0].x, to = frames.at(-1)!.x;
  expect(Math.abs(to - from)).toBeGreaterThan(50);
  expect(frames.some(frame => frame.x > from + 1 && frame.x < to - 1)).toBe(false);
  await expectSelected(page, 'Chat');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const resumed = await sampleSwitch(page, 'Voice');
  expect(resumed.filter(frame => frame.x > resumed.at(-1)!.x + 1 && frame.x < resumed[0].x - 1).length).toBeGreaterThan(3);
  await expectSelected(page, 'Voice');
  // Changing the OS preference during a transition settles the existing node.
  await picker(page).getByRole('button', { name: 'Chat', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectSelected(page, 'Chat');
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
});
