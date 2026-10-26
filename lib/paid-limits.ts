import { VoiceAdmissionError } from './production-voice-store';

/** A zero daily cap pauses admission; missing/nonfinite caps never mean unlimited. */
export function validatePaidLimits(policy: { concurrency: number; dailySeconds: number }) {
  if (!policy || !Number.isSafeInteger(policy.concurrency) || policy.concurrency < 1 || policy.concurrency > 20
    || !Number.isSafeInteger(policy.dailySeconds) || policy.dailySeconds < 0) {
    throw new VoiceAdmissionError('Finite voice capacity and daily spending limits are required.', 503);
  }
}
