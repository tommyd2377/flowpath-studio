import { localAppOrigin } from '../lib/local-app-runtime';
import { runLocalVoiceSupervisor } from '../lib/local-voice-supervisor';

const [id] = process.argv.slice(2);
if (!localAppOrigin() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '') || !process.send) process.exit(1);
const result = await runLocalVoiceSupervisor(async onStarted => {
  const { getProductionVoiceServer } = await import('../lib/production-voice-runtime');
  return getProductionVoiceServer().superviseReservation(id, onStarted);
});
process.exit(result.finalized ? 0 : 1);
