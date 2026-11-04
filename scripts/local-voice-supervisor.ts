const validId = (id: unknown): id is string => typeof id === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

async function start(id: unknown) {
  if (!validId(id) || !process.send) process.exit(1);
  // All application imports, including credential-dependent runtime setup,
  // happen only after the server assigns an existing reservation.
  const [{ localAppOrigin }, { runLocalVoiceSupervisor }] = await Promise.all([
    import('../lib/local-app-runtime'), import('../lib/local-voice-supervisor'),
  ]);
  if (!localAppOrigin()) process.exit(1);
  const result = await runLocalVoiceSupervisor(async onStarted => {
    const { getProductionVoiceServer } = await import('../lib/production-voice-runtime');
    return getProductionVoiceServer().superviseReservation(id, onStarted);
  });
  process.exit(result.finalized ? 0 : 1);
}

const [arg] = process.argv.slice(2);
if (arg === '--standby' && process.send) {
  const disconnected = () => process.exit(1);
  const receive = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'start' || !('id' in value) || !validId(value.id)) return;
    process.removeListener('message', receive);
    process.removeListener('disconnect', disconnected);
    void start(value.id);
  };
  process.once('disconnect', disconnected);
  process.on('message', receive);
  // Load only installed SDK modules in standby. App modules and runtime
  // configuration are still resolved after the server assigns a reservation.
  void Promise.all([
    import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore'),
    import('google-auth-library'), import('ws'),
  ]).then(() => {
    if (!process.connected || !process.send) process.exit(1);
    process.send('prewarmed', error => { if (error) process.exit(1); });
  }).catch(() => process.exit(1));
} else void start(arg);
