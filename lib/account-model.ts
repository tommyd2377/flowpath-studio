export type AccountMode = 'local' | 'firebase' | 'unavailable';

export type AccountUser = { uid: string; displayName: string };

export type FirebasePublicConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };

export type WaveformInput = { name: string; initialPrompt: string };

export type Waveform = WaveformInput & { id: string; updatedAt: string };

export const WAVEFORM_NAME_LIMIT = 80;
export const WAVEFORM_PROMPT_LIMIT = 4_000;
