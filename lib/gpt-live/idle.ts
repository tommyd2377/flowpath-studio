import type { LiveAudioState } from './protocol';

export const DEFAULT_LIVE_IDLE_TIMEOUT_MS = 60_000;
export const LIVE_IDLE_TIMEOUT_SECONDS = [0, 30, 60, 120] as const;
export type LiveIdleTimeoutSeconds = typeof LIVE_IDLE_TIMEOUT_SECONDS[number];

type LiveIdleTimerOptions = {
  timeoutMs: number;
  onIdle: () => void;
};

/**
 * Keeps the Live session open while audio or backend work is active, and
 * closes it after a bounded quiet period. The same activity policy is used by
 * the browser and the server; the server remains authoritative for billing.
 */
export function createLiveIdleTimer(options: LiveIdleTimerOptions) {
  let timeoutMs = normalizeLiveIdleTimeoutMs(options.timeoutMs);
  let audio: LiveAudioState = { inputActive: false, outputActive: false };
  let backendBusy = false;
  let started = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => { clearTimeout(timer); timer = undefined; };
  const arm = () => {
    clear();
    if (!started || closed || timeoutMs <= 0 || backendBusy || audio.inputActive || audio.outputActive) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (closed || backendBusy || audio.inputActive || audio.outputActive) return;
      closed = true;
      options.onIdle();
    }, timeoutMs);
  };

  return {
    start() { started = true; arm(); },
    setTimeoutMs(value: number) { timeoutMs = normalizeLiveIdleTimeoutMs(value); arm(); },
    observeAudio(next: LiveAudioState) { audio = next; arm(); },
    observeBusy(busy: boolean) { backendBusy = busy; arm(); },
    reset() { arm(); },
    close() { closed = true; clear(); },
    get timeoutMs() { return timeoutMs; },
    get closed() { return closed; },
  };
}

export function normalizeLiveIdleTimeoutMs(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_LIVE_IDLE_TIMEOUT_MS;
  return Math.max(0, Math.min(120_000, Math.round(value)));
}

export function liveIdleMessage(timeoutMs: number) {
  const seconds = Math.max(1, Math.round(normalizeLiveIdleTimeoutMs(timeoutMs) / 1000));
  const duration = seconds % 60 === 0
    ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
    : `${seconds} seconds`;
  return `Voice ended after ${duration} of inactivity. Tap the wave to continue.`;
}
