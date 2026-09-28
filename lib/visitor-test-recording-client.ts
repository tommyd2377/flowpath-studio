'use client';
import type { VisitorControlCapability } from './visitor-realtime-context';
import { LOCAL_TEST_HEADER, PHONE_RECORDING_HEADER, RECORDING_HEADER, sanitizeTestObservation, setBrowserTestRecorder, recordBrowserTestEvent, type TestEvent } from './visitor-test-events';

type RecordingState = { id?: string; active: boolean; busy: boolean; dropped: number; error?: string; voiceCapture?: 'attaching' | 'attached' | 'unavailable'; phone?: boolean; pairing?: boolean; expiresAt?: number };
type PhoneSession = { id: string; token: string; origin: string; slug: string; expiresAt: number };
let phoneSession: PhoneSession | undefined, phoneInvitation: { id: string; token: string; slug: string } | undefined;
let phoneExpiry: ReturnType<typeof setTimeout> | undefined;
const initial: RecordingState = { active: false, busy: false, dropped: 0 };
let state = initial, queue: TestEvent[] = [], queuedBytes = 0, sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined, sending: Promise<void> | undefined;
const listeners = new Set<() => void>();
export const testRecordingSnapshot = () => state;
export const emptyTestRecordingSnapshot = () => initial;
export const subscribeTestRecording = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const update = (next: Partial<RecordingState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
export const localTestRecordingAvailable = () => process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const phoneScope = () => phoneSession && typeof window !== 'undefined' && location.origin === phoneSession.origin && location.pathname === `/s/${phoneSession.slug}` && Date.now() < phoneSession.expiresAt;
const captureAvailable = () => localTestRecordingAvailable() || !!phoneScope();
const validPhoneSession = (value: unknown): value is PhoneSession => {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PhoneSession>;
  return typeof session.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session.id)
    && typeof session.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.token)
    && typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() && session.expiresAt <= Date.now() + 30 * 60_000
    && typeof session.origin === 'string' && typeof session.slug === 'string';
};

async function phoneApi(body: object, token: string, id?: string) {
  const response = await fetch('/api/dev/recordings/phone', { method: 'POST', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', [LOCAL_TEST_HEADER]: '1', [PHONE_RECORDING_HEADER]: token, ...(id ? { [RECORDING_HEADER]: id } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Phone recording is unavailable.');
  return response;
}

export async function recordingApi(body: object) {
  if (phoneSession && phoneScope()) {
    if (!('action' in body) || !['append', 'attach-voice', 'stop'].includes(String(body.action)) || !('id' in body) || body.id !== phoneSession.id) throw new Error('This phone cannot access recording history.');
    return phoneApi({ ...body, slug: phoneSession.slug }, phoneSession.token, phoneSession.id);
  }
  if (!localTestRecordingAvailable()) throw new Error('Recording is only available in local development.');
  const response = await fetch('/api/dev/recordings', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', [LOCAL_TEST_HEADER]: '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('The local recording could not be read or saved.');
  return response;
}
let liveConnection: { slug: string; control: VisitorControlCapability } | undefined;
async function attachVoice() {
  const connection = liveConnection, id = state.id;
  if (!connection || !state.active || !id || !captureAvailable() || phoneSession && connection.slug !== phoneSession.slug) return;
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
  // Registration is passive; a pending phone invitation may be accepted after
  // voice has connected. It must still attach only to this publisher's session.
  if (!localTestRecordingAvailable() && !(process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && location.protocol === 'https:')) return () => {};
  const connection = { slug, control }; liveConnection = connection;
  void attachVoice();
  return () => { if (liveConnection === connection) { liveConnection = undefined; update({ voiceCapture: undefined }); } };
}
function forget() { try { sessionStorage.removeItem('flowpath-test-recording'); sessionStorage.removeItem('flowpath-phone-recording'); } catch {} clearTimeout(phoneExpiry); phoneSession = undefined; }
function endPhoneCapture(error: string) {
  const session = phoneSession;
  setBrowserTestRecorder(); clearTimeout(timer); timer = undefined; queue = []; queuedBytes = 0; forget();
  update({ active: false, voiceCapture: undefined, error });
  // One best-effort revocation; never retry or change the conversation. The
  // server's independent expiry remains authoritative if the phone is offline.
  if (session && location.origin === session.origin) void phoneApi({ action: 'stop', id: session.id, slug: session.slug }, session.token, session.id).catch(() => undefined);
}
function watchPhoneExpiry() {
  clearTimeout(phoneExpiry);
  if (phoneSession) phoneExpiry = setTimeout(() => endPhoneCapture('Phone recording expired. Create a new pairing on your Mac to continue.'), Math.max(0, phoneSession.expiresAt - Date.now()));
}
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
    if (state.phone && !phoneScope()) { endPhoneCapture('Phone recording ended outside its paired page or time limit.'); return; }
    const value: TestEvent = { ...sanitizeTestObservation(event), source: 'browser', at: Date.now(), monotonicMs: performance.now(), sequence: ++sequence };
    const bytes = JSON.stringify(value).length;
    if (queuedBytes + bytes > 500_000 || queue.length >= 500) { update({ dropped: state.dropped + 1 }); return; }
    queue.push(value); queuedBytes += bytes;
    timer ??= setTimeout(() => { void flush(); }, 250);
  });
}
export async function startTestRecording(label = 'Visitor test') {
  if (state.busy || state.active) return;
  update({ busy: true, error: undefined });
  try {
    let result: { id: string };
    if (phoneInvitation) {
      const invitation = phoneInvitation;
      if (location.protocol !== 'https:' || location.pathname !== `/s/${invitation.slug}`) throw new Error('Pairing page changed.');
      const paired = await (await phoneApi({ action: 'accept', invitationId: invitation.id, slug: invitation.slug }, invitation.token)).json();
      const session = { id: paired.id, token: paired.token, expiresAt: paired.expiresAt, origin: location.origin, slug: paired.slug };
      if (!validPhoneSession(session) || session.slug !== invitation.slug) throw new Error('Invalid phone pairing.');
      phoneSession = session;
      phoneInvitation = undefined; result = paired;
      try { sessionStorage.setItem('flowpath-phone-recording', JSON.stringify(phoneSession)); } catch {}
      update({ phone: true, pairing: false, expiresAt: paired.expiresAt }); watchPhoneExpiry();
    } else result = await (await recordingApi({ action: 'start', label, page: location.pathname })).json();
    queue = []; queuedBytes = 0; sequence = 0;
    update({ id: result.id, active: true, dropped: 0, voiceCapture: undefined }); observe();
    if (!state.phone) try { sessionStorage.setItem('flowpath-test-recording', result.id); } catch {}
    recordBrowserTestEvent('browser.started', { page: location.pathname, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    await attachVoice();
  } catch { update({ error: state.phone ? 'Pairing expired or could not start. Create a new pairing on your Mac.' : 'Could not start the local recorder.' }); }
  finally { update({ busy: false }); }
}
export async function resumeTestRecording() {
  if (state.phone && state.active && !phoneScope()) endPhoneCapture('Phone recording ended outside its paired page or time limit.');
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && location.protocol === 'https:' && !localTestRecordingAvailable()) {
    if (state.active || state.busy) return;
    const publisher = location.pathname.match(/^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)$/)?.[1];
    if (!publisher) return;
    const fragment = new URLSearchParams(location.hash.slice(1)), invitation = fragment.get('flowpath-recording');
    if (invitation) {
      // Fragments never reach HTTP logs. Remove the credential immediately,
      // before any recording or visitor interaction, including a failed accept.
      fragment.delete('flowpath-recording'); history.replaceState(history.state, '', `${location.pathname}${location.search}${fragment.size ? `#${fragment}` : ''}`);
      const match = invitation.match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/);
      if (match) { phoneInvitation = { id: match[1], token: match[2], slug: publisher }; update({ phone: true, pairing: true, error: undefined }); }
      return;
    }
    let stored: PhoneSession | undefined;
    try { stored = JSON.parse(sessionStorage.getItem('flowpath-phone-recording') ?? 'null') ?? undefined; } catch {}
    if (!validPhoneSession(stored) || stored.origin !== location.origin || stored.slug !== publisher) return;
    phoneSession = stored; update({ phone: true, busy: true, id: stored.id, expiresAt: stored.expiresAt });
    try {
      // A bounded empty append checks only the chosen session, never lists or
      // reads other recordings. Reloading the same tab preserves explicit opt-in.
      const result = await (await recordingApi({ action: 'append', id: stored.id, events: [], dropped: state.dropped })).json();
      if (!result.active) throw new Error();
      update({ active: true }); observe(); watchPhoneExpiry(); recordBrowserTestEvent('browser.resumed', { page: location.pathname }); await attachVoice();
    } catch { forget(); update({ active: false, error: 'Phone recording could not resume. Create a new pairing on your Mac.' }); }
    finally { update({ busy: false }); }
    return;
  }
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
  if (state.phone && state.active && !phoneScope()) endPhoneCapture('Phone recording ended outside its paired page or time limit.');
  if (!state.active || !state.id || !captureAvailable() || !/^\/api\/(?:visitor|explore)\//.test(input)) return fetch(input, init);
  if (phoneSession && !(input === `/api/visitor/${phoneSession.slug}` || input.startsWith(`/api/visitor/${phoneSession.slug}/`))) return fetch(input, init);
  const phone = phoneSession, headers = new Headers(init?.headers); headers.set(RECORDING_HEADER, state.id); headers.set(LOCAL_TEST_HEADER, '1');
  if (phone) headers.set(PHONE_RECORDING_HEADER, phone.token);
  let body: Record<string, unknown> = {};
  try { if (typeof init?.body === 'string') body = JSON.parse(init.body); } catch {}
  const traceId = typeof body.requestId === 'string' ? body.requestId : undefined;
  recordBrowserTestEvent('http.request', { path: input, method: init?.method ?? 'GET', body }, traceId);
  const started = performance.now();
  try {
    const response = await fetch(input, { ...init, headers, ...(phone ? { redirect: 'error' as const } : {}) });
    recordBrowserTestEvent('http.response', { path: input, status: response.status, durationMs: performance.now() - started }, traceId);
    return response;
  } catch (error) { recordBrowserTestEvent('http.failed', { path: input, error, durationMs: performance.now() - started }, traceId); throw error; }
}
