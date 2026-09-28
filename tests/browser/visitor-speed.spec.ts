import { test, expect, type Page } from '@playwright/test';
import { prepareCarouselVoice } from './helpers/carousel-voice';
import { carouselFixture } from './helpers/carousel-fixture';
import { mkdir } from 'node:fs/promises';

declare global {
  interface Window {
    __speedChat: { requestId: string; requests: string[]; cancelled: number; emit: (event: Record<string, unknown>) => void };
    __speedDisplay: { receipts: { id: string; status: string; state: string | null; transition: string | null; exiting: number; opaque: boolean; projected: boolean }[] };
  }
}

async function streamChat(page: Page, prepare = true) {
  if (prepare) await prepareCarouselVoice(page);
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    window.__speedChat = { requestId: '', requests: [], cancelled: 0, emit: event => sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)) };
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && init?.method === 'POST') {
        window.__speedChat.requestId = JSON.parse(String(init.body)).requestId;
        window.__speedChat.requests.push(window.__speedChat.requestId);
        return new Response(new ReadableStream({ start(controller) { sink = controller; }, cancel() { sink = undefined; window.__speedChat.cancelled++; } }), { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return fetch(input, init);
    };
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
}

async function ask(page: Page) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Why might someone enjoy this studio?'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__speedChat.requestId)).not.toBe('');
}

test('speed: focusing chat prepares one unpaid session before submission', async ({ page }) => {
  await prepareCarouselVoice(page);
  const initializations: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/tasks') && request.postDataJSON()?.action === 'init') initializations.push(request.url());
  });
  await streamChat(page, false);
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.focus();
  await expect.poll(() => initializations.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(0);
  // Focusing chat opens its existing invitation, but unpaid preparation must
  // not turn that invitation into a result or start a provider request.
  await expect(page.getByRole('heading', { name: 'What would you like to explore?', exact: true })).toBeVisible();
  await expect(page.locator('[data-information-surface] [data-task-record]')).toHaveCount(0);
  await input.fill('Why might someone enjoy this studio?');
  await page.getByRole('button', { name: 'Chat', exact: true }).focus();
  await input.focus();
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(1);
  expect(initializations).toHaveLength(1);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
});

async function mockAvailability(page: Page) {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && !init?.method) return Response.json({ availability: { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' } });
      return fetch(input, init);
    };
  });
}

async function observeDisplayReceipts(page: Page) {
  await page.evaluate(() => {
    window.__speedDisplay = { receipts: [] };
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+\/(?:tasks|session\/control)$/.test(path) && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)), ack = body.update?.navigationAck ?? (body.action === 'ack' ? { id: body.operationId, status: 'applied' } : null);
        if (ack) {
          const surface = document.querySelector('[data-information-surface]');
          const regions = [...surface?.querySelectorAll<HTMLElement>('[data-surface-region]:not([aria-hidden=true]), [data-grid-presence=present]') ?? []];
          window.__speedDisplay.receipts.push({ id: ack.id, status: ack.status, state: surface?.getAttribute('data-surface-state') ?? null,
            transition: surface?.getAttribute('data-workspace-transition') ?? null,
            exiting: surface?.querySelectorAll('[data-surface-region][aria-hidden=true], [data-grid-presence=exiting]').length ?? 0,
            opaque: regions.length > 0 && regions.every(node => Number(getComputedStyle(node).opacity) >= .99),
            projected: regions.some(node => { const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform); return Math.abs(matrix.m41) > .5 || Math.abs(matrix.m42) > .5 || Math.abs(matrix.m11 - 1) > .01 || Math.abs(matrix.m22 - 1) > .01; }) });
        }
      }
      return fetch(input, init);
    };
  });
}

async function preparedVoiceTurn(page: Page, revision: number) {
  await page.evaluate(revision => window.__visitorVoice.emit({ type: 'response_started', revision }), revision);
  await expect.poll(() => page.evaluate(revision => window.__visitorVoice.controls.find(update => update.preparationAck?.revision === revision)?.preparationAck?.status, revision)).toBe('applied');
}

async function voiceDisplay(page: Page, revision: number, id: string, target: Record<string, unknown>) {
  await page.evaluate(({ revision, id, target }) => window.__visitorVoice.emit({ type: 'navigation', revision, id, target }), { revision, id, target });
}

async function expectDisplayReceipt(page: Page, id: string) {
  await expect.poll(() => page.evaluate(id => window.__speedDisplay.receipts.find(receipt => receipt.id === id)?.status, id)).toBe('applied');
  const receipts = await page.evaluate(id => window.__speedDisplay.receipts.filter(receipt => receipt.id === id), id);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ transition: 'settled', exiting: 0, opaque: true, projected: false });
  return receipts[0];
}

test('speed: reduced-motion display acknowledges after paint without a fixed quiet-period delay', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await prepareCarouselVoice(page);
  await observeDisplayReceipts(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await preparedVoiceTurn(page, 1);
  // The pause command crosses the browser transport. Leave room for that
  // round trip; the measured 300ms display budget begins after the pause.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await voiceDisplay(page, 1, 'reduced-source', { kind: 'source', id: 'section:weddings' });
  // Advance animation frames explicitly. Wall-clock scheduling and network
  // preparation are outside this budget; a fixed 560ms wait cannot pass.
  await page.clock.runFor(300);
  await expectDisplayReceipt(page, 'reduced-source');
  await page.clock.resume();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('speed: moving, replaced and restored information acknowledges only its settled display', async ({ page }) => {
  await prepareCarouselVoice(page);
  await observeDisplayReceipts(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const surface = page.locator('[data-information-surface]');
  const finish = async (revision: number) => {
    await page.evaluate(revision => window.__visitorVoice.emit({ type: 'backend_idle', revision, interactionRevision: 0 }), revision);
    await expect(surface).toHaveAttribute('data-pending-request', '');
  };
  await preparedVoiceTurn(page, 1);
  await voiceDisplay(page, 1, 'first-source', { kind: 'source', id: 'section:weddings' });
  await expectDisplayReceipt(page, 'first-source'); await finish(1);
  await preparedVoiceTurn(page, 2);
  await voiceDisplay(page, 2, 'related-answer', { kind: 'answer', text: 'A related explanation with room for the original information.' });
  await expect(surface).toHaveAttribute('data-workspace-transition', 'moving');
  expect(await page.evaluate(() => window.__speedDisplay.receipts.some(receipt => receipt.id === 'related-answer'))).toBe(false);
  // Resize while the retained region is moving, interrupting layout projection
  // without unmounting it. Missing completion callbacks must not deadlock ACKs.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.setViewportSize({ width: 1280, height: 900 });
  const related = await expectDisplayReceipt(page, 'related-answer'); await finish(2);
  await preparedVoiceTurn(page, 3);
  await voiceDisplay(page, 3, 'replacement-answer', { kind: 'answer', relationship: 'new-subject', text: 'An independent new topic.' });
  const replacement = await expectDisplayReceipt(page, 'replacement-answer'); await finish(3);
  expect(replacement.state).not.toBe(related.state);
  await preparedVoiceTurn(page, 4);
  await voiceDisplay(page, 4, 'history-back', { kind: 'carousel', action: 'back' });
  expect((await expectDisplayReceipt(page, 'history-back')).state).toBe(related.state); await finish(4);
  await expect(surface).toHaveAttribute('data-history-direction', 'back');
  await preparedVoiceTurn(page, 5);
  await voiceDisplay(page, 5, 'history-forward', { kind: 'carousel', action: 'forward' });
  expect((await expectDisplayReceipt(page, 'history-forward')).state).toBe(replacement.state); await finish(5);
  await expect(surface).toHaveAttribute('data-history-direction', 'forward');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('speed: repeated submits start one request and a different question can still interrupt it', async ({ page }) => {
  await streamChat(page);
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Tell me about the studio');
  await input.evaluate(element => {
    const form = element.closest('form')!;
    for (let i = 0; i < 3; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toBeVisible();
  await input.fill('Tell me about the opening hours instead'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__speedChat.cancelled)).toBe(1);
  await page.evaluate(() => window.__speedChat.emit({ type: 'done', text: 'The requested opening hours.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } }));
  await expect(page.getByRole('article', { name: 'Current information', exact: true })).toContainText('The requested opening hours.');
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__speedChat.requests.length)).toBe(2);
});

test('speed: model questions skip command preparation, interrupt and refresh requests', async ({ page }) => {
  await mockAvailability(page);
  await carouselFixture(page, true);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeEnabled();
  await streamChat(page, false);
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Show me your photos'); await input.press('Enter');
  await expect(page.locator('[data-information-surface] [data-task-record]')).toHaveCount(9);
  await expect(page.locator('[data-information-surface]')).toHaveAttribute('aria-busy', 'false');
  const actions: { action: string; call?: { capabilityId: string } }[] = [];
  page.on('request', request => { if (request.url().endsWith('/tasks')) actions.push(request.postDataJSON()); });
  await ask(page);
  expect(actions.filter(action => action.action === 'command')).toHaveLength(0);
  expect(actions.filter(action => ['interrupt', 'refresh', 'execute'].includes(action.action))).toHaveLength(0);
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
});

test('speed: an ambiguous catalog shortcut needs only one request before model handoff', async ({ page }) => {
  await mockAvailability(page);
  await carouselFixture(page, true);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeEnabled();
  await streamChat(page, false);
  const actions: { action: string }[] = [];
  page.on('request', request => { if (request.url().endsWith('/tasks')) actions.push(request.postDataJSON()); });
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Open an unfamiliar thing'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__speedChat.requestId)).not.toBe('');
  expect(actions.filter(action => action.action === 'command')).toHaveLength(1);
  expect(actions.filter(action => ['interrupt', 'refresh', 'execute'].includes(action.action))).toHaveLength(0);
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
});

test('speed: a general information request reaches the model without replacing the current gallery with an empty search', async ({ page }) => {
  await mockAvailability(page);
  await carouselFixture(page, true);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeEnabled();
  await streamChat(page, false);
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  const surface = page.locator('[data-information-surface]');
  await input.fill('Show me your photos'); await input.press('Enter');
  await expect(surface.locator('[data-task-record]')).toHaveCount(9);
  await expect(surface).toHaveAttribute('aria-busy', 'false');
  const probe = page.waitForResponse(response => response.url().endsWith('/tasks') && response.request().postDataJSON()?.action === 'command');
  await input.fill('Show contact information'); await input.press('Enter');
  expect((await (await probe).json()).handled).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(1);
  await expect(surface.locator('[data-task-record]')).toHaveCount(9);
  await expect(surface).not.toContainText('No matches yet');
  await page.evaluate(() => window.__speedChat.emit({ type: 'done', text: 'Contact the studio at hello@harbor.example.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } }));
  await expect(surface).toContainText('Contact the studio at hello@harbor.example.');
  await expect(surface).toHaveAttribute('aria-busy', 'false');
});

test('speed: impossible local commands go directly to the model and preserve interruption', async ({ page }) => {
  await mockAvailability(page);
  await carouselFixture(page, true);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeEnabled();
  await streamChat(page, false);
  const actions: { action: string }[] = [];
  page.on('request', request => { if (request.url().endsWith('/tasks')) actions.push(request.postDataJSON()); });
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Keep those quantities, but make both items whole pies instead.'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(1);
  expect(actions.filter(action => ['command', 'interrupt', 'refresh', 'execute'].includes(action.action))).toHaveLength(0);
  await input.fill('Use three of the second item instead'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__speedChat.requests.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__speedChat.cancelled)).toBe(1);
  expect(actions.filter(action => action.action === 'command')).toHaveLength(0);
  await page.evaluate(() => window.__speedChat.emit({ type: 'done', text: 'Three of the second item.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 23, voiceRemaining: 5, resetsAt: '' } }));
  await expect(page.getByRole('article', { name: 'Current information', exact: true })).toContainText('Three of the second item.');
});

test('speed: chat shows scoped provisional text before completion and commits only the final answer', async ({ page }) => {
  await streamChat(page); await ask(page);
  await page.evaluate(() => {
    const { requestId, emit } = window.__speedChat;
    emit({ type: 'progress', requestId, stage: 'retrieving' });
    emit({ type: 'answer', requestId, round: 0, text: 'The studio offers a calm setting', provisional: true });
    emit({ type: 'answer', requestId: '00000000-0000-4000-8000-000000000001', round: 0, text: 'Obsolete answer', provisional: true });
  });
  await expect(page.locator('[data-chat-progress]')).toContainText('Checking details…');
  await expect(page.locator('[data-provisional-answer]')).toContainText('The studio offers a calm setting');
  await expect(page.locator('[data-provisional-answer]')).toContainText('Answer in progress');
  await expect(page.getByText('Obsolete answer', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Current information', exact: true })).not.toContainText('The studio offers a calm setting');
  await page.evaluate(() => window.__speedChat.emit({ type: 'done', text: 'The studio offers a calm setting for creative work.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } }));
  await expect(page.locator('[data-provisional-answer]')).toHaveCount(0);
  await expect(page.locator('[data-chat-progress]')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Current information', exact: true })).toContainText('The studio offers a calm setting for creative work.');
});

test('speed: cancelling or failing a partial chat clears progress and never commits the partial answer', async ({ page }) => {
  await streamChat(page); await ask(page);
  await page.evaluate(() => window.__speedChat.emit({ type: 'answer', requestId: window.__speedChat.requestId, round: 0, text: 'Unfinished and unverified', provisional: true }));
  await expect(page.locator('[data-provisional-answer]')).toBeVisible();
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await expect(page.locator('[data-provisional-answer]')).toHaveCount(0);
  await expect(page.locator('[data-chat-progress]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__speedChat.cancelled)).toBe(1);
  await page.evaluate(() => { window.__speedChat.requestId = ''; });
  await ask(page);
  await page.evaluate(() => {
    window.__speedChat.emit({ type: 'answer', requestId: window.__speedChat.requestId, round: 0, text: 'Another incomplete answer', provisional: true });
    window.__speedChat.emit({ type: 'error', message: 'Synthetic provider timeout. Try again.', diagnostic: { reason: 'timeout' } });
  });
  await expect(page.locator('[data-provisional-answer]')).toHaveCount(0);
  await expect(page.locator('[data-chat-progress]')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Current information', exact: true })).not.toContainText('Another incomplete answer');
  await expect(page.getByText('Synthetic provider timeout. Try again.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toHaveCount(0);
});

test('speed: a display receipt supplies its initial scene and scrolling the gallery updates it', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await mockAvailability(page);
  await carouselFixture(page, true);
  await observeDisplayReceipts(page);
  const actions: { action: string; operationId?: string; recordIds?: string[] }[] = [];
  page.on('request', request => { if (request.url().endsWith('/tasks')) actions.push(request.postDataJSON()); });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Show me your photos'); await input.press('Enter');
  const surface = page.locator('[data-information-surface]');
  await expect(surface.locator('[data-task-record]')).toHaveCount(9);
  await expect(surface).toHaveAttribute('aria-busy', 'false');
  const receipt = actions.find(action => action.action === 'ack')!;
  await expectDisplayReceipt(page, receipt.operationId!);
  expect(receipt.recordIds!.length).toBeGreaterThan(0);
  expect(receipt.recordIds!.length).toBeLessThan(9);
  expect(actions.filter(action => action.action === 'scene' && action.operationId === receipt.operationId)).toHaveLength(0);
  const last = surface.locator('[data-task-record]').last();
  const lastId = await last.getAttribute('data-task-record');
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => actions.some(action => action.action === 'scene' && action.operationId === receipt.operationId && action.recordIds?.includes(lastId!))).toBe(true);
});

for (const mobile of [false, true]) test(`activity: ${mobile ? 'mobile' : 'desktop'} status changes keep useful results and controls in place`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 393, height: 852 } : { width: 1280, height: 900 });
  await mockAvailability(page); await carouselFixture(page, true); await streamChat(page, false);
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Show me your photos'); await input.press('Enter');
  const surface = page.locator('[data-information-surface]');
  await expect(surface.locator('[data-task-record]')).toHaveCount(9);
  await expect(surface).toHaveAttribute('aria-busy', 'false');
  await ask(page);
  const activity = page.locator('[data-visitor-activity]');
  await expect(activity).toHaveCount(1); await expect(activity).toHaveAttribute('aria-live', 'polite');
  await expect(surface.locator('[data-task-record]')).toHaveCount(9);
  const composer = await input.boundingBox();
  for (const [stage, label] of [['organizing', 'Organizing results…'], ['searching', 'Searching the web…'], ['calculating', 'Calculating…']] as const) {
    await page.evaluate(stage => window.__speedChat.emit({ type: 'progress', requestId: window.__speedChat.requestId, stage }), stage);
    // Assistive technology receives the current status once and immediately;
    // the visual labels may briefly coexist while they crossfade.
    await expect(activity.locator(':scope > span').first()).toHaveText(label);
    await expect(activity.locator('[aria-hidden="true"] > span').filter({ hasText: label })).toHaveCSS('opacity', '1');
    // Measure one frame at a time. Separate protocol calls can straddle the
    // suggestion exit, combining an earlier status with a later shorter dock.
    // Sampling that exit also catches real transient overlap, not just its end.
    const frames = await page.evaluate(async sampleExit => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing activity geometry target: ${selector}`);
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const measure = () => ({ activity: box('[data-visitor-activity]'), modes: box('[data-visitor-conversation-controls]'), dock: box('[data-ai-controls]'), composer: box('textarea[aria-label="What would you like to see?"]') });
      const frames = [measure()], until = performance.now() + (sampleExit ? 400 : 0);
      while (performance.now() < until) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        frames.push(measure());
      }
      return frames;
    }, stage === 'organizing');
    for (const { activity: box, modes, dock, composer: frameComposer } of frames) {
      expect(Math.abs(frameComposer.y - composer!.y)).toBeLessThan(1);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(mobile ? 393 : 1280);
      expect(box.y + box.height).toBeLessThanOrEqual(dock.y + dock.height - 2);
      expect(box.y + box.height <= modes.y || box.x + box.width <= modes.x || box.y >= modes.y + modes.height).toBe(true);
    }
  }
  await expect(surface.getByText('Updating your cards…', { exact: true })).toHaveCount(0);
  await expect(surface.getByText('Updating results…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop request', exact: true }).locator('.lucide-square')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop request', exact: true }).locator('[data-send-glyph="stop"]')).toHaveCSS('opacity', '1');
  await mkdir('docs/screenshots/qa-speed-2026-09-26', { recursive: true });
  await page.screenshot({ path: `docs/screenshots/qa-speed-2026-09-26/activity-${mobile ? 'mobile' : 'desktop'}.png` });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await activity.locator('circle').last().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await page.evaluate(() => window.__speedChat.emit({ type: 'progress', requestId: window.__speedChat.requestId, stage: 'searching' }));
  const reducedLabel = activity.locator('[aria-hidden="true"] > span').filter({ hasText: 'Searching the web…' });
  await expect(reducedLabel).toHaveCSS('opacity', '1');
  await expect(reducedLabel).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Stop request', exact: true }).click();
  await expect(activity).toHaveCount(0); await expect(surface.locator('[data-task-record]')).toHaveCount(9);
});
