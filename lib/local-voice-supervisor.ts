import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { resolve } from 'node:path';
import { localAppOrigin } from './local-app-runtime';
import type { Finalization, VoiceControl } from './voice-server';

type IdleWorker = {
  worker: ChildProcess;
  ready: boolean;
  timer: ReturnType<typeof setTimeout>;
  message: (value: unknown) => void;
  ended: () => void;
};
const shared = globalThis as typeof globalThis & { flowpathIdleVoiceSupervisor?: IdleWorker };
const workerPath = () => resolve(process.cwd(), 'scripts/local-voice-supervisor.ts');
const workerOptions: ForkOptions = { execArgv: ['--import', 'tsx'], detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] };

function releaseIdle(entry: IdleWorker, stop: boolean) {
  if (shared.flowpathIdleVoiceSupervisor === entry) shared.flowpathIdleVoiceSupervisor = undefined;
  clearTimeout(entry.timer);
  entry.worker.removeListener('message', entry.message);
  // Keep the error handler while stopping an idle child; a late IPC error must
  // not become an unhandled event on the parent process.
  if (!stop) entry.worker.removeListener('error', entry.ended);
  entry.worker.removeListener('exit', entry.ended);
  if (stop) {
    // The child can exit between the connected check and either operation.
    // IPC/kill failures during idle cleanup must not take down the app.
    entry.worker.on('error', () => {});
    try { if (entry.worker.connected) entry.worker.disconnect(); } catch { /* Already disconnected. */ }
    try { entry.worker.kill(); } catch { /* Already exited. */ }
  }
}

/** One local-only idle process; it loads no voice runtime and receives no session before a start. */
export function prewarmLocalVoiceSupervisor(startWorker: (path: string, args: string[], options: ForkOptions) => ChildProcess = fork) {
  if (!localAppOrigin() || shared.flowpathIdleVoiceSupervisor) return;
  let worker: ChildProcess;
  try { worker = startWorker(workerPath(), ['--standby'], workerOptions); } catch { return; }
  const entry: IdleWorker = {
    worker, ready: false,
    // Outlive the one-minute readiness hint plus the click's admission work.
    timer: setTimeout(() => releaseIdle(entry, true), 75_000),
    message: value => { if (value === 'prewarmed') entry.ready = true; },
    ended: () => releaseIdle(entry, false),
  };
  shared.flowpathIdleVoiceSupervisor = entry;
  worker.on('message', entry.message);
  worker.once('error', entry.ended);
  worker.once('exit', entry.ended);
  worker.unref(); worker.channel?.unref();
  entry.timer.unref?.();
}

function takeIdleWorker() {
  const entry = shared.flowpathIdleVoiceSupervisor;
  if (!entry) return;
  const ready = entry.ready && entry.worker.connected && entry.worker.exitCode === null && entry.worker.signalCode === null;
  releaseIdle(entry, !ready);
  return ready ? entry.worker : undefined;
}

/** The child keeps the provider receiver alive until its durable finalization has completed. */
export async function runLocalVoiceSupervisor(open: (onStarted: () => void) => Promise<VoiceControl>): Promise<Finalization> {
  let control: VoiceControl | undefined;
  let closing = !process.connected;
  const close = () => { closing = true; void control?.close(); };
  const message = (value: unknown) => { if (value === 'close') close(); };
  const send = (value: object | string) => {
    if (process.connected) process.send?.(value, (error: Error | null) => { if (error) close(); });
  };
  process.on('disconnect', close); process.on('message', message);
  process.on('SIGTERM', close); process.on('SIGINT', close);
  try {
    control = await open(() => send('started'));
    if (closing) void control.close();
    await control.ready;
    if (!closing) send('ready');
    const result = await control.closed;
    if (process.connected) await new Promise<void>(resolve => process.send?.({ closed: true, ...result }, () => resolve()));
    if (process.connected) process.disconnect();
    return result;
  } catch {
    await control?.close().catch(() => undefined);
    return { finalized: false };
  } finally {
    process.removeListener('disconnect', close); process.removeListener('message', message);
    process.removeListener('SIGTERM', close); process.removeListener('SIGINT', close);
  }
}

/** Observes one existing provider session. It never creates a call or imposes a duration quota. */
export function superviseLocalVoice(id: string, onStarted: () => void,
  startWorker: (path: string, args: string[], options: ForkOptions) => ChildProcess = fork): VoiceControl & { prepared?: boolean } {
  if (!localAppOrigin() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid local voice supervisor');
  const prewarmed = startWorker === fork ? takeIdleWorker() : undefined;
  const worker = prewarmed ?? startWorker(workerPath(), [id], workerOptions);
  let resolveReady!: () => void, rejectReady!: (error: Error) => void, resolveClosed!: (result: Finalization) => void;
  let finished = false, closing = false;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => undefined);
  const closed = new Promise<Finalization>(resolve => { resolveClosed = resolve; });
  const timer = setTimeout(() => finish({ finalized: false }), 10_000);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = (result: Finalization) => {
    if (finished) return;
    finished = true; clearTimeout(timer); clearTimeout(closeTimer);
    rejectReady(new Error('Local voice supervision ended'));
    resolveClosed(result);
    // IPC loss tells the independent worker to close gracefully and persist final usage.
    if (worker.connected) worker.disconnect();
  };
  worker.on('message', (message: unknown) => {
    if (finished) return;
    if (message === 'ready') { clearTimeout(timer); resolveReady(); }
    else if (message === 'started') onStarted();
    else if (message && typeof message === 'object' && 'closed' in message && message.closed === true) {
      const seconds = 'seconds' in message ? message.seconds : undefined;
      finish('finalized' in message && message.finalized === true && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
        ? { finalized: true, seconds } : { finalized: false });
    }
  });
  worker.once('error', () => finish({ finalized: false }));
  worker.once('exit', () => finish({ finalized: false }));
  worker.unref(); worker.channel?.unref();
  // The server calls this only after it persists the provider ID. The idle
  // worker receives nothing but this local reservation ID and rechecks it.
  if (prewarmed) {
    try { worker.send({ type: 'start', id }, error => { if (error) finish({ finalized: false }); }); }
    catch { finish({ finalized: false }); }
  }
  return { ready, closed, prepared: Boolean(prewarmed),
    close() {
      if (!closing && !finished) {
        closing = true;
        closeTimer = setTimeout(() => finish({ finalized: false }), 15_000);
        void ready.then(() => {
          if (!finished && worker.connected) worker.send('close', error => { if (error) finish({ finalized: false }); });
        }, () => finish({ finalized: false }));
      }
      return closed;
    },
    dispose: () => finish({ finalized: false }),
  };
}
