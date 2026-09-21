/** Preparation must never hold the event reader or acknowledge a replaced request. */
export function prepareVisitorVoiceRequest(options: { signal: AbortSignal; current: () => boolean; prepare: () => void | Promise<void>; begin: () => void | Promise<void>; acknowledge: (status: 'applied' | 'failed') => void }) {
  const active = () => !options.signal.aborted && options.current();
  void Promise.resolve().then(async () => {
    if (!active()) return;
    await options.prepare();
    if (!active()) return;
    await options.begin();
    if (active()) options.acknowledge('applied');
  }).catch(() => { if (active()) options.acknowledge('failed'); });
}
