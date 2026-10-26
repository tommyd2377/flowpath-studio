import type { VoiceName } from './voice-options';

export type AccountMode = 'local' | 'firebase' | 'unavailable';

export type AccountUser = { uid: string; displayName: string; role?: 'admin' };

export type FirebasePublicConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };

export type WaveformInput = {
  name: string;
  initialPrompt: string;
  voice: VoiceName;
  accentColor: string;
  profilePhoto: string | null;
  adminTesting?: boolean;
};

export type Waveform = WaveformInput & { id: string; updatedAt: string };

export const WAVEFORM_NAME_LIMIT = 80;
export const WAVEFORM_PROMPT_LIMIT = 8_000;
export const WAVEFORM_DEFAULT_COLOR = '#3a66ff';
export const WAVEFORM_PHOTO_MAX_BYTES = 128 * 1024;
export const WAVEFORM_PHOTO_MAX_DIMENSION = 512;
