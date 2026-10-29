import { writeFile } from 'node:fs/promises';
import { runLocalVoiceSupervisor } from '../../lib/local-voice-supervisor';
import type { Finalization } from '../../lib/voice-server';

// IPC/process-loss fixture only: no accounts, provider adapters, network or credentials.
let complete!: (value: Finalization) => void;
const closed = new Promise<Finalization>(resolve => { complete = resolve; });
let closing: Promise<Finalization> | undefined;
const result = await runLocalVoiceSupervisor(async () => ({ ready: Promise.resolve(), closed, dispose() {},
  close() {
    return closing ??= (async () => {
      await writeFile(process.argv[2], JSON.stringify({ closed: true, seconds: 2.5 }));
      const result = { finalized: true, seconds: 2.5 }; complete(result); return result;
    })();
  },
}));
process.exit(result.finalized ? 0 : 1);
