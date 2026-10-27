import { settingsSection } from './settings-navigation';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type MediaTracker = {
  microphoneCalls: number;
  stoppedTracks: number;
  closedPeers: number;
  closedContexts: number;
  playedAudio: number;
  sentEvents: string[];
  releaseMicrophone: () => void;
  emit: (event: object) => void;
};

const browserErrors = new WeakMap<Page, string[]>();

async function fakeMedia(page: Page, options: { microphone?: 'denied' | 'pending'; blockedPlayback?: boolean } = {}) {
  await page.addInitScript(({ microphone, blockedPlayback }) => {
    const tracker: MediaTracker = {
      microphoneCalls: 0, stoppedTracks: 0, closedPeers: 0, closedContexts: 0,
      playedAudio: 0, sentEvents: [], releaseMicrophone: () => {}, emit: () => {},
    };
    Object.assign(window, { voiceTest: tracker });
    const track = { enabled: true, onended: null, stop() { tracker.stoppedTracks++; } };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => {
        tracker.microphoneCalls++;
        if (microphone === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        if (microphone === 'pending') await new Promise<void>(resolve => { tracker.releaseMicrophone = resolve; });
        return stream;
      } },
    });
    let inputActive = false, outputActive = false;
    class AudioNode { connect(node: unknown) { return node; } }
    let analyserIndex = 0;
    class FakeAudioContext {
      state = 'running';
      destination = {};
      resume() { return Promise.resolve(); }
      close() { this.state = 'closed'; tracker.closedContexts++; return Promise.resolve(); }
      createMediaStreamSource() { return new AudioNode(); }
      createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
      createAnalyser() {
        const output = analyserIndex++ % 2 === 1;
        return Object.assign(new AudioNode(), {
          fftSize: 2048,
          getByteTimeDomainData: (array: Uint8Array) => array.fill((output ? outputActive : inputActive) ? 144 : 128),
          getFloatTimeDomainData: (array: Float32Array) => array.fill((output ? outputActive : inputActive) ? 0.125 : 0),
        });
      }
    }
    class FakeAudio {
      autoplay = false;
      muted = false;
      srcObject: unknown = null;
      setAttribute() {}
      play() {
        tracker.playedAudio++;
        return blockedPlayback && tracker.playedAudio === 1
          ? Promise.reject(new DOMException('Blocked', 'NotAllowedError')) : Promise.resolve();
      }
      pause() {}
    }
    class FakePeer {
      iceGatheringState = 'complete';
      connectionState = 'new';
      localDescription: { type: string; sdp: string } | null = null;
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: unknown) => void) | null = null;
      channel = {
        readyState: 'open',
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        close: () => { this.channel.readyState = 'closed'; this.channel.onclose?.(); },
        send: (value: string) => {
          tracker.sentEvents.push(value);
          if (JSON.parse(value).type === 'session.close') queueMicrotask(() => this.frame({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 4 } }));
        },
      };
      constructor() {
        tracker.emit = event => {
          const type = (event as { type?: string }).type;
          if (type === 'media.input.active') inputActive = true;
          else if (type === 'media.input.quiet') inputActive = false;
          else if (type === 'media.output.active') outputActive = true;
          else if (type === 'media.output.quiet') outputActive = false;
          else this.frame(event);
        };
      }
      frame(event: object) { this.channel.onmessage?.({ data: JSON.stringify(event) }); }
      addTrack() {}
      createDataChannel() { return this.channel; }
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }); }
      setLocalDescription(offer: { type: string; sdp: string }) { this.localDescription = offer; return Promise.resolve(); }
      setRemoteDescription() {
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
        this.ontrack?.({ streams: [stream], track });
        queueMicrotask(() => this.frame({ type: 'session.started', session: { id: 'live_mock' } }));
        return Promise.resolve();
      }
      close() { this.connectionState = 'closed'; tracker.closedPeers++; this.onconnectionstatechange?.(); }
    }
    Object.assign(window, { AudioContext: FakeAudioContext, Audio: FakeAudio, RTCPeerConnection: FakePeer });
  }, options);
}

async function tracker(page: Page) {
  return page.evaluate(() => {
    const value = (window as unknown as { voiceTest: MediaTracker }).voiceTest;
    return { microphoneCalls: value.microphoneCalls, stoppedTracks: value.stoppedTracks,
      closedPeers: value.closedPeers, closedContexts: value.closedContexts,
      playedAudio: value.playedAudio, sentEvents: value.sentEvents };
  });
}

async function emit(page: Page, event: object) {
  await page.evaluate(event => (window as unknown as { voiceTest: MediaTracker }).voiceTest.emit(event), event);
}

test('Knowledge shows sourced passages on request and hiding it leaves voice connected', async ({ page }) => {
  const waveformId = '00000000-0000-4000-8000-000000000099';
  await fakeMedia(page); await mockSession(page);
  await page.route('**/api/waveform*', route => route.fulfill({ json: { waveform: { id: waveformId, name: 'Knowledge guide', textPanel: { type: 'text', version: 2 } } } }));
  let searches = 0;
  await page.route('**/api/knowledge/search', route => {
    searches++; expect(route.request().postDataJSON().waveformId).toBe(waveformId);
    return route.fulfill({ json: { revision: 1, passages: [{ id: 'source_1', documentId: waveformId,
      filename: 'museum.txt', quote: 'The museum opens at nine.' }] } });
  });
  await page.goto(`/w/${waveformId}`);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Text Box content', exact: true });
  await expect(panel).toHaveCount(0);
  const backend = (event: object) => emit(page, { type: 'response.event', delegation_id: 'knowledge_1', event });
  await backend({ type: 'response.created', response: { id: 'knowledge_response' } });
  await backend({ type: 'response.output_item.done', response_id: 'knowledge_response', item: {
    type: 'function_call', name: 'search_waveform_knowledge', call_id: 'knowledge_call',
    arguments: JSON.stringify({ query: 'Opening hours', display: true }),
  } });
  await backend({ type: 'response.completed', response: { id: 'knowledge_response', status: 'completed' } });
  await expect(panel).toContainText('museum opens at nine');
  await expect(page.getByRole('complementary', { name: 'Sources', exact: true })).toContainText('museum.txt');
  await page.getByText('1. museum.txt', { exact: true }).click();
  await expect(page.locator('.knowledge-sources blockquote')).toBeVisible();
  expect(searches).toBe(1);
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(panel).toHaveCount(0); await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect((await tracker(page)).stoppedTracks).toBe(0);
  const events = (await tracker(page)).sentEvents.map(e => JSON.parse(e).type);
  expect(events.filter(type => type === 'response.item.create')).toHaveLength(1);
  expect(events.filter(type => type === 'response.create')).toHaveLength(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('source loaders stay inside Text Box, preserve content, and cannot reopen a hidden panel', async ({ page }) => {
  const waveformId = '00000000-0000-4000-8000-000000000078';
  await fakeMedia(page); await mockSession(page);
  await page.route('**/api/waveform*', route => route.fulfill({ json: { waveform: { id: waveformId,
    name: 'Loader guide', textPanel: { type: 'text', version: 2 } } } }));
  const releases: Array<() => void> = [];
  const responses = [0, 1].map(() => new Promise<void>(resolve => releases.push(resolve)));
  let searches = 0;
  await page.route('**/api/knowledge/search', async route => {
    const index = searches++;
    await responses[index];
    await route.fulfill({ json: { revision: index + 1, passages: [{ id: `source_${index + 1}`, documentId: waveformId,
      filename: 'museum.txt', quote: index ? 'A later result.' : 'The museum opens at nine.' }] } });
  });
  const lookup = async (index: number) => {
    const backend = (event: object) => emit(page, { type: 'response.event', delegation_id: `loader_${index}`, event });
    await backend({ type: 'response.created', response: { id: `loader_response_${index}` } });
    await backend({ type: 'response.output_item.done', response_id: `loader_response_${index}`, item: {
      type: 'function_call', name: 'search_waveform_knowledge', call_id: `loader_call_${index}`,
      arguments: JSON.stringify({ query: 'Opening hours', display: true }),
    } });
    await backend({ type: 'response.completed', response: { id: `loader_response_${index}`, status: 'completed' } });
  };
  try {
    await page.goto(`/w/${waveformId}`);
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
    await lookup(0);
    const panel = page.getByRole('region', { name: 'Text Box content', exact: true });
    await expect(panel).toHaveAttribute('aria-busy', 'true');
    await expect(panel.locator('.brand-loader--component')).toBeVisible();
    await expect(panel.locator('img')).toHaveAttribute('src', /flowpath-icon-square/);
    await expect(page.locator('.brand-loader--screen')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator('.voice-text-panel--live')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: 'test-results/loader-text-box.png' });
    releases[0]();
    await expect(panel).toContainText('The museum opens at nine.');
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    await lookup(1);
    await expect(panel).toHaveAttribute('aria-busy', 'true');
    await expect(panel).toContainText('The museum opens at nine.');
    await expect(page.locator('.live-text-panel__state .brand-loader--inline')).toBeVisible();
    await expect(panel.locator('.brand-loader--component')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.live-text-panel__state img')).toHaveCSS('animation-name', 'none');
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    releases[1]();
    await expect.poll(async () => JSON.stringify((await tracker(page)).sentEvents)).toContain('loader_call_1');
    expect(searches).toBe(2);
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.brand-loader')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
    expect((await tracker(page)).stoppedTracks).toBe(0);
    await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  } finally { releases.forEach(release => release()); }
});

async function syntheticProfilePhoto(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 12; canvas.height = 12;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ba54d2'; context.fillRect(0, 0, 12, 12);
    return canvas.toDataURL('image/png');
  });
}

async function mockSession(page: Page, options: { enabled?: boolean; delayPost?: Promise<void>; durationMs?: number; admin?: boolean; adminOverride?: boolean; adminDeadlineMs?: number } = {}) {
  const calls: { method: string; sessionId?: string; waveformId?: string; demoId?: string; diagnostics?: boolean; admin?: string; previous?: string }[] = [];
  await page.route('**/api/session*', async route => {
    const method = route.request().method();
    const body = method === 'GET' ? null : route.request().postDataJSON();
    calls.push({ method, sessionId: body?.sessionId, waveformId: new URL(route.request().url()).searchParams.get('waveformId') ?? undefined,
      admin: route.request().headers()['x-flowpath-admin'], previous: route.request().headers()['x-flowpath-continue'],
      demoId: route.request().headers()['x-flowpath-demo'], diagnostics: body?.diagnostics });
    if (method === 'GET') await route.fulfill({ json: { adminEligible: options.admin === true, enabled: options.enabled !== false, message: 'Voice is disabled for this local preview.' } });
    else if (method === 'DELETE') await route.fulfill({ status: 204 });
    else {
      await options.delayPost;
      await route.fulfill({ json: { sessionId: body.sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + (options.durationMs ?? 900_000),
        ...(options.admin ? { adminEligible: true, adminOverride: options.adminOverride === true, adminDeadline: Date.now() + (options.adminDeadlineMs ?? 900_000) } : {}) } });
    }
  });
  return calls;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // Fixtures replace all media and server calls. Block external browser traffic.
  await page.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort('blockedbyclient');
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test('diagnostics stay off for ordinary sessions and opening the panel is not consent', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/');
  await expect(page.getByText('Conversation diagnostics', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(calls.find(call => call.method === 'POST')?.diagnostics).toBeUndefined();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
  await page.goto('/?diagnostics=1');
  await expect(page.getByRole('checkbox', { name: 'Record my next conversation locally' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(calls.filter(call => call.method === 'POST').every(call => call.diagnostics === undefined)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save log', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('one opted-in conversation can be marked, reviewed and saved with safe observable metadata', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/?diagnostics=1');
  await page.getByRole('checkbox', { name: 'Record my next conversation locally' }).check();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(calls.find(call => call.method === 'POST')?.diagnostics).toBe(true);
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await emit(page, { type: 'session.input_transcript.delta', delta: 'Can we discuss history?', start_ms: 100, end_ms: 400, event_id: 'private-event', audio: 'private-audio' });
  await emit(page, { type: 'session.delegation.created', offset_ms: 300, delegation: { id: 'private-delegation', type: 'delegation', target: 'client' } });
  await emit(page, { type: 'session.output_transcript.delta', delta: 'That capability is unavailable.', start_ms: 300, end_ms: 500, session: { instructions: 'private-prompt' } });
  await emit(page, { type: 'session.usage.updated', usage: { seconds: 2 } });
  await emit(page, { type: 'session.usage.updated', usage: { seconds: 3 } });
  await emit(page, { type: 'media.output.active' });
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'speaking');
  await page.getByRole('button', { name: 'Mark problem', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveValue(/PROBLEM MARKED/);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Mark problem', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Review log', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveValue(/You \(transcribed\): Can we discuss history\?/);
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveValue(/Observed handoff request to client/);
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveValue(/Provider closure confirmed/);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save log', exact: true }).click();
  const download = await downloadEvent;
  const saved = await readFile((await download.path())!, 'utf8');
  const report = JSON.parse(saved);
  expect(report.recording).toBe(false);
  expect(report.events.filter((event: { type: string }) => event.type === 'usage').map((event: { seconds: number }) => event.seconds)).toEqual([2, 3]);
  expect(report.events.some((event: { name?: string }) => event.name === 'playback_started')).toBe(true);
  expect(saved).not.toMatch(/private-|sessionId|sdp|instructions|cookie/);
  expect(calls.map(call => call.method)).toEqual(['GET', 'POST', 'DELETE']);
  const media = await tracker(page);
  expect(media.stoppedTracks).toBe(1);
  expect(media.closedPeers).toBe(1);
  expect(media.closedContexts).toBe(1);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(calls.filter(call => call.method === 'POST').at(-1)?.diagnostics).toBeUndefined();
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save log', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
  await page.reload();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Save log', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveCount(0);
});

test('stopping or clearing diagnostics leaves the voice running and blocks later transcript capture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/?diagnostics=1');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await emit(page, { type: 'session.input_transcript.delta', delta: 'Retain this fragment.', start_ms: 0, end_ms: 100 });
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await emit(page, { type: 'session.input_transcript.delta', delta: 'Do not retain this.', start_ms: 100, end_ms: 200 });
  await page.getByRole('button', { name: 'Review log', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveValue(/Retain this fragment/);
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).not.toHaveValue(/Do not retain/);
  await page.getByRole('button', { name: 'Clear log', exact: true }).click();
  await emit(page, { type: 'session.output_transcript.delta', delta: 'Late fragment.', start_ms: 200, end_ms: 300 });
  await expect(page.getByRole('button', { name: 'Save log', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Captured exchange' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(calls.map(call => call.method)).toEqual(['GET', 'POST']);
  expect((await tracker(page)).stoppedTracks).toBe(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('loading is quiet and the disabled gate never requests a microphone', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page, { enabled: false });
  await page.goto('/');
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Voice is disabled for this local preview.', { exact: true })).toBeVisible();
  expect(calls.map(call => call.method)).toEqual(['GET']);
  expect((await tracker(page)).microphoneCalls).toBe(0);
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'idle');
});

test('two public tabs settle their first visitor cookie before another readiness request', async ({ page }) => {
  const second = await page.context().newPage();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let gets = 0;
  let secondUsedCookie = false;
  const routeReadiness = async (target: Page) => {
    await fakeMedia(target);
    await target.route('**/api/session*', async route => {
      expect(route.request().method()).toBe('GET');
      const first = ++gets === 1;
      if (first) await pending;
      else secondUsedCookie = (route.request().headers().cookie ?? '').includes('synthetic_demo_cookie=stable');
      await route.fulfill({
        headers: first ? { 'set-cookie': 'synthetic_demo_cookie=stable; Path=/; HttpOnly; SameSite=Strict' } : {},
        json: { enabled: false, message: 'Synthetic paused demo.' },
      });
    });
  };
  try {
    await routeReadiness(page);
    await routeReadiness(second);
    await page.goto('/');
    await second.goto('/');
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect.poll(() => gets).toBe(1);
    await second.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'flowpath-public-voice-identity'))).toBe(true);
    expect(gets).toBe(1);
    await second.getByRole('button', { name: 'Cancel connection', exact: true }).click();
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'flowpath-public-voice-identity'))).toBe(false);
    expect(gets).toBe(1);
    await second.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'flowpath-public-voice-identity'))).toBe(true);
    release();
    await expect.poll(() => gets).toBe(2);
    await expect(second.getByText('Synthetic paused demo.', { exact: true })).toBeVisible();
    expect(secondUsedCookie).toBe(true);
    expect((await tracker(page)).microphoneCalls).toBe(0);
    expect((await tracker(second)).microphoneCalls).toBe(0);
  } finally {
    release();
    await second.close();
  }
});

test('mocked speech animates the waveform and ending releases every resource', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
  await emit(page, { type: 'media.output.active' });
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'speaking');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect.poll(async () => (await tracker(page)).closedPeers).toBe(1);
  const media = await tracker(page);
  expect(media.stoppedTracks).toBe(1);
  expect(media.closedContexts).toBe(1);
  expect(media.sentEvents.map(value => JSON.parse(value).type)).toEqual(['session.close']);
  expect(calls.map(call => call.method)).toEqual(['GET', 'POST', 'DELETE']);
  expect(calls[1].sessionId).toBe(calls[2].sessionId);
});

test('startup status follows setup and first audible speech, then resets for the next call', async ({ page }) => {
  await fakeMedia(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const calls = await mockSession(page, { delayPost: pending });
  await page.clock.install();
  await page.goto('/');
  const status = page.getByRole('status');
  try {
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect.poll(() => calls.some(call => call.method === 'POST')).toBe(true);
    await expect(status).toHaveText('Connecting…');
    await expect(page.getByRole('button', { name: 'Cancel connection', exact: true })).toHaveAttribute('aria-describedby', 'voice-status');
    release();
    await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
    await expect(status).toHaveText('Getting ready…');
    await emit(page, { type: 'media.input.active' });
    await page.clock.fastForward(3_000);
    await expect(status).toHaveText('Getting ready…');
    await page.screenshot({ path: 'test-results/waveform-getting-ready.png' });
    await emit(page, { type: 'media.output.active' });
    await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'speaking');
    await expect(status).toBeEmpty();
    await emit(page, { type: 'media.output.quiet' });
    await page.clock.fastForward(800);
    await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
    await expect(status).toBeEmpty();
    await page.getByRole('button', { name: 'End conversation', exact: true }).click();
    await expect.poll(async () => (await tracker(page)).closedPeers).toBe(1);
    await expect(status).toBeEmpty();
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(status).toHaveText('Getting ready…');
    await page.getByRole('button', { name: 'End conversation', exact: true }).click();
    await expect.poll(async () => (await tracker(page)).closedPeers).toBe(2);
    expect(new Set(calls.map(call => call.demoId)).size).toBe(1);
  } finally { release(); }
});

test('the public account link stays available while talking and navigation closes the conversation', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'FlowPath News example', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Create your waveform', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'My waveform', exact: true })).toBeVisible();
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  await expect.poll(async () => (await tracker(page)).closedPeers).toBe(1);
  await expect.poll(() => calls.some(call => call.method === 'DELETE')).toBe(true);
});

test('denied microphone access reports the problem without creating a session', async ({ page }) => {
  await fakeMedia(page, { microphone: 'denied' });
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Microphone access was denied. Allow microphone access to start a conversation.', { exact: true })).toBeVisible();
  expect(calls.map(call => call.method)).toEqual(['GET']);
  expect((await tracker(page)).closedContexts).toBe(1);
});

test('cancelling a pending microphone request stops a late stream', async ({ page }) => {
  await fakeMedia(page, { microphone: 'pending' });
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).microphoneCalls).toBe(1);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await page.evaluate(() => (window as unknown as { voiceTest: MediaTracker }).voiceTest.releaseMicrophone());
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  expect(calls.map(call => call.method)).toEqual(['GET']);
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'idle');
});

test('cancelling a pending server creation cleans the reservation and ignores its late answer', async ({ page }) => {
  let releasePost!: () => void;
  const delayPost = new Promise<void>(resolve => { releasePost = resolve; });
  await fakeMedia(page);
  const calls = await mockSession(page, { delayPost });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => calls.some(call => call.method === 'POST')).toBe(true);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).closedPeers).toBe(1);
  expect((await tracker(page)).stoppedTracks).toBe(1);
  releasePost();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(2);
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'idle');
  expect(calls.filter(call => call.method !== 'GET').every(call => call.sessionId === calls[1].sessionId)).toBe(true);
  expect(calls.every(call => call.demoId === calls[0].demoId)).toBe(true);
});

test('a new waveform gesture resumes blocked playback and Escape can end it', async ({ page }) => {
  await fakeMedia(page, { blockedPlayback: true });
  await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Tap the wave to resume audio playback.');
  await page.getByRole('button', { name: 'Resume voice playback', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Getting ready…');
  await emit(page, { type: 'media.output.active' });
  await expect(page.getByRole('status')).toBeEmpty();
  expect((await tracker(page)).playedAudio).toBe(2);
  expect((await tracker(page)).microphoneCalls).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
});

test('a quiet conversation closes after its idle limit', async ({ page }) => {
  await fakeMedia(page);
  await mockSession(page);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.clock.fastForward(46_000);
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  await expect(page.getByText('Conversation ended after 45 seconds of silence.', { exact: true })).toBeVisible();
});

test('the server deadline also ends a conversation with continuing speech', async ({ page }) => {
  await fakeMedia(page);
  await mockSession(page, { durationMs: 5_000 });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await emit(page, { type: 'media.output.active' });
  await page.clock.fastForward(6_000);
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  await expect(page.getByText('The conversation limit has been reached.', { exact: true })).toBeVisible();
});

test('a public page keeps its demo scope through the three-minute limit and refresh starts a fresh scope', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page, { durationMs: 180_000 });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await emit(page, { type: 'media.output.active' });
  await page.clock.fastForward(180_001);
  await expect(page.getByText('The conversation limit has been reached.', { exact: true })).toBeVisible();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(1);
  const firstPageId = calls[0].demoId;
  expect(firstPageId).toMatch(/^[0-9a-f-]{36}$/);
  expect(calls.every(call => call.demoId === firstPageId)).toBe(true);
  const previousCalls = calls.length;
  // Align the reloaded browser with the host clock that issues fixture deadlines.
  await page.clock.setSystemTime(new Date());
  await page.reload();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  const nextPageId = calls[previousCalls].demoId;
  expect(nextPageId).toMatch(/^[0-9a-f-]{36}$/);
  expect(nextPageId).not.toBe(firstPageId);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(2);
  expect(calls.slice(previousCalls).every(call => call.demoId === nextPageId)).toBe(true);
});

test('the real local readiness route is paused and creates no microphone session', async ({ page }) => {
  await fakeMedia(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Live voice is paused for this local preview.', { exact: true })).toBeVisible();
  expect((await tracker(page)).microphoneCalls).toBe(0);
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`the waveform glides to the fading logo and returns at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await fakeMedia(page);
    await mockSession(page);
    await page.goto('/');
    const wave = page.locator('.wave-control');
    const initial = (await wave.boundingBox())!;
    const logo = (await page.locator('.wordmark img').boundingBox())!;
    const studio = page.locator('.wordmark-studio');
    await expect(studio).toHaveText('Studio');
    const studioBounds = (await studio.boundingBox())!;
    expect(Math.abs(studioBounds.x + studioBounds.width / 2 - (logo.x + logo.width / 2))).toBeLessThan(1);
    expect(studioBounds.y).toBeGreaterThan(logo.y + logo.height * .79);
    expect(studioBounds.y + studioBounds.height).toBeLessThanOrEqual(logo.y + logo.height);
    expect(Math.abs(initial.y + initial.height / 2 - viewport.height / 2)).toBeLessThan(1);
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
    const navigation = page.getByRole('navigation', { name: 'FlowPath navigation', exact: true });
    const newsLink = navigation.getByRole('link', { name: 'FlowPath News example', exact: true });
    const accountLink = navigation.getByRole('link', { name: 'Create your waveform', exact: true });
    await expect(newsLink).toHaveAttribute('href', 'https://flowpathapp.com');
    await expect(newsLink).not.toHaveAttribute('target', '_blank');
    await expect(accountLink).toHaveAttribute('href', '/account');
    const newsBounds = (await newsLink.boundingBox())!;
    const accountBounds = (await accountLink.boundingBox())!;
    expect(newsBounds.x + newsBounds.width).toBeLessThan(accountBounds.x);
    expect(Math.abs(newsBounds.y - accountBounds.y)).toBeLessThan(1);
    const newsStyle = await newsLink.evaluate(element => ({ color: getComputedStyle(element).color, fontSize: getComputedStyle(element).fontSize }));
    await expect(accountLink).toHaveCSS('color', newsStyle.color);
    await expect(accountLink).toHaveCSS('font-size', newsStyle.fontSize);
    await page.screenshot({ path: `test-results/waveform-${viewport.width}-idle.png` });
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
    for (const selector of ['.wordmark', '.voice-hint', '.wave-control']) {
      await expect(page.locator(selector)).toHaveCSS('transition-duration', '0.8s');
      await expect(page.locator(selector)).toHaveCSS('transition-timing-function', 'ease-in-out');
    }
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '0');
    await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '0');
    await expect(newsLink).toBeVisible();
    await expect(accountLink).toBeVisible();
    await page.screenshot({ path: `test-results/waveform-${viewport.width}-connected.png` });
    const connected = (await wave.boundingBox())!;
    expect(Math.abs(connected.y + connected.height / 2 - (logo.y + logo.height / 2))).toBeLessThan(1);
    expect(connected.width).toBe(initial.width);
    expect(connected.height).toBe(initial.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const pixels = await page.locator('canvas').evaluate(canvas => {
      const element = canvas as HTMLCanvasElement;
      return [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data]
        .some((value, index) => index % 4 === 3 && value > 0);
    });
    expect(pixels).toBe(true);
    await page.getByRole('button', { name: 'End conversation', exact: true }).click();
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
    await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '1');
    await expect(newsLink).toBeVisible();
    await expect(accountLink).toBeVisible();
    const returned = (await wave.boundingBox())!;
    expect(Math.abs(returned.y - initial.y)).toBeLessThan(1);
  });
}

test('reduced motion keeps the opening transition immediate and the control keyboard accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeMedia(page);
  await mockSession(page);
  await page.goto('/');
  const wave = page.getByRole('button', { name: 'Start conversation', exact: true });
  await wave.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
  await expect(page.locator('.wordmark')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.wave-control')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '0');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeFocused();
  await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '1');
});

test('a private waveform keeps its scope during cancellation and late session cleanup', async ({ page }) => {
  const waveformId = '00000000-0000-4000-8000-000000000001';
  await page.route('**/api/waveform?id=*', route => route.fulfill({ json: { waveform: { id: waveformId, name: 'Private test voice' } } }));
  let releasePost!: () => void;
  const delayPost = new Promise<void>(resolve => { releasePost = resolve; });
  await fakeMedia(page);
  const calls = await mockSession(page, { delayPost });
  await page.goto(`/w/${waveformId}?diagnostics=1`);
  await expect(page.locator('.voice-navigation')).toContainText('Private test voice');
  await expect(page.locator('.wordmark-studio')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Record my next conversation locally' }).check();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => calls.some(call => call.method === 'POST')).toBe(true);
  expect(calls.find(call => call.method === 'POST')?.diagnostics).toBe(true);
  await expect(page.locator('.voice-navigation')).toBeHidden();
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  releasePost();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(2);
  expect(calls.every(call => call.waveformId === waveformId)).toBe(true);
  expect(calls.every(call => call.demoId === undefined)).toBe(true);
  await expect(page.locator('.voice-navigation')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save log', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'));
  expect(saved.surface).toBe('personal');
  expect(saved.recording).toBe(false);
  expect(JSON.stringify(saved)).not.toContain(waveformId);
});

test('account changes unmount a private conversation and release its microphone', async ({ page }) => {
  const waveformId = '00000000-0000-4000-8000-000000000002';
  let authorized = true;
  await page.route('**/api/waveform?id=*', route => authorized
    ? route.fulfill({ json: { waveform: { id: waveformId, name: 'Private test voice' } } })
    : route.fulfill({ status: 401, json: { error: 'Sign in required.' } }));
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto(`/w/${waveformId}`);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  authorized = false;
  await page.evaluate(() => window.dispatchEvent(new Event('flowpath-account-change')));
  await expect(page.getByRole('status')).toContainText('Sign in to open your private waveform.');
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  await expect.poll(async () => (await tracker(page)).closedPeers).toBe(1);
  expect(calls.some(call => call.method === 'DELETE' && call.waveformId === waveformId)).toBe(true);
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`a private photo and color keep the opening transition aligned at ${viewport.width}px`, async ({ page }) => {
    const waveformId = '00000000-0000-4000-8000-000000000003';
    const profilePhoto = await syntheticProfilePhoto(page);
    await page.setViewportSize(viewport);
    await fakeMedia(page);
    await mockSession(page);
    await page.route('**/api/waveform?id=*', route => route.fulfill({ json: { waveform: {
      id: waveformId, name: 'Synthetic profile', accentColor: '#4069e1', profilePhoto,
    } } }));
    await page.goto(`/w/${waveformId}`);
    const photo = page.getByRole('img', { name: 'Synthetic profile profile photo', exact: true });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute('src', profilePhoto);
    const accent = await page.locator('.voice-experience').evaluate(element => getComputedStyle(element).getPropertyValue('--accent-rgb').replace(/\s/g, ''));
    expect(accent).toBe('64,105,225');
    const newsLink = page.getByRole('link', { name: 'FlowPath News example', exact: true });
    const accountLink = page.getByRole('link', { name: 'My waveform', exact: true });
    await expect(newsLink).toHaveCount(0);
    await expect(accountLink).toBeVisible();
    const wave = page.locator('.wave-control');
    const initial = (await wave.boundingBox())!;
    const identity = (await photo.boundingBox())!;
    expect(Math.abs(initial.y + initial.height / 2 - viewport.height / 2)).toBeLessThan(1);
    await page.screenshot({ path: `test-results/private-profile-${viewport.width}-idle.png` });
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
    await expect(page.locator('.voice-navigation')).toBeHidden();
    for (const selector of ['.wordmark', '.voice-hint', '.wave-control']) {
      await expect(page.locator(selector)).toHaveCSS('transition-duration', '0.8s');
      await expect(page.locator(selector)).toHaveCSS('transition-timing-function', 'ease-in-out');
    }
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
    await expect(page.locator('.wordmark')).toHaveAttribute('aria-hidden', 'false');
    const portraitTop = viewport.width <= 600 ? 32 : viewport.height <= 650 ? 24 : 48;
    await expect.poll(async () => Math.abs((await photo.boundingBox())!.y - portraitTop)).toBeLessThan(1);
    await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '0');
    const connected = (await wave.boundingBox())!;
    const connectedPhoto = (await photo.boundingBox())!;
    if (viewport.width > 600) {
      expect(Math.abs(connectedPhoto.y + connectedPhoto.height / 2 - (connected.y + connected.height / 2))).toBeLessThan(1);
      expect(connectedPhoto.x + connectedPhoto.width).toBeLessThan(connected.x);
    } else expect(connectedPhoto.y + connectedPhoto.height).toBeLessThanOrEqual(connected.y);
    await expect(photo).toBeVisible();
    expect(connected.width).toBeLessThanOrEqual(initial.width);
    expect(connected.height).toBeLessThan(initial.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const tinted = await page.locator('canvas').evaluate(canvas => {
      const element = canvas as HTMLCanvasElement;
      const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > 30 && pixels[index + 2] > pixels[index] + 20) return true;
      }
      return false;
    });
    expect(tinted).toBe(true);
    await page.screenshot({ path: `test-results/private-profile-${viewport.width}-connected.png` });
    await page.keyboard.press('Escape');
    await expect.poll(async () => Math.abs((await photo.boundingBox())!.y - identity.y)).toBeLessThan(1);
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
    await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '1');
    const returned = (await wave.boundingBox())!;
    expect(Math.abs(returned.y - initial.y)).toBeLessThan(1);
    await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeFocused();
    await page.goto('/');
    await expect(page.getByRole('img', { name: 'FlowPath', exact: true })).toHaveAttribute('src', /flowpath-logo-full/);
    await expect(page.locator('.profile-photo')).toHaveCount(0);
    await expect(page.locator('.voice-experience')).toHaveCSS('background-color', 'rgb(16, 17, 16)');
    await expect(page.locator('.voice-hint')).toHaveCSS('color', 'rgb(175, 187, 230)');
    const defaultAccent = await page.locator('.voice-experience').evaluate(element => getComputedStyle(element).getPropertyValue('--accent-rgb').replace(/\s/g, ''));
    expect(defaultAccent).toBe('58,102,255');
  });
}

test('a private profile remains accessible with reduced motion and an immediate transition', async ({ page }) => {
  const waveformId = '00000000-0000-4000-8000-000000000004';
  const profilePhoto = await syntheticProfilePhoto(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeMedia(page);
  await mockSession(page);
  await page.route('**/api/waveform?id=*', route => route.fulfill({ json: { waveform: {
    id: waveformId, name: 'Reduced motion profile', accentColor: '#f24051',
    profilePhoto,
  } } }));
  await page.goto(`/w/${waveformId}`);
  const photo = (await page.getByRole('img', { name: 'Reduced motion profile profile photo', exact: true }).boundingBox())!;
  const wave = page.locator('.wave-control');
  await wave.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
  await expect(page.locator('.wordmark')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.wave-control')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '0');
  const connected = (await wave.boundingBox())!;
  const connectedPhoto = (await page.locator('.profile-photo').boundingBox())!;
  expect(Math.abs(connectedPhoto.y - 48)).toBeLessThan(1);
  expect(Math.abs(connectedPhoto.y + connectedPhoto.height / 2 - (connected.y + connected.height / 2))).toBeLessThan(1);
  expect(connectedPhoto.x + connectedPhoto.width).toBeLessThan(connected.x);
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
  await expect(page.locator('.wordmark')).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeFocused();
  await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
  expect(Math.abs((await page.locator('.profile-photo').boundingBox())!.y - photo.y)).toBeLessThan(1);
});

test('admin with testing off reaches the regular demo limit without a modal or automatic restart', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page, { durationMs: 1_100, admin: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  expect((await tracker(page)).stoppedTracks).toBe(1);
});

test('admin with testing off keeps the normal silence limit', async ({ page }) => {
  await page.clock.install();
  await fakeMedia(page);
  const calls = await mockSession(page, { admin: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.clock.fastForward(46_000);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
});

test('saved admin testing removes silence cutoff but still ends after 15 minutes without confirmation clicks', async ({ page }) => {
  await page.clock.install();
  await fakeMedia(page);
  const calls = await mockSession(page, { admin: true, adminOverride: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.clock.fastForward(46_000);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.clock.fastForward(854_001);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  expect(calls.some(call => call.admin || call.previous)).toBe(false);
});

test('ordinary users and the final 15-minute cap never offer an admin override', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page, { durationMs: 1_100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await mockSession(page, { durationMs: 1_100, admin: true, adminOverride: true, adminDeadlineMs: 1_100 });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await emit(page, { type: 'session.closed' });
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a normal allowance denial stays visible without microphone permission or an admin modal', async ({ page }) => {
  await fakeMedia(page);
  await page.route('**/api/session*', route => route.fulfill({ json: { enabled: false, adminLimit: true, message: 'This page’s three-minute demo has ended.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('This page’s three-minute demo has ended.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await tracker(page)).microphoneCalls).toBe(0);
});

for (const admin of [true, false]) test(`Text Box survives settlement on the ${admin ? 'Google admin' : 'paid payer'} route`, async ({ page }) => {
  await fakeMedia(page);
  await mockSession(page, { admin, adminOverride: admin });
  const id = 'b1111111-1111-4111-8111-111111111111';
  const waveform = { id, name: 'Text assistant', accentColor: '#3a66ff', profilePhoto: null, textPanel: { type: 'text', version: 2 } };
  await page.route('**/api/waveform*', route => route.fulfill({ json: { waveform } }));
  await page.route('**/api/billing', route => route.fulfill({ json: { enabled: true, signedIn: true, voiceReady: true,
    wallet: { balance: 100, available: 100 }, pack: { id: 'fixture', seconds: 900, amount: 500, currency: 'usd' } } }));
  await page.route('**/api/published?*', route => route.fulfill({ json: { waveform, mode: 'visitor', sponsoredSeconds: 0,
    own: true, reason: '', adminTesting: admin, adminVoiceReady: admin } }));
  await page.route('**/api/paid-session*', route => route.fulfill({ json: route.request().method() === 'GET' ? { enabled: true }
    : route.request().method() === 'DELETE' ? { closed: true }
      : { sessionId: route.request().postDataJSON().sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + 900_000 } }));
  await page.goto(`/w/${id}`);
  if (!admin) await page.getByRole('button', { name: 'Continue using my own balance', exact: true }).click();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await emit(page, { type: 'session.input_transcript.delta', event_id: 'notes', delta: 'Start writing. Notes to copy.', start_ms: 0, end_ms: 100 });
  const box = page.getByRole('region', { name: 'Text Box content', exact: true });
  await expect(box).toHaveText('Notes to copy.');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
  await expect(box).toHaveText('Notes to copy.');
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
  if (admin) await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  else {
    await page.getByRole('button', { name: 'Choose next conversation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continue using my own balance', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  }
});

test('normal account plugin flow supports dictation, delegated updates, controls and a fresh conversation', async ({ page }) => {
  await fakeMedia(page);
  await mockSession(page);
  const waveformId = 'a1111111-1111-4111-8111-111111111111';
  let waveform = { id: waveformId, ownerUid: 'synthetic-google-owner', name: 'Text assistant', initialPrompt: 'Be helpful.',
    voice: 'marin', accentColor: '#3a66ff', profilePhoto: null, updatedAt: 1,
    textPanel: null as { type: 'text'; version: 2 } | null };
  // Mock transport, not a replacement UI: exercise the normal Firebase account branch.
  await page.route('**/api/account', route => route.fulfill({ json: { mode: 'firebase', creationSafetyEnabled: false,
    user: { uid: waveform.ownerUid, displayName: 'Synthetic Google member' } } }));
  await page.route('**/api/waveform*', async route => {
    if (route.request().method() === 'PUT') waveform = { ...waveform, ...route.request().postDataJSON() };
    await route.fulfill({ json: { waveform } });
  });
  await page.goto('/account');
  await expect(page.getByRole('button', { name: /Use test owner/ })).toHaveCount(0);
  await expect(page.getByLabel('Text below the waveform (optional)', { exact: true })).toHaveCount(0);
  await settingsSection(page, 'plugins');
  await page.getByRole('button', { name: 'Apply plugin', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  expect(waveform.textPanel).toEqual({ type: 'text', version: 2 });
  await page.getByRole('link', { name: 'Preview draft', exact: true }).click();
  const box = page.getByRole('region', { name: 'Text Box content', exact: true });
  await expect(box).toHaveCount(0);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(box).toHaveCount(0);
  let time = 0;
  async function speech(delta: string) {
    await emit(page, { type: 'session.input_transcript.delta', event_id: `text_${time}`, delta, start_ms: time, end_ms: time + 100 });
    time += 100;
  }
  await speech('Start writ'); await speech('ing. ');
  await speech('Buy egg'); await speech('s and milk. ');
  await expect(box).toHaveText('Buy eggs and milk. ');
  await speech('Stop writ'); await speech('ing.');
  await speech('This stays out of the box.');
  await expect(box).toHaveText('Buy eggs and milk. ');
  await expect(page.getByRole('button', { name: 'Stop writing', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await speech('Hide the text '); await speech('box.');
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toHaveCount(0);
  await speech('Ordinary conversation stays private to speech.');
  await expect(box).toHaveCount(0);
  await speech('Show the text box.');
  await expect(box).toHaveText('Buy eggs and milk. ');
  await expect(page.getByRole('button', { name: 'Stop writing', exact: true })).toBeDisabled();

  const malicious = '<script>window.textPluginAttack=true</script>\nA short answer.';
  const envelope = (event: object) => ({ type: 'response.event', delegation_id: 'text_job', event });
  await emit(page, envelope({ type: 'response.created', response: { id: 'resp_text' } }));
  await emit(page, envelope({ type: 'response.output_item.done', response_id: 'resp_text', item: {
    type: 'function_call', status: 'completed', name: 'update_text_box', call_id: 'call_text',
    arguments: JSON.stringify({ action: 'replace', text: malicious }),
  } }));
  await emit(page, envelope({ type: 'response.completed', response: { id: 'resp_text', status: 'completed' } }));
  await expect(box).toHaveText(malicious);
  expect(await page.evaluate(() => 'textPluginAttack' in window)).toBe(false);
  const sent = (await tracker(page)).sentEvents.map(value => JSON.parse(value));
  expect(sent.filter(event => event.type === 'response.create')).toHaveLength(1);
  expect(sent.find(event => event.type === 'response.item.create')?.item.call_id).toBe('call_text');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(box).toHaveText('Buy eggs and milk. ');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Voice waveform', exact: true })).toBeFocused();
  await speech('Start writing. Another line.');
  await page.getByRole('button', { name: 'Stop writing', exact: true }).click();
  await speech('Late speech is ignored.');
  await expect(box).toContainText('Another line.');
  await expect(box).not.toContainText('Late speech');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await box.evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
  await expect(box).toContainText('Another line.');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(box).toContainText('Another line.');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(box).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Show text', exact: true }).click();
  await expect(box).toContainText('Another line.');
  await expect(page.locator('.voice-text-panel--live')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(box).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
  await page.goto('/account');
  await settingsSection(page, 'plugins');
  await page.getByRole('button', { name: 'Remove Text Box', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  expect(waveform.textPanel).toBeNull();
  await page.getByRole('link', { name: 'Preview draft', exact: true }).click();
  await expect(box).toHaveCount(0);
});

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1366, height: 768 },
  { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 640, height: 360 },
]) test(`requested Text Box keeps its full frame and controls inside ${viewport.width}×${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await fakeMedia(page); await mockSession(page);
  const id = 'c1111111-1111-4111-8111-111111111111';
  const profilePhoto = await syntheticProfilePhoto(page);
  await page.route('**/api/waveform*', route => route.fulfill({ json: { waveform: {
    id, name: 'Layout assistant', profilePhoto, accentColor: '#3a66ff', textPanel: { type: 'text', version: 2 },
  } } }));
  await page.goto(`/w/${id}`);
  const box = page.getByRole('region', { name: 'Text Box content', exact: true });
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'FlowPath News example', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect(box).toHaveCount(0);
  const notes = Array.from({ length: 80 }, (_, index) => `Line ${index + 1}: these are conversation notes.\n`).join('');
  await emit(page, { type: 'session.input_transcript.delta', event_id: 'layout_notes', delta: `Start writing. ${notes}`, start_ms: 0, end_ms: 100 });
  await expect(box).toHaveText(notes);
  const panel = page.locator('.voice-text-panel--live');
  await expect(panel).toHaveCSS('animation-duration', '0.8s');
  // Wait for the reveal to reach its intended resting geometry.
  await expect.poll(() => panel.evaluate(node => getComputedStyle(node).translate)).toBe('none');
  const bounds = (await panel.boundingBox())!;
  expect(bounds.y).toBeGreaterThan(100);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 12);
  for (const name of ['Stop writing', 'Undo', 'Clear', 'Copy text', 'Hide']) {
    const control = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(control.y).toBeGreaterThan(bounds.y);
    expect(control.y + control.height).toBeLessThanOrEqual(viewport.height - 12);
    expect(control.x).toBeGreaterThanOrEqual(0);
    expect(control.x + control.width).toBeLessThanOrEqual(viewport.width);
  }
  expect(await box.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `test-results/text-workspace-${viewport.width}-${viewport.height}.png` });
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.locator('#voice-status')).toHaveText('');
});

test('hosted browser control greets once, keeps voice during heartbeats and waits for server-confirmed close', async ({ page }) => {
  await fakeMedia(page); await page.clock.install();
  const calls: string[] = [];
  await page.route('**/api/session*', async route => {
    const method = route.request().method(); calls.push(method);
    if (method === 'GET') return route.fulfill({ json: { enabled: true } });
    if (method === 'POST') return route.fulfill({ json: { sessionId: route.request().postDataJSON().sessionId, sdp: 'v=0\r\n',
      expiresAt: Date.now() + 180_000, browserControl: true, heartbeatMs: 10_000, adminOverride: false } });
    return route.fulfill({ json: method === 'DELETE' ? { closed: true } : { expiresAt: Date.now() + 150_000 } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await emit(page, { type: 'session.started' });
  expect((await tracker(page)).sentEvents.map(value => JSON.parse(value).type).filter(type => type === 'session.instructions.append')).toHaveLength(1);
  await page.clock.fastForward(11_000); await expect.poll(() => calls.filter(value => value === 'PATCH').length).toBe(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect.poll(() => calls.filter(value => value === 'DELETE').length).toBe(1);
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBeGreaterThan(0);
  await page.clock.fastForward(30_000); expect(calls.filter(value => value === 'PATCH')).toHaveLength(1);
  expect((await tracker(page)).sentEvents.map(value => JSON.parse(value).type)).not.toContain('session.close');
});

test('failed hosted heartbeat stops capture and requests cleanup without creating a replacement session', async ({ page }) => {
  await fakeMedia(page); await page.clock.install(); const calls: string[] = [];
  await page.route('**/api/session*', route => {
    const method = route.request().method(); calls.push(method);
    if (method === 'GET') return route.fulfill({ json: { enabled: true } });
    if (method === 'POST') return route.fulfill({ json: { sessionId: route.request().postDataJSON().sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + 180_000, browserControl: true } });
    return route.fulfill({ status: method === 'PATCH' ? 503 : 200, json: { closed: true } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.clock.fastForward(11_000); await expect.poll(() => calls.filter(value => value === 'DELETE').length).toBe(1);
  await expect(page.locator('#voice-status')).toContainText('voice connection was lost');
  expect((await tracker(page)).stoppedTracks).toBeGreaterThan(0); expect(calls.filter(value => value === 'POST')).toHaveLength(1);
});

test('demo code unlocks the intro without starting voice or revealing the code, and fits a phone', async ({ page }) => {
  await fakeMedia(page); const calls = await mockSession(page);
  let accepted = false, entries = 0;
  await page.route('**/api/demo-access', route => {
    if (route.request().method() === 'POST') { entries++; accepted = route.request().postDataJSON().code === 'synthetic'; return route.fulfill({ status: accepted ? 200 : 403, json: accepted ? { allowed: true } : { error: 'Incorrect demo code.' } }); }
    return route.fulfill({ json: { enabled: true, allowed: accepted } });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const input = page.getByLabel('Demo code', { exact: true }); await expect(input).toBeVisible();
  const entry = await page.locator('.demo-code-gate').boundingBox(), guidance = await page.locator('#voice-hint').boundingBox();
  expect(entry!.y + entry!.height).toBeLessThan(guidance!.y);
  await page.screenshot({ path: 'test-results/demo-code-mobile.png' });
  await input.fill('wrong'); await page.getByRole('button', { name: 'Unlock demo', exact: true }).click();
  await expect(page.locator('.demo-code-gate').getByRole('alert')).toContainText('Incorrect');
  await input.fill('synthetic'); await page.getByRole('button', { name: 'Unlock demo', exact: true }).click();
  await expect(page.getByText('Demo unlocked', { exact: true })).toBeVisible();
  expect(calls.filter(value => value.method === 'POST')).toHaveLength(0); expect((await tracker(page)).microphoneCalls).toBe(0);
  await page.reload(); await expect(page.getByText('Demo unlocked', { exact: true })).toBeVisible(); expect(entries).toBe(2);
  const hint = await page.locator('#voice-hint').boundingBox(); expect(hint!.y + hint!.height).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hosted connection handshake applies SDP only after the observer is ready, then starts the three-minute display', async ({ page }) => {
  await fakeMedia(page); const methods: string[] = [];
  await page.route('**/api/session*', route => {
    const method = route.request().method(); methods.push(method);
    if (method === 'GET') return route.fulfill({ json: { enabled: true } });
    if (method === 'POST') return route.fulfill({ json: { sessionId: route.request().postDataJSON().sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + 45_000, browserControl: true, connectionConfirmation: true } });
    if (method === 'PATCH' && route.request().postDataJSON().connect) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ ready: true }) + '\n' + JSON.stringify({ expiresAt: Date.now() + 180_000 }) + '\n' });
    return route.fulfill({ json: { closed: true } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect.poll(async () => (await tracker(page)).sentEvents.filter(value => JSON.parse(value).type === 'session.instructions.append').length).toBe(1);
  expect(methods.slice(0, 3)).toEqual(['GET', 'POST', 'PATCH']);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});
