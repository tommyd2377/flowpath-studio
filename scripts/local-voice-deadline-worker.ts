import { localAppOrigin } from '../lib/local-app-runtime';

const [id, value] = process.argv.slice(2);
const expiresAt = Number(value);
if (!localAppOrigin() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '')
  || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 900_000) process.exit(1);
const timer = setTimeout(async () => {
  try {
    const paid = await import('../lib/paid-runtime');
    const closed = paid.paidEnabled && await paid.getPaidStore().segment(id)
      ? await (await import('../lib/paid-voice-runtime')).getPaidVoiceServer().expireReservation(id)
      : await (await import('../lib/production-voice-runtime')).expireProductionVoiceReservation(id);
    process.exit(closed ? 0 : 1);
  } catch { process.exit(1); }
}, expiresAt - Date.now());
// Keep the worker alive after the web process disconnects its IPC channel.
process.on('disconnect', () => { timer.ref(); });
process.send?.('ready');
