import 'server-only';
import { getBackendMode } from './firebase/config';
import { AI_DAILY_LIMIT, type EditorStatus } from './editor-types';

export function getEditorStatus(): EditorStatus {
  // Demo workspaces can never spend API credits, even with a key in the environment.
  if (getBackendMode() === 'demo' || !process.env.VOICE_AI_MODE || process.env.VOICE_AI_MODE === 'demo') {
    return { mode: 'demo', message: 'Demo editor · AI is off', dailyLimit: 0 };
  }
  if (process.env.VOICE_AI_MODE !== 'openai') {
    return { mode: 'unavailable', message: 'The chat editor configuration needs attention.', dailyLimit: 0 };
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return { mode: 'unavailable', message: 'AI setup is incomplete. Add the server OpenAI key and restart the app.', dailyLimit: 0 };
  }
  return { mode: 'openai', message: 'AI editor · review before applying', dailyLimit: AI_DAILY_LIMIT };
}
