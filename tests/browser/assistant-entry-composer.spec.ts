import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Site, SiteSummary } from '../../lib/site-model';
import { carouselFixture } from './helpers/carousel-fixture';

const origin = 'http://127.0.0.1:3225';
const firstPrompt = 'Help me find a quiet place to start';
const secondPrompt = 'Help me prepare for a visit';
const firstAnswer = '## A quiet place to start\n\nExplore the published studio collection at your own pace.\n\n- Compare the shapes.\n- Read the maker stories.';
const secondAnswer = '## Prepare for your visit\n\n1. Browse the published collection.\n2. Make a list of your favorite pieces.\n3. Read the studio hours.';
const assistant = (page: Page) => page.locator('[data-ai-layer-open]');
const stage = (page: Page) => page.locator('[data-started]');
const website = (page: Page) => page.locator('[data-website-background]');
const input = (page: Page) => page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
const dock = (page: Page) => page.locator('.platform-conversation-dock');
const results = (page: Page) => page.locator('[data-assistant-results]');
const surface = (page: Page) => page.locator('[data-information-surface]');

type SpeechHarness = {
  starts: number; stops: number; aborts: number; mediaRequests: number;
  transcript: (text: string, final?: boolean) => void;
  deny: () => void;
  end: () => void;
};
type RecordedHarness = { captures: number; starts: number; stops: number; tracksStopped: number; decodes: number; contextsClosed: number };
type TestWindow = typeof window & { __entrySpeech: SpeechHarness; __entryRecorded: RecordedHarness };

async function mockSpeech(page: Page, supported = true, recorded = false) {
  await page.addInitScript(({ supported, recorded }) => {
    const recognition: { current?: MockRecognition } = {};
    const state: SpeechHarness = {
      starts: 0, stops: 0, aborts: 0, mediaRequests: 0,
      transcript(text, final = true) {
        if (!recognition.current) throw new Error('The test must start dictation before sending a transcript.');
        const result = Object.assign([{ transcript: text, confidence: 1 }], { isFinal: final });
        const event = Object.assign(new Event('result'), { resultIndex: 0, results: [result] });
        recognition.current.onresult?.(event); recognition.current.dispatchEvent(event);
      },
      deny() {
        if (!recognition.current) throw new Error('The test must start dictation before denying it.');
        const event = Object.assign(new Event('error'), { error: 'not-allowed', message: 'Synthetic microphone denial' });
        recognition.current.onerror?.(event); recognition.current.dispatchEvent(event); state.end();
      },
      end() {
        const instance = recognition.current; recognition.current = undefined;
        const event = new Event('end'); instance?.onend?.(event); instance?.dispatchEvent(event);
      },
    };
    class MockRecognition extends EventTarget {
      continuous = false; interimResults = false; lang = 'en-US'; maxAlternatives = 1;
      onstart: ((event: Event) => void) | null = null;
      onresult: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onend: ((event: Event) => void) | null = null;
      start() {
        state.starts++; recognition.current = this;
        queueMicrotask(() => { if (recognition.current === this) { const event = new Event('start'); this.onstart?.(event); this.dispatchEvent(event); } });
      }
      stop() { state.stops++; queueMicrotask(() => { if (recognition.current === this) state.end(); }); }
      abort() { state.aborts++; queueMicrotask(() => { if (recognition.current === this) state.end(); }); }
    }
    (window as TestWindow).__entrySpeech = state;
    const audio: RecordedHarness = { captures: 0, starts: 0, stops: 0, tracksStopped: 0, decodes: 0, contextsClosed: 0 };
    (window as TestWindow).__entryRecorded = audio;
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: supported ? MockRecognition : undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
    // An unexpected real microphone request fails locally, without a browser
    // permission prompt or access to an audio device.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      if (recorded) {
        audio.captures++;
        const track = { onended: null, stop() { audio.tracksStopped++; } };
        return { getTracks: () => [track] };
      }
      state.mediaRequests++; throw new DOMException('Unexpected real microphone request in a mocked test', 'NotAllowedError');
    } });
    if (recorded) {
      class MockMediaRecorder {
        state = 'inactive'; mimeType = 'audio/webm';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
        start() { this.state = 'recording'; audio.starts++; }
        stop() {
          if (this.state === 'inactive') return;
          this.state = 'inactive'; audio.stops++;
          queueMicrotask(() => {
            this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) });
            this.onstop?.();
          });
        }
      }
      class MockAudioContext {
        state = 'running';
        async decodeAudioData() {
          audio.decodes++;
          // Half a second of generated samples; no recording or audio device.
          return { sampleRate: 48_000, numberOfChannels: 1, length: 24_000, getChannelData: () => new Float32Array(24_000).fill(.125) };
        }
        async close() { this.state = 'closed'; audio.contextsClosed++; }
      }
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: MockMediaRecorder });
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: MockAudioContext });
    }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak() {}, getVoices: () => [] } });
  }, { supported, recorded });
}

async function prepare(page: Page, options: { opening?: 'website' | 'voice'; enabled?: boolean; mode?: 'both' | 'chat'; logo?: boolean; speech?: boolean; recorded?: boolean; live?: boolean; source?: Site } = {}) {
  await mockSpeech(page, options.speech !== false, options.recorded);
  let site = options.source ?? await carouselFixture(page);
  const post = async (data: unknown) => {
    const response = await page.request.post(`/api/sites/${site.id}`, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body.site as Site;
  };
  const visitor = { ...site.draft.visitor!, enabled: options.enabled ?? true, mode: options.mode ?? 'both' };
  delete visitor.openingExperience;
  if (options.opening) visitor.openingExperience = options.opening;
  site = await post({ action: 'save', revision: site.revision, content: { ...site.draft, visitor,
    ...(options.logo ? { logoAssetId: site.files.find(file => file.kind === 'image')!.id } : {}),
  } });
  site = await post({ action: 'publish', revision: site.revision });
  const availability = { enabled: visitor.enabled, mode: visitor.mode, live: options.live ?? false, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
  const requests: { text?: string; kind: string; history: unknown[] }[] = [];
  await page.route(/\/api\/visitor\/[^/]+\/tasks$/, async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'execute' && body.call.capabilityId === 'query.command') return route.fulfill({ json: { handled: false } });
    return route.fallback();
  });
  await page.route(/\/api\/visitor\/[^/]+\/session\/control$/, route => route.fulfill({ status: 204 }));
  await page.route(/\/api\/visitor\/[^/]+\/session$/, route => route.fulfill({ status: 503, json: { error: 'Live voice is disabled in this isolated suite.' } }));
  await page.route(/\/api\/visitor\/[^/]+$/, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.kind !== 'chat') return route.fulfill({ json: { text: 'Synthetic voice preview.', availability, demo: true } });
    const events = [
      { type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } },
      { type: 'navigation', id: randomUUID(), target: { kind: 'answer', text: body.text === secondPrompt ? secondAnswer : firstAnswer, relationship: 'new-subject' } },
      { type: 'done', text: 'Ready.', displaySatisfied: true, availability },
    ];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.goto(`/s/${site.slug}`);
  await expect(page.locator('.platform-website')).toBeVisible();
  if (visitor.enabled) {
    if (visitor.mode === 'chat') await expect(input(page)).toBeEditable();
    else await expect(page.getByRole('button', { name: options.live ? 'Start conversation' : 'Preview voice', exact: true })).toBeEnabled();
  }
  return { site, requests };
}

async function noMediaRequests(page: Page) {
  expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.mediaRequests)).toBe(0);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function centered(page: Page) {
  await expect(dock(page)).toHaveAttribute('data-expanded', 'true');
  await expect(assistant(page)).toHaveAttribute('data-chat-composing', 'true');
  await expect.poll(() => input(page).evaluate(element => {
    const rect = element.getBoundingClientRect(), viewport = window.visualViewport;
    return Math.abs(rect.top + rect.height / 2 - ((viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) * .42));
  })).toBeLessThan(75);
  await expect(website(page)).toHaveAttribute('inert', '');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveCount(1);
  await expect(page.getByText('What would you like to explore?', { exact: true })).toBeHidden();
  await noOverflow(page);
}

async function submit(page: Page, text: string) {
  await input(page).fill(text); await input(page).press('Enter');
  await expect(input(page)).toHaveValue('');
  await expect(dock(page)).toHaveAttribute('data-expanded', 'false');
  await expect(assistant(page)).toHaveAttribute('data-chat-composing', 'false');
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-has-information', 'true');
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
  await expect(results(page)).not.toHaveAttribute('inert', '');
  await expect.poll(() => input(page).evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(140);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

test('old publications default to the website with a compact assistant and no automatic microphone access', async ({ page }, info) => {
  const { site, requests } = await prepare(page);
  expect(site.published!.visitor).not.toHaveProperty('openingExperience');
  await expect(stage(page)).toHaveAttribute('data-started', 'true');
  await expect(page.getByRole('button', { name: 'Browse website', exact: true })).toBeHidden();
  await expect(website(page)).not.toHaveAttribute('inert', '');
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
  expect((await stage(page).boundingBox())!.height).toBeLessThan(250);
  expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.starts)).toBe(0);
  await noMediaRequests(page); await noOverflow(page); expect(requests).toEqual([]);
  await screenshot(page, info, 'website-first-desktop');
});

test('voice invitation shows publisher identity and an in-viewport Browse website action', async ({ page }, info) => {
  const { requests } = await prepare(page, { opening: 'voice', logo: true });
  await expect(stage(page)).toHaveAttribute('data-started', 'false');
  const bounds = (await stage(page).boundingBox())!;
  expect(bounds.height).toBeGreaterThanOrEqual(page.viewportSize()!.height * .92);
  const publisherLogo = stage(page).getByRole('img', { name: 'Harbor Journal', exact: true });
  await expect(publisherLogo).toBeVisible();
  const logo = (await publisherLogo.boundingBox())!;
  expect(Math.min(logo.width, logo.height)).toBeGreaterThanOrEqual(48);
  const hint = stage(page).getByText(/Tap the wave|Preview voice/);
  await expect(hint).toBeVisible();
  const hintContrast = await hint.evaluate(element => {
    const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
      const channel = Number(value) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(element.closest('[data-started]')!).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(hintContrast, 'the invitation hint remains readable on the publisher background').toBeGreaterThanOrEqual(4.5);
  const browse = page.getByRole('button', { name: 'Browse website', exact: true });
  await expect(browse).toBeInViewport();
  await screenshot(page, info, 'voice-invitation-desktop');
  await browse.click();
  await expect(stage(page)).toHaveAttribute('data-started', 'true');
  await expect.poll(async () => (await stage(page).boundingBox())!.height).toBeLessThan(250);
  await expect(website(page)).not.toHaveAttribute('inert', '');
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
  await noMediaRequests(page); expect(requests).toEqual([]);
  await screenshot(page, info, 'voice-browse-return-desktop');
});

test('an explicit tap collapses the voice invitation before the synthetic preview runs', async ({ page }) => {
  const { requests } = await prepare(page, { opening: 'voice' });
  await expect(stage(page)).toHaveAttribute('data-started', 'false');
  expect(requests).toEqual([]); await noMediaRequests(page);
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect(stage(page)).toHaveAttribute('data-started', 'true');
  await expect.poll(async () => (await stage(page).boundingBox())!.height).toBeLessThan(250);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].kind).toBe('voice');
  await noMediaRequests(page);
});

test('mobile reduced-motion voice invitation changes to one centered chat composer', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page, { opening: 'voice', logo: true });
  await expect(page.getByRole('button', { name: 'Browse website', exact: true })).toBeInViewport();
  await screenshot(page, info, 'voice-invitation-mobile');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await centered(page);
  await expect(stage(page)).toHaveCount(0);
  await expect(surface(page)).toHaveAttribute('data-has-information', 'false');
  expect(await input(page).evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await screenshot(page, info, 'composer-mobile-reduced-motion');
  await page.keyboard.press('Escape');
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
  await expect(website(page)).not.toHaveAttribute('inert', '');
  await input(page).click(); await centered(page); await submit(page, firstPrompt);
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
  await screenshot(page, info, 'answer-mobile-reduced-motion');
  await input(page).click(); await centered(page);
  await expect(results(page)).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'true');
  await expect(results(page)).not.toHaveAttribute('inert', '');
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
  await noOverflow(page);
  await noMediaRequests(page);
});

test('chat refocusing softens retained answers while submit, Escape, Back and Forward preserve them', async ({ page }, info) => {
  const { requests } = await prepare(page, { opening: 'website' });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await centered(page);
  await expect.poll(() => website(page).evaluate(element => getComputedStyle(element).filter)).toMatch(/blur\((?!0px)/);
  await screenshot(page, info, 'composer-desktop');
  await submit(page, firstPrompt);
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
  const firstState = await surface(page).getAttribute('data-surface-state');
  await screenshot(page, info, 'answer-desktop');
  await input(page).click(); await centered(page);
  await expect(results(page)).toHaveAttribute('inert', '');
  await expect.poll(() => surface(page).locator(':scope > div').first().evaluate(element => getComputedStyle(element).filter)).toMatch(/blur\((?!0px)/);
  await expect(surface(page)).toHaveAttribute('data-surface-state', firstState!);
  await expect(surface(page)).toContainText('A quiet place to start');
  await screenshot(page, info, 'refocused-composer-retained-answer');
  await input(page).fill('Keep this unfinished thought');
  await page.keyboard.press('Escape');
  await expect(dock(page)).toHaveAttribute('data-expanded', 'false');
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'true');
  await expect(results(page)).not.toHaveAttribute('inert', '');
  await expect(surface(page)).toHaveAttribute('data-surface-state', firstState!);
  await expect(input(page)).toHaveValue('Keep this unfinished thought');
  await input(page).click(); await centered(page); await submit(page, secondPrompt);
  await expect(surface(page).getByRole('heading', { name: 'Prepare for your visit', exact: true })).toBeVisible();
  await surface(page).getByRole('button', { name: 'Back to previous information' }).click();
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
  await surface(page).getByRole('button', { name: 'Forward to next information' }).click();
  await expect(surface(page).getByRole('heading', { name: 'Prepare for your visit', exact: true })).toBeVisible();
  expect(requests.map(request => request.text)).toEqual([firstPrompt, secondPrompt]);
  expect(JSON.stringify(requests[1].history)).toContain(firstPrompt);
  await noMediaRequests(page); await noOverflow(page);
});

test('an empty composer closes with Escape or its backdrop and keeps keyboard focus off the website', async ({ page }) => {
  await prepare(page);
  const chat = page.getByRole('button', { name: 'Chat', exact: true });
  await chat.click(); await centered(page);
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-website-background], [data-assistant-results]'))).toBe(false);
  }
  await page.keyboard.press('Escape');
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
  await expect(dock(page)).toHaveAttribute('data-expanded', 'false');
  await input(page).click(); await centered(page);
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
  await expect(page.getByText('What would you like to explore?', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await centered(page);
  await page.locator('[data-assistant-backdrop]').click({ position: { x: 12, y: 220 } });
  await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
  await expect(website(page)).not.toHaveAttribute('inert', '');
  await expect(dock(page)).toHaveAttribute('data-expanded', 'false');
  await noMediaRequests(page);
});

test('mocked dictation edits the draft, cancels stale replies, and stops when its composer closes', async ({ page }, info) => {
  const { site, requests } = await prepare(page);
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await centered(page);
  await input(page).fill('Please ');
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__entrySpeech.transcript('show me the studio collection'));
  await expect(input(page)).toHaveValue('Please show me the studio collection');
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dictate message', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.starts)).toBe(1);
  expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.aborts)).toBe(1);
  await screenshot(page, info, 'dictated-draft');
  await page.getByRole('button', { name: 'Show me', exact: true }).click();
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  expect(requests.map(request => request.text)).toEqual(['Please show me the studio collection']);
  const acceptedState = await surface(page).getAttribute('data-surface-state');

  let release!: () => void, delivered!: () => void;
  const pendingReply = new Promise<void>(resolve => { release = resolve; });
  const replyDelivered = new Promise<void>(resolve => { delivered = resolve; });
  const delayedPrompt = 'A delayed reply must not replace my new draft';
  await page.route(`**/api/visitor/${site.slug}`, async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().text !== delayedPrompt) return route.fallback();
    requests.push(route.request().postDataJSON()); await pendingReply;
    const events = [
      { type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } },
      { type: 'navigation', id: randomUUID(), target: { kind: 'answer', text: '## Stale reply must stay hidden\n\nThis reply was cancelled.', relationship: 'new-subject' } },
      { type: 'done', text: 'Stale reply completed.', displaySatisfied: true, availability: { enabled: true, mode: 'both', live: false, chatRemaining: 23, voiceRemaining: 5, resetsAt: '' } },
    ];
    try { await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' }); }
    finally { delivered(); }
  });
  try {
    await input(page).fill(delayedPrompt); await input(page).press('Enter');
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toBeVisible();
    const cancelledRequest = page.waitForEvent('requestfailed', { predicate: request => request.method() === 'POST' && request.url().endsWith(`/api/visitor/${site.slug}`) && request.postDataJSON().text === delayedPrompt });
    await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
    await cancelledRequest;
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await page.evaluate(() => (window as TestWindow).__entrySpeech.transcript('Keep my newly dictated words'));
    await expect(input(page)).toHaveValue('Keep my newly dictated words');
    await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
    release(); await replyDelivered;
    await expect(surface(page)).toHaveAttribute('data-surface-state', acceptedState!);
    await expect(page.getByText('Stale reply must stay hidden', { exact: true })).toHaveCount(0);
    await expect(input(page)).toHaveValue('Keep my newly dictated words');
    await expect(dock(page)).toHaveAttribute('data-expanded', 'true');
    await page.getByRole('button', { name: 'Voice', exact: true }).click();
    await expect(stage(page)).toHaveAttribute('data-started', 'true');
    expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.aborts)).toBe(2);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(input(page)).toHaveValue('Keep my newly dictated words');
    await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dock(page)).toHaveAttribute('data-expanded', 'false');
    expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.aborts)).toBe(3);
    await input(page).click();
    await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return to website', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
    expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.aborts)).toBe(4);
    expect(requests).toHaveLength(2);
  } finally { release(); }
  await noMediaRequests(page);
});

test('unsupported dictation leaves a usable typed composer and makes no microphone attempt', async ({ page }) => {
  const { requests } = await prepare(page, { speech: false });
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await centered(page);
  const microphone = page.getByRole('button', { name: 'Dictate message', exact: true });
  await expect(microphone).toBeEnabled(); await microphone.click();
  await expect(assistant(page)).toContainText('Dictation is unavailable in this browser. You can still type your message.');
  await expect(input(page)).toBeEditable();
  await submit(page, firstPrompt);
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
  expect(requests.map(request => request.text)).toEqual([firstPrompt]);
  expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.starts)).toBe(0);
  await noMediaRequests(page);
});

test('denied dictation retains the draft, reports the failure, and never retries automatically', async ({ page }) => {
  const { requests } = await prepare(page);
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await centered(page);
  await input(page).fill('Keep my typed words');
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__entrySpeech.deny());
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeHidden();
  await expect(assistant(page)).toContainText(/microphone.*(?:denied|blocked|permission)|(?:permission|access).*(?:denied|blocked)|allow.*microphone/i);
  await expect(input(page)).toHaveValue('Keep my typed words');
  await input(page).fill('Typing still works');
  // Observe a short idle window so an automatic restart cannot be hidden by
  // the synchronous error event used by the test double.
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.starts)).toBe(1);
  expect(requests).toEqual([]); await noMediaRequests(page);
  await submit(page, firstPrompt);
  await expect(surface(page).getByRole('heading', { name: 'A quiet place to start', exact: true })).toBeVisible();
});

test('recorded dictation works without native recognition and discards interrupted uploads', async ({ page }, info) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  // Reuse a built-in synthetic demo publisher so the expanded suite stays
  // within the normal local workspace limit without changing product limits.
  const summaries = (await (await page.request.get('/api/sites')).json()).sites as SiteSummary[];
  const seed = summaries.find(site => site.slug === 'sophie-chen')!;
  expect(seed).toBeDefined();
  const source = (await (await page.request.get(`/api/sites/${seed.id}`)).json()).site as Site;
  await page.route(/\/api\/visitor\/[^/]+\/(?:tasks|prepare)$/, route => route.fulfill({ status: 503, json: { error: 'Synthetic task preparation is not needed for dictation.' } }));
  const { site, requests } = await prepare(page, { source, mode: 'chat', speech: false, recorded: true, live: true });
  const uploads: { requestId: string; audio: string }[] = [];
  let release!: () => void, delivered!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const completed = new Promise<void>(resolve => { delivered = resolve; });
  await page.route(`**/api/visitor/${site.slug}/dictation`, async route => {
    expect(route.request().method()).toBe('POST');
    uploads.push(route.request().postDataJSON()); const index = uploads.length;
    expect(index, 'one upload per explicit recording finish, without retries').toBeLessThanOrEqual(2);
    if (index === 2) await deferred;
    try {
      await route.fulfill({ json: { text: index === 1 ? 'show me the studio collection' : 'This late transcript must be discarded', availability: { enabled: true, mode: 'chat', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' } } });
    } finally { if (index === 2) delivered(); }
  });
  try {
    expect(await page.evaluate(() => typeof (window as typeof window & { SpeechRecognition?: unknown }).SpeechRecognition)).toBe('undefined');
    await input(page).click(); await centered(page); await input(page).fill('Please ');
    expect(await page.evaluate(() => (window as TestWindow).__entryRecorded.captures)).toBe(0);
    await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    expect(uploads).toHaveLength(0);
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    await expect(input(page)).toHaveValue('Please show me the studio collection');
    await expect(page.getByRole('button', { name: 'Dictate message', exact: true })).toBeVisible();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Buffer.from(uploads[0].audio, 'base64')).toHaveLength(24_000);
    expect(requests).toEqual([]);
    await expect(input(page)).toBeEditable();
    await screenshot(page, info, 'recorded-dictation-draft');

    // Editing during recording closes the track and recorder without uploading.
    await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await input(page).fill('I will type this myself');
    await expect(page.getByRole('button', { name: 'Dictate message', exact: true })).toBeVisible();
    expect(uploads).toHaveLength(1);

    // A dismissed request can finish at the server, but cannot re-open the
    // composer or overwrite what the visitor writes after returning.
    await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    await expect.poll(() => uploads.length).toBe(2);
    await expect(page.getByRole('button', { name: 'Cancel dictation', exact: true })).toBeVisible();
    const cancelledRequest = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith(`/api/visitor/${site.slug}/dictation`) });
    await page.keyboard.press('Escape'); await cancelledRequest;
    await expect(assistant(page)).toHaveAttribute('data-ai-layer-open', 'false');
    await input(page).click(); await centered(page); await input(page).fill('The visitor kept typing');
    release(); await completed;
    await expect(input(page)).toHaveValue('The visitor kept typing');
    await expect(page.getByText('This late transcript must be discarded', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel dictation', exact: true })).toBeHidden();
    expect(requests).toEqual([]);
    expect(uploads).toHaveLength(2);
    expect(await page.evaluate(() => (window as TestWindow).__entryRecorded)).toEqual({ captures: 3, starts: 3, stops: 3, tracksStopped: 3, decodes: 2, contextsClosed: 2 });
    expect(await page.evaluate(() => (window as TestWindow).__entrySpeech.starts)).toBe(0);
    await noMediaRequests(page);
  } finally { release(); }
});

test('disabled and chat-only visitors skip a saved voice invitation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const disabled = await prepare(page, { opening: 'voice', enabled: false });
  await expect(stage(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Browse website', exact: true })).toHaveCount(0);
  await expect(page.locator('.platform-website')).toBeVisible();
  await noMediaRequests(page); await noOverflow(page);
  await prepare(page, { opening: 'voice', mode: 'chat', source: disabled.site });
  await expect(stage(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Conversation mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Browse website', exact: true })).toHaveCount(0);
  await input(page).click(); await centered(page);
  await expect.poll(() => input(page).evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await screenshot(page, info, 'chat-only-mobile');
  await page.keyboard.press('Escape');
  await expect(website(page)).not.toHaveAttribute('inert', '');
  await noMediaRequests(page); await noOverflow(page);
});
