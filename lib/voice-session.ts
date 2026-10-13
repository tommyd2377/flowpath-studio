/** Observe media locally; silence is not a semantic end-of-response event. */
export function monitorAudio(
  input: AnalyserNode,
  output: () => AnalyserNode | undefined,
  observe: (inputActive: boolean, outputActive: boolean) => void,
) {
  const inputBytes = new Uint8Array(input.fftSize);
  let outputBytes = new Uint8Array(0);
  let inputAt = -Infinity;
  let outputAt = -Infinity;
  const level = (node: AnalyserNode, bytes: Uint8Array<ArrayBuffer>) => {
    node.getByteTimeDomainData(bytes);
    return Math.sqrt(bytes.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / bytes.length);
  };
  const timer = setInterval(() => {
    const now = performance.now();
    if (level(input, inputBytes) > 0.02) inputAt = now;
    const analyser = output();
    if (analyser) {
      if (outputBytes.length !== analyser.fftSize) outputBytes = new Uint8Array(analyser.fftSize);
      if (level(analyser, outputBytes) > 0.008) outputAt = now;
    }
    observe(now - inputAt < 400, now - outputAt < 700);
  }, 50);
  return () => clearInterval(timer);
}

export async function waitForIce(peer: RTCPeerConnection, signal: AbortSignal) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', change);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const abort = () => finish(new Error('Voice connection cancelled.'));
    const timer = setTimeout(() => finish(new Error('The audio connection took too long.')), 10_000);
    peer.addEventListener('icegatheringstatechange', change);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else change();
  });
}
