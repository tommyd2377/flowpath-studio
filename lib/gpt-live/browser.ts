import type { LiveAudioState } from './protocol';

/** Local media observations only: quiet is not proof a semantic reply finished. */
export function createAudioActivity(onChange: (state: LiveAudioState) => void, quietMs = 1200) {
  let state: LiveAudioState = { inputActive: false, outputActive: false };
  let inputAt = -Infinity, outputAt = -Infinity;
  return (inputLevel: number, outputLevel: number, now: number) => {
    if (inputLevel > 0.02) inputAt = now;
    if (outputLevel > 0.008) outputAt = now;
    const next = { inputActive: now - inputAt < 400, outputActive: now - outputAt < quietMs };
    if (next.inputActive !== state.inputActive || next.outputActive !== state.outputActive) { state = next; onChange(next); }
  };
}
export function monitorLiveAudio(input: AnalyserNode, output: AnalyserNode, onChange: (state: LiveAudioState) => void) {
  const sample = createAudioActivity(onChange);
  const inputBytes = new Uint8Array(input.fftSize), outputBytes = new Uint8Array(output.fftSize);
  const level = (node: AnalyserNode, bytes: Uint8Array<ArrayBuffer>) => {
    node.getByteTimeDomainData(bytes);
    return Math.sqrt(bytes.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / bytes.length);
  };
  const timer = setInterval(() => sample(level(input, inputBytes), level(output, outputBytes), performance.now()), 50);
  return () => clearInterval(timer);
}
export function needsStartupAudioGuard(device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>) {
  return /iPhone|iPad|iPod/.test(device.userAgent) || device.platform === 'MacIntel' && device.maxTouchPoints > 1;
}
/** Keep original capture/AEC running; only mute the cloned outgoing tracks. */
export function createStartupAudioGuard(options: { stream: Pick<MediaStream, 'getAudioTracks'>; enabled: boolean; protectionMs?: number; debug?: boolean }) {
  const tracks = options.stream.getAudioTracks().map(track => track.clone());
  let allowed = true, protectedInput = false, armed = false, played = false, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => tracks.forEach(track => { track.enabled = allowed && !protectedInput && !disposed; });
  const release = () => { clearTimeout(timer); protectedInput = false; sync(); };
  return {
    tracks,
    start() { if (armed || !options.enabled || disposed) return; armed = true; protectedInput = true; sync(); timer = setTimeout(release, 10_000); },
    playbackStarted() { if (!protectedInput || disposed || played) return; played = true; clearTimeout(timer); timer = setTimeout(release, options.protectionMs === 500 || options.protectionMs === 1000 ? options.protectionMs : 2000); },
    setInputEnabled(enabled: boolean) { allowed = enabled; sync(); },
    release(reason?: string) { void reason; release(); },
    dispose() { disposed = true; clearTimeout(timer); tracks.forEach(track => track.stop()); },
  };
}

export async function waitForIce(peer: RTCPeerConnection, signal: AbortSignal) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', change); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
    const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const abort = () => finish(new Error('Voice connection cancelled.'));
    const timer = setTimeout(() => finish(new Error('The audio connection took too long.')), 10_000);
    peer.addEventListener('icegatheringstatechange', change); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else change();
  });
}
