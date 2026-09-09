import { MAX_RECORDING_SECONDS, PCM_RATE } from './visitor-model';

export function encodeRecording(chunks: Float32Array[], sampleRate: number) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  const outputLength = Math.min(Math.floor(length * PCM_RATE / sampleRate), PCM_RATE * MAX_RECORDING_SECONDS);
  if (outputLength < PCM_RATE / 5) throw new Error('The recording was too short. Please try again.');
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < outputLength; i++) {
    const position = i * sampleRate / PCM_RATE;
    const index = Math.floor(position);
    const sample = Math.max(-1, Math.min(1, samples[index] + ((samples[index + 1] ?? samples[index]) - samples[index]) * (position - index)));
    view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeReply(context: AudioContext, base64: string) {
  const binary = atob(base64);
  if (!binary.length || binary.length % 2 || binary.length > PCM_RATE * 2 * 30) throw new Error('The voice reply could not be played.');
  const buffer = context.createBuffer(1, binary.length / 2, PCM_RATE);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i++) {
    const sample = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    channel[i] = (sample > 32767 ? sample - 65536 : sample) / 32768;
  }
  return buffer;
}
