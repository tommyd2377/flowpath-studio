import { expect, test, type Page } from '@playwright/test';
import { READINESS_PREPARATION_TTL_MS } from '../../lib/voice-readiness-preparation';

type MediaTracker = {
  microphoneCalls: number;
  createdContexts: number;
  createdPeers: number;
  stoppedTracks: number;
  closedPeers: number;
  closedContexts: number;
  playedAudio: number;
  sentEvents: string[];
  releaseMicrophone: () => void;
  releasePlayback: () => void;
  emit: (event: object) => void;
};

async function fakeMedia(page: Page, options: { microphone?: 'denied' | 'pending'; blockedPlayback?: boolean; pendingPlayback?: boolean; resumeReject?: boolean; resumeMs?: number; microphoneMs?: number; outputMs?: number; sessionMs?: number } = {}) {
  await page.addInitScript(({ microphone, blockedPlayback, pendingPlayback, resumeReject, resumeMs, microphoneMs, outputMs, sessionMs }) => {
    const tracker: MediaTracker = {
      microphoneCalls: 0, createdContexts: 0, createdPeers: 0, stoppedTracks: 0, closedPeers: 0, closedContexts: 0,
      playedAudio: 0, sentEvents: [], releaseMicrophone: () => {}, releasePlayback: () => {}, emit: () => {},
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
        if (microphoneMs) await new Promise<void>(resolve => setTimeout(resolve, microphoneMs));
        return stream;
      } },
    });
    let inputActive = false, outputActive = false;
    class AudioNode { connect(node: unknown) { return node; } }
    let analyserIndex = 0;
    class FakeAudioContext {
      constructor() { tracker.createdContexts++; }
      state = 'running';
      destination = {};
      resume() { return new Promise<void>((resolve, reject) => setTimeout(() => resumeReject ? reject(new Error('Synthetic audio resume failure')) : resolve(), resumeMs ?? 0)); }
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
      paused = true;
      srcObject: unknown = null;
      setAttribute() {}
      play() {
        tracker.playedAudio++;
        if (blockedPlayback && tracker.playedAudio === 1) return Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
        if (pendingPlayback && tracker.playedAudio === 1) return new Promise<void>(resolve => { tracker.releasePlayback = () => { this.paused = false; resolve(); }; });
        this.paused = false;
        return Promise.resolve();
      }
      pause() { this.paused = true; }
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
        tracker.createdPeers++;
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
        setTimeout(() => { this.frame({ type: 'session.started' }); setTimeout(() => { outputActive = true; }, outputMs ?? 0); }, sessionMs ?? 0);
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
    return { microphoneCalls: value.microphoneCalls, createdContexts: value.createdContexts, createdPeers: value.createdPeers, stoppedTracks: value.stoppedTracks,
      closedPeers: value.closedPeers, closedContexts: value.closedContexts,
      playedAudio: value.playedAudio, sentEvents: value.sentEvents };
  });
}

async function mockSession(page: Page, options: { enabled?: boolean; prepareEnabled?: boolean; prepareFails?: boolean; delayGet?: Promise<void>; denyPost?: boolean; delayPost?: Promise<void>; durationMs?: number; browserControl?: boolean; admin?: boolean; adminOverride?: boolean; adminDeadlineMs?: number } = {}) {
  const calls: { method: string; sessionId?: string; waveformId?: string; demoId?: string; diagnostics?: boolean; admin?: string; previous?: string; prepared: boolean; done?: boolean }[] = [];
  await page.route('**/api/session*', async route => {
    const method = route.request().method();
    const body = method === 'GET' ? null : route.request().postDataJSON();
    const call = { method, prepared: route.request().headers()['x-flowpath-prepare'] === '1', done: false, sessionId: body?.sessionId, waveformId: new URL(route.request().url()).searchParams.get('waveformId') ?? undefined,
      admin: route.request().headers()['x-flowpath-admin'], previous: route.request().headers()['x-flowpath-continue'],
      demoId: route.request().headers()['x-flowpath-demo'], diagnostics: body?.diagnostics };
    calls.push(call);
    if (method === 'GET') { await new Promise(resolve => setTimeout(resolve, 150)); if (call.prepared) await options.delayGet; if (call.prepared && options.prepareFails) { call.done = true; return route.abort('failed'); } await route.fulfill({ headers: { 'Server-Timing': 'fp_scope;dur=23.4, secret;dur=9' }, json: { adminEligible: options.admin === true, enabled: call.prepared && options.prepareEnabled !== undefined ? options.prepareEnabled : options.enabled !== false, message: 'Voice is disabled for this local preview.' } }); call.done = true; }
    else if (method === 'DELETE') await route.fulfill({ status: 204 });
    else {
      await new Promise(resolve => setTimeout(resolve, 250));
      await options.delayPost;
      if (options.denyPost) return route.fulfill({ status: 403, json: { error: 'Synthetic admission denied.' } });
      await route.fulfill({ headers: { 'Server-Timing': 'fp_provider;dur=51.2, fp_persist;dur=6' }, json: { sessionId: body.sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + (options.durationMs ?? 900_000), ...(options.browserControl ? { browserControl: true } : {}),
        ...(options.admin ? { adminEligible: true, adminOverride: options.adminOverride === true, adminDeadline: Date.now() + (options.adminDeadlineMs ?? 900_000) } : {}) } });
    }
  });
  return calls;
}


test.beforeEach(async ({ page }) => {
  // All provider/session responses and media are synthetic; external traffic is blocked.
  await page.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort('blockedbyclient');
  });
});

test('controlled startup timing captures separate readiness and output milestones', async ({ page }) => {
  await fakeMedia(page, { resumeMs: 400, microphoneMs: 500, sessionMs: 150, outputMs: 200 });
  const calls = await mockSession(page);
  await page.goto('/?startup=1');
  await expect.poll(() => calls.some(call => call.prepared && call.done)).toBe(true);
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.wave-control')!;
    const main = document.querySelector<HTMLElement>('main.voice-page')!;
    const times: { click?: number; ready?: number; output?: number } = {};
    Object.assign(window, { startupBenchmark: times });
    button.addEventListener('click', () => { times.click ??= performance.now(); }, { capture: true });
    new MutationObserver(() => {
      const phase = main.dataset.voicePhase;
      if ((phase === 'listening' || phase === 'speaking') && times.ready === undefined) times.ready = performance.now();
      if (phase === 'speaking' && times.output === undefined) times.output = performance.now();
    }).observe(main, { attributes: true, attributeFilter: ['data-voice-phase'] });
  });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.locator('main.voice-page')).toHaveAttribute('data-voice-phase', 'speaking');
  const times = await page.evaluate(() => (window as unknown as { startupBenchmark: { click: number; ready: number; output: number } }).startupBenchmark);
  const ready = Math.round(times.ready - times.click), output = Math.round(times.output - times.click);
  console.log(JSON.stringify({ fixture: 'synthetic', clickToConversationReadyMs: ready, clickToSimulatedOutputMs: output, injectedDelaysMs: { readiness: 150, audioContext: 400, capture: 500, server: 250, session: 150, output: 200 } }));
  expect(ready).toBeGreaterThan(800);
  expect(output).toBeGreaterThan(ready);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('denied capture never creates a session', async ({ page }) => {
  await fakeMedia(page, { microphone: 'denied', resumeMs: 200 });
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Microphone access was denied. Allow microphone access to start a conversation.', { exact: true })).toBeVisible();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
  expect((await tracker(page)).closedContexts).toBe(1);
});

test('cancelling pending capture stops a late microphone stream', async ({ page }) => {
  await fakeMedia(page, { microphone: 'pending', resumeMs: 200 });
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).microphoneCalls).toBe(1);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await page.evaluate(() => (window as unknown as { voiceTest: MediaTracker }).voiceTest.releaseMicrophone());
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

test('disabled readiness never requests microphone or starts a session', async ({ page }) => {
  await fakeMedia(page, { resumeMs: 200 });
  const calls = await mockSession(page, { enabled: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Voice is disabled for this local preview.', { exact: true })).toBeVisible();
  expect((await tracker(page)).microphoneCalls).toBe(0);
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

test('blocked playback does not set speaking phase until resumed', async ({ page }) => {
  await fakeMedia(page, { blockedPlayback: true, outputMs: 10 });
  await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume voice playback', exact: true })).toBeVisible();
  await expect(page.locator('main.voice-page')).not.toHaveAttribute('data-voice-phase', 'speaking');
  await page.getByRole('button', { name: 'Resume voice playback', exact: true }).click();
  await expect(page.locator('main.voice-page')).toHaveAttribute('data-voice-phase', 'speaking');
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});


test('cancelling after capture but before audio context resume stops the captured track', async ({ page }) => {
  await fakeMedia(page, { microphoneMs: 30, resumeMs: 1200 });
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).microphoneCalls).toBe(1);
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});


test('timing-only report distinguishes output signal from playback permission and excludes text', async ({ page }) => {
  await fakeMedia(page, { pendingPlayback: true, outputMs: 10 });
  const calls = await mockSession(page);
  await page.goto('/?startup=1');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.locator('.voice-experience')).toHaveAttribute('data-connected', 'true');
  await expect.poll(async () => (await tracker(page)).playedAudio).toBe(1);
  const review = async () => {
    await page.getByRole('button', { name: 'Review startup timing' }).click();
    return JSON.parse(await page.locator('#startup-timing-review').inputValue()) as {
      format: string; events: { name: string; atMs: number }[];
      server: { request: string; name: string; durationMs: number }[];
    };
  };
  await expect.poll(async () => (await review()).events.some(event => event.name === 'first_output_signal')).toBe(true);
  const pending = await review();
  expect(pending.format).toBe('flowpath-startup-timing');
  expect(pending.events.some(event => event.name === 'first_audible_output')).toBe(false);
  expect(pending.events.some(event => event.name === 'conversation_ready')).toBe(true);
  expect(pending.server).toContainEqual({ request: 'readiness', name: 'fp_scope', durationMs: 23.4 });
  expect(pending.server).toContainEqual({ request: 'session', name: 'fp_provider', durationMs: 51.2 });
  expect(pending.server.some(event => event.name === 'secret')).toBe(false);
  expect(calls.find(call => call.method === 'POST')?.diagnostics).toBeUndefined();
  // The analyser's last non-silent reading has a 700 ms UI hold. It must not
  // count as new audible output if playback resolves after that signal ends.
  await page.evaluate(() => {
    const fixture = (window as unknown as { voiceTest: MediaTracker }).voiceTest;
    fixture.emit({ type: 'media.output.quiet' });
    fixture.releasePlayback();
  });
  await expect.poll(async () => (await review()).events.some(event => event.name === 'playback_allowed')).toBe(true);
  await page.waitForTimeout(120);
  expect((await review()).events.some(event => event.name === 'first_audible_output')).toBe(false);
  await page.evaluate(() => (window as unknown as { voiceTest: MediaTracker }).voiceTest.emit({ type: 'media.output.active' }));
  await expect.poll(async () => (await review()).events.some(event => event.name === 'first_audible_output')).toBe(true);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});


test('audio resume failure stops a microphone stream that resolves later', async ({ page }) => {
  await fakeMedia(page, { microphone: 'pending', resumeReject: true, resumeMs: 100 });
  const calls = await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Synthetic audio resume failure', { exact: true })).toBeVisible();
  expect((await tracker(page)).microphoneCalls).toBe(1);
  await page.evaluate(() => (window as unknown as { voiceTest: MediaTracker }).voiceTest.releaseMicrophone());
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  expect((await tracker(page)).closedContexts).toBe(1);
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

async function startupReport(page: Page) {
  await page.getByRole('button', { name: 'Review startup timing' }).click();
  return JSON.parse(await page.locator('#startup-timing-review').inputValue()) as {
    readinessPreparation?: { source: string; durationMs: number; startedBeforeClickMs: number; completedBeforeClickMs: number };
    events: { name: string; atMs: number }[];
  };
}

test('ready preparation uses one GET before click, without media or a provider start', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/?startup=1');
  await expect.poll(() => calls.some(call => call.prepared && call.done)).toBe(true);
  expect(calls.map(call => call.method)).toEqual(['GET']);
  expect(await tracker(page)).toMatchObject({ microphoneCalls: 0, createdContexts: 0, createdPeers: 0 });
  // Allow the browser to settle the response promise after the intercepted GET.
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.locator('.voice-experience')).toHaveAttribute('data-connected', 'true');
  const report = await startupReport(page);
  expect(report.readinessPreparation?.source).toBe('ready');
  expect(report.readinessPreparation!.durationMs).toBeGreaterThan(100);
  expect(report.readinessPreparation!.startedBeforeClickMs).toBeGreaterThan(100);
  expect(report.events.some(event => event.name === 'readiness_wait_started')).toBe(true);
  expect(report.events.some(event => event.name === 'prepared_readiness_used')).toBe(true);
  expect(calls.filter(call => call.method === 'GET')).toHaveLength(1);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('click joins an in-flight readiness preparation', async ({ page }) => {
  await fakeMedia(page);
  let release!: () => void;
  const delayGet = new Promise<void>(resolve => { release = resolve; });
  const calls = await mockSession(page, { delayGet });
  try {
    await page.goto('/?startup=1');
    await expect.poll(() => calls.some(call => call.prepared)).toBe(true);
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    expect((await tracker(page)).microphoneCalls).toBe(0);
    release();
    await expect(page.locator('.voice-experience')).toHaveAttribute('data-connected', 'true');
    expect((await startupReport(page)).readinessPreparation?.source).toBe('pending');
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
    await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  } finally { release(); }
});

test('negative in-flight preparation performs one ordinary GET and no microphone when disabled', async ({ page }) => {
  await fakeMedia(page);
  let release!: () => void;
  const delayGet = new Promise<void>(resolve => { release = resolve; });
  const calls = await mockSession(page, { delayGet, prepareEnabled: false, enabled: false });
  try {
    await page.goto('/?startup=1');
    await expect.poll(() => calls.some(call => call.prepared)).toBe(true);
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    release();
    await expect(page.getByText('Voice is disabled for this local preview.', { exact: true })).toBeVisible();
    expect(calls.filter(call => call.prepared)).toHaveLength(1);
    expect(calls.filter(call => call.method === 'GET' && !call.prepared)).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0);
    expect((await tracker(page)).microphoneCalls).toBe(0);
    expect((await startupReport(page)).readinessPreparation?.source).toBe('cold');
  } finally { release(); }
});

test('account change invalidates a prepared result before the next click', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/?startup=1');
  await expect.poll(() => calls.some(call => call.prepared && call.done)).toBe(true);
  await page.waitForTimeout(50);
  await page.evaluate(() => window.dispatchEvent(new Event('flowpath-account-change')));
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.locator('.voice-experience')).toHaveAttribute('data-connected', 'true');
  expect(calls.filter(call => call.method === 'GET')).toHaveLength(2);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('expired preparation causes a new readiness GET at click', async ({ page }) => {
  await page.clock.install();
  await fakeMedia(page);
  const calls = await mockSession(page);
  await page.goto('/?startup=1');
  await expect.poll(() => calls.some(call => call.prepared && call.done)).toBe(true);
  await page.clock.fastForward(READINESS_PREPARATION_TTL_MS + 1);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await page.clock.fastForward(1_000);
  await expect(page.locator('.voice-experience')).toHaveAttribute('data-connected', 'true');
  expect(calls.filter(call => call.method === 'GET')).toHaveLength(2);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('admission denial after prepared readiness releases the microphone without retrying', async ({ page }) => {
  await fakeMedia(page);
  const calls = await mockSession(page, { denyPost: true });
  await page.goto('/');
  await expect.poll(() => calls.some(call => call.prepared && call.done)).toBe(true);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Synthetic admission denied.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  expect(calls.filter(call => call.method === 'GET')).toHaveLength(1);
});


test('a failed in-flight preparation falls back to one ordinary GET for the click', async ({ page }) => {
  await fakeMedia(page);
  let release!: () => void;
  const delayGet = new Promise<void>(resolve => { release = resolve; });
  const calls = await mockSession(page, { delayGet, prepareFails: true });
  try {
    await page.goto('/?startup=1');
    await expect.poll(() => calls.some(call => call.prepared)).toBe(true);
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    release();
    await expect(page.locator('.voice-experience')).toHaveAttribute('data-connected', 'true');
    expect(calls.filter(call => call.method === 'GET' && call.prepared)).toHaveLength(1);
    expect(calls.filter(call => call.method === 'GET' && !call.prepared)).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect((await startupReport(page)).readinessPreparation?.source).toBe('cold');
    await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  } finally { release(); }
});

test('private waveform and public introduction serialize their first visitor cookie preparation', async ({ page }) => {
  const second = await page.context().newPage();
  const id = 'c538ac44-883b-4d96-8785-4ddf8a151efb';
  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  let gets = 0, secondUsedCookie = false;
  for (const target of [page, second]) {
    await fakeMedia(target);
    await target.route('**/*', route => {
      const hostname = new URL(route.request().url()).hostname;
      return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort('blockedbyclient');
    });
    await target.route('**/api/waveform*', route => route.fulfill({ json: { publicDemo: true, waveform: { id, name: 'Synthetic guide' } } }));
    await target.route('**/api/billing', route => route.fulfill({ json: { enabled: false } }));
    await target.route('**/api/session*', async route => {
      expect(route.request().method()).toBe('GET');
      const first = ++gets === 1;
      if (first) await delay;
      else secondUsedCookie = (route.request().headers().cookie ?? '').includes('synthetic_demo_cookie=stable');
      await route.fulfill({ headers: first ? { 'set-cookie': 'synthetic_demo_cookie=stable; Path=/; HttpOnly; SameSite=Strict' } : {}, json: { enabled: true } });
    });
  }
  try {
    await page.goto('/');
    await expect.poll(() => gets).toBe(1);
    await second.goto(`/w/${id}`);
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'flowpath-public-voice-identity'))).toBe(true);
    expect(gets).toBe(1);
    release();
    await expect.poll(() => gets).toBe(2);
    expect(secondUsedCookie).toBe(true);
    expect((await tracker(page)).microphoneCalls).toBe(0);
    expect((await tracker(second)).microphoneCalls).toBe(0);
  } finally { release(); await second.close(); }
});
