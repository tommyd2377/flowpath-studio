import type { VoiceName } from './voice-options';
import type { TextPanelConfiguration } from './text-panel';

export type AccountMode = 'local' | 'firebase' | 'unavailable';

export type AccountUser = { uid: string; displayName: string; role?: 'admin' };

export type FirebasePublicConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };

export type WaveformInput = {
  name: string;
  initialPrompt: string;
  voice: VoiceName;
  accentColor: string;
  profilePhoto: string | null;
  /** Legacy-compatible transport for the founder's account-wide testing preference. */
  adminTesting?: boolean;
  textPanel?: TextPanelConfiguration | null;
  practicePlugins?: import('./practice-contract').PracticeId[];
  visualDisplay?: import('./visual-display').VisualDisplayConfiguration | null;
};

export type Waveform = WaveformInput & { id: string; updatedAt: string };

export const WAVEFORMS_PER_OWNER = 10;
export const WAVEFORM_NAME_LIMIT = 80;
export const WAVEFORM_PROMPT_LIMIT = 15_000;
export const WAVEFORM_DEFAULT_COLOR = '#3a66ff';
export const WAVEFORM_PHOTO_MAX_BYTES = 128 * 1024;
export const WAVEFORM_PHOTO_MAX_DIMENSION = 512;
