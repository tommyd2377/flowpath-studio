import { settingsSection } from './settings-navigation';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
});
async function saveLegacyText(page: Page, text: string) {
  // Legacy records remain supported, although the new settings UI no longer authors them.
  await page.goto('/');
  const saved = (await (await page.request.get('/api/waveform')).json()).waveform;
  const candidate = { name: saved.name, initialPrompt: saved.initialPrompt, textPanel: { type: 'text', version: 1, text } };
  const headers = { origin: 'http://127.0.0.1:3226' };
  const review = await page.request.post('/api/creation-review', { headers, data: { candidate } });
  expect(review.ok()).toBe(true);
  expect((await review.json()).review.status).toBe('allowed');
  const update = await page.request.put('/api/waveform', { headers, data: { ...candidate, voice: saved.voice,
    accentColor: saved.accentColor, profilePhoto: saved.profilePhoto } });
  expect(update.ok()).toBe(true);
  await page.goto('/account');
}
async function createOwner(page: Page, mode: 'creator' | 'intro' | 'visitor' = 'creator', seconds = 300, text?: string) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill(`Paid test ${mode} ${crypto.randomUUID().slice(0, 8)}`);
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic private instructions.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  if (text !== undefined) await saveLegacyText(page, text);
  await settingsSection(page, 'sharing');
  await expect(page.getByText('Publishing & usage', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get a synthetic test pack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic test checkout' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm synthetic test payment', exact: true }).click();
  await expect(page.getByText('Test credit confirmed.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Continue to waveform', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue using my own balance' })).toBeVisible();
  await page.goto('/account');
  await settingsSection(page, 'sharing');
  await page.getByLabel('Who pays for visitors?', { exact: true }).selectOption(mode);
  if (mode !== 'visitor') await page.getByLabel('Finite sponsorship budget', { exact: false }).fill('5');
  if (mode === 'intro') await page.getByLabel('Sponsored minutes per visitor', { exact: true }).fill(String(seconds / 60));
  await page.getByRole('button', { name: /^(Publish|Update published version)$/ }).click();
  await expect(page.getByRole('region', { name: 'Publishing and prepaid minutes' }).getByRole('status')).toContainText('Published.');
  await expect(page.getByRole('link', { name: 'View published version' })).toBeVisible();
  return (await page.getByRole('link', { name: 'View published version' }).getAttribute('href'))!;
}
test('published approved text supports visitor reveal and creator updates without starting voice', async ({ page, browser }) => {
  const text = 'Approved text: <img src=x onerror="window.panelAttack=true">';
  const address = await createOwner(page, 'creator', 300, text);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3226' });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
  try {
    const visitor = await context.newPage();
    let starts = 0;
    visitor.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/paid-session')) starts++; });
    await visitor.goto(address);
    await visitor.getByRole('button', { name: 'Continue with creator-funded time', exact: true }).click();
    await visitor.getByRole('button', { name: 'Show text', exact: true }).click();
    await expect(visitor.getByText(text, { exact: true })).toBeVisible();
    expect(await visitor.evaluate(() => 'panelAttack' in window)).toBe(false);
    const projection = await (await visitor.request.get(`/api/published?id=${address.slice(3)}`)).json();
    expect(projection.waveform.textPanel.text).toBe(text);
    expect(projection.waveform.initialPrompt).toBeUndefined();
    await saveLegacyText(page, 'Updated approved creator text');
    await visitor.reload();
    expect((await (await visitor.request.get(`/api/published?id=${address.slice(3)}`)).json()).waveform.textPanel.text).toBe(text);
    const draft = await (await page.request.get(`/api/published?id=${address.slice(3)}&preview=draft`)).json();
    expect(draft.waveform.textPanel.text).toBe('Updated approved creator text');
    expect((await visitor.request.get(`/api/published?id=${address.slice(3)}&preview=draft`)).status()).toBe(404);
    await settingsSection(page, 'sharing');
    await page.getByRole('button', { name: 'Update published version', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Publishing and prepaid minutes' }).getByRole('status')).toContainText('Published.');
    await visitor.reload();
    await visitor.getByRole('button', { name: 'Continue with creator-funded time', exact: true }).click();
    await expect(visitor.getByRole('button', { name: 'Show text', exact: true })).toBeVisible();
    await visitor.getByRole('button', { name: 'Show text', exact: true }).click();
    await expect(visitor.getByText('Updated approved creator text', { exact: true })).toBeVisible();
    expect(starts).toBe(0);
  } finally { await context.close(); }
});
async function fakeMedia(page: Page) {
  await page.addInitScript(() => {
    const track = { enabled: true, onended: null, stop() {} };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    class Node { connect(n: unknown) { return n; } }
    class AudioContext {
      state = 'running'; destination = {}; resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); }
      createMediaStreamSource() { return new Node(); } createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
      createAnalyser() { return Object.assign(new Node(), { fftSize: 2048, getByteTimeDomainData: (a: Uint8Array) => a.fill(128), getFloatTimeDomainData: (a: Float32Array) => a.fill(0) }); }
    }
    class Audio { autoplay = false; muted = false; srcObject = null; setAttribute() {} play() { return Promise.resolve(); } pause() {} }
    class Peer {
      iceGatheringState = 'complete'; connectionState = 'new'; localDescription: unknown;
      onconnectionstatechange: (() => void) | null = null; ontrack: ((e: object) => void) | null = null;
      channel = { readyState: 'open', onmessage: null as ((e: { data: string }) => void) | null, onclose: null as (() => void) | null,
        close() {}, send: () => queueMicrotask(() => this.channel.onmessage?.({ data: JSON.stringify({ type: 'session.closed' }) })) };
      createDataChannel() { return this.channel; } addTrack() {}
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }); }
      setLocalDescription(o: unknown) { this.localDescription = o; return Promise.resolve(); }
      setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.ontrack?.({ streams: [stream], track });
        queueMicrotask(() => this.channel.onmessage?.({ data: JSON.stringify({ type: 'session.started' }) })); return Promise.resolve(); }
      close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    }
    Object.assign(window, { AudioContext, Audio, RTCPeerConnection: Peer });
  });
}

test('creator publishes, anonymous visitor uses sponsored time, public payload stays minimal, then unpublishes', async ({ page, browser }) => {
  const address = await createOwner(page);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByLabel('Select and copy your link', { exact: true })).toHaveValue(new RegExp(`${address}$`));
  const guest = await browser.newContext();
  const visitor = await guest.newPage(); await fakeMedia(visitor);
  await visitor.goto(`http://127.0.0.1:3226${address}`);
  await expect(visitor.getByRole('button', { name: 'Continue with creator-funded time' })).toBeVisible();
  await expect(visitor.getByRole('link', { name: 'Sign up or log in to continue' })).toHaveCount(0);
  const payload = await (await visitor.request.get(`/api/published?id=${address.slice(3)}`)).json();
  expect(payload.waveform.initialPrompt).toBeUndefined(); expect(payload.ownerUid).toBeUndefined();
  await visitor.getByRole('button', { name: 'Continue with creator-funded time' }).click();
  await visitor.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(visitor.locator('.paid-session-meter')).toContainText('Creator pays');
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(page.getByText('Private. New visitor sessions are blocked.', { exact: false })).toBeVisible();
  // Existing reserved time remains with the original payer and can still settle after unpublishing.
  await visitor.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(visitor.getByText('This waveform is unavailable.', { exact: true })).toBeVisible();
  await visitor.reload(); await expect(visitor.getByText('This waveform is unavailable.', { exact: true })).toBeVisible();
  await guest.close();
});

test('intro depletion survives refresh and signup, preserves destination and requires explicit own-balance continuation', async ({ page, browser }) => {
  const address = await createOwner(page, 'intro', 1);
  const guest = await browser.newContext(); const visitor = await guest.newPage(); await fakeMedia(visitor);
  await visitor.goto(`http://127.0.0.1:3226${address}`);
  await visitor.getByRole('button', { name: 'Continue with creator-funded time' }).click();
  await visitor.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(visitor.getByRole('link', { name: 'Sign up or log in to continue' })).toBeVisible({ timeout: 15_000 });
  await visitor.reload();
  await expect(visitor.getByRole('link', { name: 'Sign up or log in to continue' })).toBeVisible();
  await visitor.getByRole('link', { name: 'Sign up or log in to continue' }).click();
  await visitor.getByRole('button', { name: 'Use test owner B', exact: true }).click();
  await visitor.getByRole('link', { name: 'Continue to waveform', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Continue with creator-funded time' })).toHaveCount(0);
  const buy = visitor.getByRole('button', { name: 'Get a synthetic test pack', exact: true });
  await expect(buy).toBeVisible();
  await buy.click(); await visitor.getByRole('button', { name: 'Confirm synthetic test payment' }).click();
  await visitor.getByRole('link', { name: 'Continue to waveform' }).click();
  await expect(visitor.getByRole('button', { name: 'Continue using my own balance' })).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  await guest.close();
});

test('visitor paywall, canceled checkout, repeated clicks, back navigation and mobile layout', async ({ page, browser }) => {
  const address = await createOwner(page, 'visitor');
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } }); const visitor = await guest.newPage();
  await visitor.goto(`http://127.0.0.1:3226${address}`);
  await expect(visitor.getByText('An account and available paid minutes are needed to continue.', { exact: true }).first()).toBeVisible();
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await visitor.screenshot({ path: 'test-results/paid-paywall-mobile.png', fullPage: true });
  await visitor.getByRole('link', { name: 'Sign up or log in to continue' }).click();
  await visitor.getByRole('button', { name: 'Use test owner B', exact: true }).click();
  await visitor.getByRole('link', { name: 'Continue to waveform', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Continue with creator-funded time' })).toHaveCount(0);
  // The creator's purchase screen exercises cancel/retry without consuming the visitor's retained fixture balance.
  await page.goto('/account');
  await settingsSection(page, 'sharing');
  await page.getByRole('button', { name: 'Get a synthetic test pack', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Synthetic test checkout' })).toBeVisible();
  const checkout = page.url();
  await page.getByRole('link', { name: 'Cancel checkout' }).click();
  await expect(page).toHaveURL(/\/w\/[^?]+\?checkout=canceled$/);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  await page.goBack(); await expect(page).toHaveURL(checkout);
  await page.getByRole('button', { name: 'Confirm synthetic test payment' }).click();
  await expect(page.getByRole('link', { name: 'Continue to waveform' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('link', { name: 'Continue to waveform' })).toBeVisible();
  await guest.close();
});

test('saved admin testing opens directly and a failed start stays visible instead of returning to a confirmation loop', async ({ page }) => {
  const address = await createOwner(page, 'visitor');
  const id = address.slice(3);
  await fakeMedia(page);
  let testing = true;
  await page.route('**/api/published?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), adminTesting: testing, adminVoiceReady: true } });
  });
  await page.route('**/api/billing', route => route.fulfill({ json: { enabled: true, signedIn: true, fixtures: true,
    voiceReady: true, checkoutReady: true, wallet: { balance: 0, available: 0 },
    pack: { id: 'minutes-15', seconds: 900, amount: 500, currency: 'usd' } } }));
  let ready = false, starts = 0;
  await page.route('**/api/session*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: ready, message: 'Synthetic startup failure remains visible.' } });
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    starts++;
    expect(route.request().headers()['x-flowpath-admin']).toBeUndefined();
    return route.fulfill({ json: { sessionId: route.request().postDataJSON().sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + 900_000, adminOverride: true } });
  });
  await page.goto(`/w/${id}`);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Synthetic startup failure remains visible.');
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  expect(starts).toBe(0);
  ready = true;
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(starts).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  testing = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Get a synthetic test pack', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('publishing errors remain inline without an admin confirmation or automatic second request', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Publication fixture');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic instructions.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Preview draft', exact: true })).toBeVisible();
  let attempts = 0;
  await page.route('**/api/publishing{,?*}', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { published: false, settings: { mode: 'intro', allowanceSeconds: 300, budgetSeconds: 0 }, spent: 0, held: 0 } });
    attempts++;
    expect(route.request().postDataJSON().continueAsAdmin).toBeUndefined();
    return route.fulfill({ status: 402, json: { error: 'Sponsored publishing normally requires a funded sponsorship budget.', adminLimit: true } });
  });
  await page.reload();
  await settingsSection(page, 'sharing');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Publishing and prepaid minutes' }).getByRole('status')).toContainText('Sponsored publishing normally requires a funded sponsorship budget.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(attempts).toBe(1);
});

test('saved private drafts preview with their own session scope and only explicit publication updates visitors', async ({ page }) => {
  await fakeMedia(page);
  const address = await createOwner(page, 'visitor');
  const original = (await (await page.request.get(`/api/published?id=${address.slice(3)}`)).json()).waveform;
  await page.goto('/account');
  await page.getByLabel('Waveform name', { exact: true }).fill('Private draft guide');
  await settingsSection(page, 'sharing');
  await expect(page.getByRole('button', { name: 'Update published version', exact: true })).toBeDisabled();
  await expect(page.getByText('Save your draft before publishing these changes.', { exact: true })).toBeVisible();
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('New synthetic draft instructions.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  expect((await (await page.request.get(`/api/published?id=${address.slice(3)}`)).json()).waveform).toEqual(original);
  await page.getByRole('link', { name: 'Preview draft', exact: true }).click();
  await page.getByRole('button', { name: 'Continue using my own balance', exact: true }).click();
  await expect(page.locator('.voice-navigation')).toContainText('Private draft guide');
  const start = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/paid-session');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  expect(new URL((await start).url()).searchParams.get('preview')).toBe('draft');
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue using my own balance', exact: true })).toBeVisible();
  await page.goto('/account');
  await settingsSection(page, 'sharing');
  await page.getByRole('button', { name: 'Update published version', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Publishing and prepaid minutes' }).getByRole('status')).toContainText('Published.');
  expect((await (await page.request.get(`/api/published?id=${address.slice(3)}`)).json()).waveform.name).toBe('Private draft guide');
});

test('founder testing on the published screen selects the published snapshot without a paid payer', async ({ page }) => {
  const address = await createOwner(page, 'visitor');
  await fakeMedia(page);
  await page.route('**/api/published?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), adminTesting: true, adminVoiceReady: true } });
  });
  let starts = 0;
  await page.route('**/api/session*', route => {
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    expect(new URL(route.request().url()).searchParams.get('preview')).toBe('published');
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    starts++;
    return route.fulfill({ json: { sessionId: route.request().postDataJSON().sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + 900_000, adminOverride: true } });
  });
  await page.goto(address);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(starts).toBe(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});
