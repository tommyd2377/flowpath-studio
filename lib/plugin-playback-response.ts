import type { ProtectedPlugin } from './plugin-access';
import { validateTextPanelConfiguration, type TextPanelConfiguration } from './text-panel';
import { validateVisualDisplay, type VisualDisplayConfiguration } from './visual-display';

export type PluginPlaybackResponse = {
  locked: ProtectedPlugin[];
  expiresAt?: number;
  textPanel: TextPanelConfiguration | null;
  visualDisplay: VisualDisplayConfiguration | null;
};

/** Accept only the bounded, server-authorized projection for this voice session. */
export function parsePluginPlayback(value: unknown, now = Date.now()): PluginPlaybackResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['locked', 'expiresAt', 'textPanel', 'visualDisplay'].includes(key))
    || !('textPanel' in row) || !('visualDisplay' in row)
    || !Array.isArray(row.locked) || row.locked.length > 3
    || row.locked.some(id => !['text', 'knowledge', 'visual'].includes(id))
    || new Set(row.locked).size !== row.locked.length
    || row.expiresAt !== undefined && (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt) || row.expiresAt <= now)) return null;
  const text = validateTextPanelConfiguration(row.textPanel);
  const visual = validateVisualDisplay(row.visualDisplay);
  if (!text.ok || !visual.ok || row.locked.includes('text') && text.value !== null
    || row.locked.includes('visual') && visual.value !== null) return null;
  return { locked: row.locked as ProtectedPlugin[], ...(typeof row.expiresAt === 'number' ? { expiresAt: row.expiresAt } : {}),
    textPanel: text.value, visualDisplay: visual.value };
}
