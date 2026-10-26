export const TEXT_PANEL_MAX_CHARACTERS = 4_000;

export type LegacyTextPanelConfiguration = { type: 'text'; version: 1; text: string };
/** Version 2 enables a capability; conversation text is never saved in configuration. */
export type TextPanelConfiguration = LegacyTextPanelConfiguration | { type: 'text'; version: 2; text?: never };
export const liveTextPanelEnabled = (configuration?: TextPanelConfiguration | null) => configuration?.type === 'text' && configuration.version === 2;
export type TextPanelValidationError = 'invalid_shape' | 'unsupported_type' | 'unsupported_version' | 'invalid_text' | 'text_too_long';
export type TextPanelValidation = { ok: true; value: TextPanelConfiguration | null } | { ok: false; error: TextPanelValidationError };

/** Validate configuration without coercing, clipping, executing or retaining input. */
export function validateTextPanelConfiguration(input: unknown): TextPanelValidation {
  try {
    if (input === null || input === undefined) return { ok: true, value: null };
    if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_shape' };
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return { ok: false, error: 'invalid_shape' };
    const keys = Reflect.ownKeys(input);
    if (!keys.every(key => typeof key === 'string' && ['type', 'version', 'text'].includes(key))) return { ok: false, error: 'invalid_shape' };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) return { ok: false, error: 'invalid_shape' };
    const value = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
    if (value.type !== 'text') return { ok: false, error: 'unsupported_type' };
    if (value.version === 2) return keys.length === 2 && !keys.includes('text')
      ? { ok: true, value: { type: 'text', version: 2 } } : { ok: false, error: 'invalid_shape' };
    if (value.version !== 1) return { ok: false, error: 'unsupported_version' };
    if (keys.length !== 3) return { ok: false, error: 'invalid_shape' };
    if (typeof value.text !== 'string') return { ok: false, error: 'invalid_text' };
    if (value.text.length > TEXT_PANEL_MAX_CHARACTERS) return { ok: false, error: 'text_too_long' };
    return { ok: true, value: { type: 'text', version: 1, text: value.text } };
  } catch {
    return { ok: false, error: 'invalid_shape' };
  }
}

/** Only this small configuration belongs in an approved public projection. */
export function projectTextPanelConfiguration(input: unknown): TextPanelConfiguration | null {
  const result = validateTextPanelConfiguration(input);
  return result.ok ? result.value : null;
}

/** React remounts local visibility when the identity, content or availability changes. */
export function textPanelResetKey(scopeKey: string, configuration: TextPanelConfiguration, enabled: boolean, initiallyVisible: boolean): string {
  return JSON.stringify([scopeKey, configuration.version, configuration.text, enabled, initiallyVisible]);
}
