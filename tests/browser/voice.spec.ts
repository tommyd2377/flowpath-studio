import { expect, test, type Page } from '@playwright/test';

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
          if (JSON.parse(value).type === 'session.close') queueMicrotask(() => this.frame({ type: 'session.closed' }));
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

async function mockSession(page: Page, options: { enabled?: boolean; delayPost?: Promise<void>; durationMs?: number } = {}) {
  const calls: { method: string; sessionId?: string; waveformId?: string }[] = [];
  await page.route('**/api/session*', async route => {
    const method = route.request().method();
    const body = method === 'GET' ? null : route.request().postDataJSON();
    calls.push({ method, sessionId: body?.sessionId, waveformId: new URL(route.request().url()).searchParams.get('waveformId') ?? undefined });
    if (method === 'GET') await route.fulfill({ json: { enabled: options.enabled !== false, message: 'Voice is disabled for this local preview.' } });
    else if (method === 'DELETE') await route.fulfill({ status: 204 });
    else {
      await options.delayPost;
      await route.fulfill({ json: { sessionId: body.sessionId, sdp: 'v=0\r\n', expiresAt: Date.now() + (options.durationMs ?? 180_000) } });
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
});

test('a new waveform gesture resumes blocked playback and Escape can end it', async ({ page }) => {
  await fakeMedia(page, { blockedPlayback: true });
  await mockSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Resume voice playback', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
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
  await expect(page.getByText('The three-minute conversation has ended.', { exact: true })).toBeVisible();
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
    expect(Math.abs(initial.y + initial.height / 2 - viewport.height / 2)).toBeLessThan(1);
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `test-results/waveform-${viewport.width}-idle.png` });
    await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-voice-phase', 'listening');
    for (const selector of ['.wordmark', '.voice-hint', '.wave-control']) {
      await expect(page.locator(selector)).toHaveCSS('transition-duration', '0.8s');
      await expect(page.locator(selector)).toHaveCSS('transition-timing-function', 'ease-in-out');
    }
    await expect(page.locator('.wordmark')).toHaveCSS('opacity', '0');
    await expect(page.locator('.voice-hint')).toHaveCSS('opacity', '0');
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
  await page.goto(`/w/${waveformId}`);
  await expect(page.locator('.voice-navigation')).toContainText('Private test voice');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => calls.some(call => call.method === 'POST')).toBe(true);
  await expect(page.locator('.voice-navigation')).toBeHidden();
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await expect.poll(async () => (await tracker(page)).stoppedTracks).toBe(1);
  releasePost();
  await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(2);
  expect(calls.every(call => call.waveformId === waveformId)).toBe(true);
  await expect(page.locator('.voice-navigation')).toBeVisible();
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
