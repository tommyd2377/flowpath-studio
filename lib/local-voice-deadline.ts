import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { resolve } from 'node:path';
import { localAppOrigin } from './local-app-runtime';

/** Separate process survives Next reloads; it only closes the one pre-authorized reservation. */
export async function scheduleLocalVoiceDeadline(id: string, expiresAt: number,
  startWorker: (path: string, args: string[], options: ForkOptions) => ChildProcess = fork) {
  if (!localAppOrigin() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 900_000) throw new Error('Invalid local deadline');
  await new Promise<void>((done, reject) => {
    const worker = startWorker(resolve(process.cwd(), 'scripts/local-voice-deadline-worker.ts'), [id, String(expiresAt)], {
      execArgv: ['--import', 'tsx'], detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let ready = false;
    const timer = setTimeout(() => { worker.kill(); reject(new Error('Local deadline worker did not start')); }, 10_000);
    worker.once('message', message => {
      if (message !== 'ready') { worker.kill(); clearTimeout(timer); reject(new Error('Local deadline worker failed')); return; }
      ready = true; clearTimeout(timer); worker.disconnect(); worker.unref(); done();
    });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('Local deadline worker failed')); });
    worker.once('exit', () => { if (!ready) { clearTimeout(timer); reject(new Error('Local deadline worker exited')); } });
  });
}
