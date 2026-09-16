import { test, expect, type Page } from '@playwright/test';
import { prepareCarouselVoice } from './helpers/carousel-voice';
import { carouselFixture } from './helpers/carousel-fixture';

declare global {
  interface Window {
    __speedChat: { requestId: string; cancelled: number; emit: (event: Record<string, unknown>) => void };
  }
}

async function streamChat(page: Page) {
  await prepareCarouselVoice(page);
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    window.__speedChat = { requestId: '', cancelled: 0, emit: event => sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)) };
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && init?.method === 'POST') {
        window.__speedChat.requestId = JSON.parse(String(init.body)).requestId;
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

test('speed: chat shows scoped provisional text before completion and commits only the final answer', async ({ page }) => {
  await streamChat(page); await ask(page);
  await page.evaluate(() => {
    const { requestId, emit } = window.__speedChat;
    emit({ type: 'progress', requestId, stage: 'retrieving' });
    emit({ type: 'answer', requestId, round: 0, text: 'The studio offers a calm setting', provisional: true });
    emit({ type: 'answer', requestId: '00000000-0000-4000-8000-000000000001', round: 0, text: 'Obsolete answer', provisional: true });
  });
  await expect(page.locator('[data-chat-progress]')).toContainText('Checking this site’s information…');
  await expect(page.locator('[data-provisional-answer]')).toContainText('The studio offers a calm setting');
  await expect(page.locator('[data-provisional-answer]')).toContainText('Answer in progress');
  await expect(page.getByText('Obsolete answer', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-carousel-card]')).not.toContainText('The studio offers a calm setting');
  await page.evaluate(() => window.__speedChat.emit({ type: 'done', text: 'The studio offers a calm setting for creative work.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } }));
  await expect(page.locator('[data-provisional-answer]')).toHaveCount(0);
  await expect(page.locator('[data-chat-progress]')).toHaveCount(0);
  await expect(page.locator('[data-carousel-card]')).toContainText('The studio offers a calm setting for creative work.');
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
  await expect(page.locator('[data-carousel-card]')).not.toContainText('Another incomplete answer');
  await expect(page.getByText('Synthetic provider timeout. Try again.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toHaveCount(0);
});

test('speed: a display receipt supplies its initial scene and subsequent card changes still update it', async ({ page }) => {
  await carouselFixture(page, true);
  const actions: { action: string; operationId?: string; recordIds?: string[] }[] = [];
  page.on('request', request => { if (request.url().endsWith('/tasks')) actions.push(request.postDataJSON()); });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Show me your photos'); await input.press('Enter');
  const carousel = page.locator('[data-ai-carousel]');
  await expect(carousel).toContainText('9 matching items');
  await expect(carousel).toHaveAttribute('aria-busy', 'false');
  const receipt = actions.find(action => action.action === 'ack')!;
  expect(receipt.recordIds).toHaveLength(1);
  expect(actions.filter(action => action.action === 'scene' && action.operationId === receipt.operationId)).toHaveLength(0);
  await carousel.getByRole('button', { name: 'Next card', exact: true }).click();
  await expect.poll(() => actions.some(action => action.action === 'scene' && action.recordIds?.length === 1 && action.recordIds[0] !== receipt.recordIds![0])).toBe(true);
});
