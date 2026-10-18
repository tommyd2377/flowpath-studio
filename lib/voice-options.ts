// Names and regional/language descriptions from the official GPT-Live guide:
// https://developers.openai.com/api/docs/guides/live-conversations#voice-options
export const VOICE_OPTIONS = [
  { id: 'marin', label: 'Marin', description: 'The original FlowPath voice (default).' },
  { id: 'quartz', label: 'Quartz', description: 'Australian English, feminine.' },
  { id: 'ripple', label: 'Ripple', description: 'Australian English, masculine.' },
  { id: 'vesper', label: 'Vesper', description: 'British English, masculine.' },
  { id: 'willow', label: 'Willow', description: 'Irish English, feminine.' },
  { id: 'stone', label: 'Stone', description: 'Irish English, masculine.' },
  { id: 'gleam', label: 'Gleam', description: 'North American English, feminine.' },
  { id: 'meridian', label: 'Meridian', description: 'North American English, masculine.' },
  { id: 'bossa', label: 'Bossa', description: 'Brazilian Portuguese, feminine.' },
  { id: 'tempo', label: 'Tempo', description: 'Brazilian Portuguese, masculine.' },
  { id: 'beacon', label: 'Beacon', description: 'English with Filipino influence, masculine.' },
  { id: 'delta', label: 'Delta', description: 'Southern U.S. English, feminine.' },
  { id: 'cinder', label: 'Cinder', description: 'Southern U.S. English, masculine.' },
  { id: 'nuri', label: 'Nuri', description: 'German, feminine.' },
  { id: 'juni', label: 'Juni', description: 'German, feminine.' },
  { id: 'flitz', label: 'Flitz', description: 'German, masculine.' },
  { id: 'brise', label: 'Brise', description: 'French, feminine.' },
  { id: 'sillage', label: 'Sillage', description: 'French, masculine.' },
  { id: 'nira', label: 'Nira', description: 'Hindi, feminine.' },
  { id: 'harema', label: 'Harema', description: 'Japanese, feminine.' },
  { id: 'shida', label: 'Shida', description: 'Japanese, masculine.' },
  { id: 'noeul', label: 'Noeul', description: 'Korean, feminine.' },
] as const;

export type VoiceName = (typeof VOICE_OPTIONS)[number]['id'];
export const DEFAULT_VOICE: VoiceName = 'marin';
export const isVoiceName = (value: unknown): value is VoiceName => typeof value === 'string'
  && VOICE_OPTIONS.some(voice => voice.id === value);
