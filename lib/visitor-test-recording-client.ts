'use client';
import type { VisitorControlCapability } from './visitor-realtime-context';
import { LOCAL_TEST_HEADER, RECORDING_HEADER, sanitizeTestObservation, setBrowserTestRecorder, recordBrowserTestEvent, type TestEvent } from './visitor-test-events';

type RecordingState = { id?: string; active: boolean; busy: boolean; dropped: number; error?: string; voiceCapture?: 'attaching' | 'attached' | 'unavailable' };
const initial: RecordingState = { active: false, busy: false, dropped: 0 };
let state = initial, queue: TestEvent[] = [], queuedBytes = 0, sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined, sending: Promise<void> | undefined;
const listeners = new Set<() => void>();
export const testRecordingSnapshot = () => state;
export const emptyTestRecordingSnapshot = () => initial;
export const subscribeTestRecording = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const update = (next: Partial<RecordingState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
export const localTestRecordingAvailable = () => process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export async function recordingApi(body: object) {
  if (!localTestRecordingAvailable()) throw new Error('Recording is only available in local development.');
  const response = await fetch('/api/dev/recordings', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', [LOCAL_TEST_HEADER]: '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('The local recording could not be read or saved.');
  return response;
}
let liveConnection: { slug: string; control: VisitorControlCapability } | undefined;
async function attachVoice() {
  const connection = liveConnection, id = state.id;
  if (!connection || !state.active || !id || !localTestRecordingAvailable()) return;
  update({ voiceCapture: 'attaching' });
  try {
    const result = await (await recordingApi({ action: 'attach-voice', id, ...connection })).json();
    if (state.active && state.id === id && liveConnection === connection) {
      update({ voiceCapture: result.attached ? 'attached' : 'unavailable' });
      recordBrowserTestEvent('voice.capture_status', { attached: result.attached === true });
    }
  } catch { if (state.active && state.id === id && liveConnection === connection) update({ voiceCapture: 'unavailable' }); }
}
/** Register only this tab's existing connection; attachment never starts voice. */
export function registerRecordingVoice(slug: string, control: VisitorControlCapability) {
  if (!localTestRecordingAvailable()) return () => {};
  const connection = { slug, control }; liveConnection = connection;
  void attachVoice();
  return () => { if (liveConnection === connection) { liveConnection = undefined; update({ voiceCapture: undefined }); } };
}
function forget() { try { sessionStorage.removeItem('flowpath-test-recording'); } catch {} }
async function flush() {
  clearTimeout(timer); timer = undefined;
  if (sending) { await sending; if (queue.length) await flush(); return; }
  if (!state.active || !state.id || !queue.length) return;
  const id = state.id, events: TestEvent[] = [];
  let size = 0;
  while (queue.length && events.length < 100) {
    const bytes = JSON.stringify(queue[0]).length;
    if (events.length && size + bytes > 100_000) break;
    size += bytes; events.push(queue.shift()!); queuedBytes -= bytes;
  }
  sending = (async () => {
    try {
      const result = await (await recordingApi({ action: 'append', id, events, dropped: state.dropped })).json();
      if (!result.active || result.error) { setBrowserTestRecorder(); forget(); update({ active: false, error: result.error ?? 'Recording limit reached. Start a new recording to continue.', dropped: state.dropped + result.dropped }); }
    } catch {
      // No automatic retries: failures remain visible without affecting calls.
      setBrowserTestRecorder(); forget(); update({ active: false, error: 'Recording stopped because saving failed. Your conversation is unaffected.', dropped: state.dropped + events.length + queue.length });
      queue = []; queuedBytes = 0;
    }
  })();
  await sending; sending = undefined;
  if (queue.length && state.active) timer = setTimeout(() => { void flush(); }, 250);
}
function observe() {
  setBrowserTestRecorder(event => {
    if (!state.active) return;
    const value: TestEvent = { ...sanitizeTestObservation(event), source: 'browser', at: Date.now(), monotonicMs: performance.now(), sequence: ++sequence };
    const bytes = JSON.stringify(value).length;
    if (queuedBytes + bytes > 500_000 || queue.length >= 500) { update({ dropped: state.dropped + 1 }); return; }
    queue.push(value); queuedBytes += bytes;
    timer ??= setTimeout(() => { void flush(); }, 250);
  });
}
export async function startTestRecording(label = 'Visitor test') {
  update({ busy: true, error: undefined });
  try {
    const result = await (await recordingApi({ action: 'start', label, page: location.pathname })).json();
    queue = []; queuedBytes = 0; sequence = 0;
    update({ id: result.id, active: true, dropped: 0, voiceCapture: undefined }); observe();
    try { sessionStorage.setItem('flowpath-test-recording', result.id); } catch {}
    recordBrowserTestEvent('browser.started', { page: location.pathname, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    await attachVoice();
  } catch { update({ error: 'Could not start the local recorder.' }); }
  finally { update({ busy: false }); }
}
export async function resumeTestRecording() {
  if (!localTestRecordingAvailable() || state.active || state.busy) return;
  let id: string | null = null; try { id = sessionStorage.getItem('flowpath-test-recording'); } catch {}
  if (!id) return;
  update({ busy: true });
  try {
    const { sessions } = await (await recordingApi({ action: 'list' })).json();
    if (sessions.some((session: { id: string; active: boolean }) => session.id === id && session.active)) { update({ id, active: true }); observe(); recordBrowserTestEvent('browser.resumed', { page: location.pathname }); await attachVoice(); }
    else forget();
  } catch { forget(); update({ error: 'The previous recording could not be resumed.' }); }
  finally { update({ busy: false }); }
}
export async function stopTestRecording() {
  if (!state.id) return;
  update({ busy: true });
  recordBrowserTestEvent('browser.stopping', { dropped: state.dropped });
  setBrowserTestRecorder();
  try {
    await flush(); while (state.active && queue.length) await flush();
    await recordingApi({ action: 'stop', id: state.id });
  } catch { update({ error: 'Recording stopped locally; the server recording will expire automatically.' }); }
  finally { forget(); update({ active: false, busy: false, voiceCapture: undefined }); }
}
export async function markTestProblem(note: string) {
  if (!state.active || state.busy) return false;
  recordBrowserTestEvent('problem.marked', { note: note.slice(0, 1000), page: location.pathname });
  await flush();
  return state.active;
}

/** Scoped observer; never monkey-patch fetch or consume a response stream. */
export async function recordedVisitorFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!state.active || !state.id || !localTestRecordingAvailable() || !/^\/api\/(?:visitor|explore)\//.test(input)) return fetch(input, init);
  const headers = new Headers(init?.headers); headers.set(RECORDING_HEADER, state.id); headers.set(LOCAL_TEST_HEADER, '1');
  let body: Record<string, unknown> = {};
  try { if (typeof init?.body === 'string') body = JSON.parse(init.body); } catch {}
  const traceId = typeof body.requestId === 'string' ? body.requestId : undefined;
  recordBrowserTestEvent('http.request', { path: input, method: init?.method ?? 'GET', body }, traceId);
  const started = performance.now();
  try {
    const response = await fetch(input, { ...init, headers });
    recordBrowserTestEvent('http.response', { path: input, status: response.status, durationMs: performance.now() - started }, traceId);
    return response;
  } catch (error) { recordBrowserTestEvent('http.failed', { path: input, error, durationMs: performance.now() - started }, traceId); throw error; }
}
