export type AnalyticsSource = 'client' | 'server';
export type AnalyticsPlatform = 'web' | 'ios' | 'android';
export type AnalyticsSurface = 'home' | 'account' | 'private' | 'public';
export type AnalyticsDestination = AnalyticsSurface | 'news';
export type AnalyticsEndReason = 'user' | 'silence' | 'limit' | 'navigation' | 'failure' | 'unknown';
export type AnalyticsMetricEvidence = 'provider_confirmed' | 'ledger_committed';

type AnalyticsProperties = {
  session_visited: { surface: AnalyticsSurface; visit: 'first_in_tab' | 'return_in_tab' };
  waveform_viewed: { surface: AnalyticsSurface };
  demo_started: Record<string, never>;
  demo_ended: { reason: AnalyticsEndReason };
  navigation_selected: { destination: AnalyticsDestination };
  creation_step: { step: 'opened' | 'editing' | 'review_pending' | 'review_approved' | 'review_rejected' | 'saved' | 'published'; outcome: 'success' | 'blocked' | 'failure' };
  voice_start_requested: { surface: AnalyticsSurface };
  voice_connected: { surface: AnalyticsSurface };
  voice_ended: { surface: AnalyticsSurface; reason: AnalyticsEndReason };
  paywall_shown: { mode: 'creator' | 'intro' | 'visitor' };
  payer_selected: { payer: 'creator' | 'self' };
  usage_observed: { seconds: number; evidence: AnalyticsMetricEvidence };
  cost_observed: { amountMicrounits: number; currency: 'USD'; evidence: AnalyticsMetricEvidence };
};

export type AnalyticsEventName = keyof AnalyticsProperties;
export type AnalyticsObservation = { [Name in AnalyticsEventName]: {
  eventName: Name; properties: AnalyticsProperties[Name];
} }[AnalyticsEventName];
export type AnalyticsEvent = AnalyticsObservation & {
  schemaVersion: 1;
  /** Fresh telemetry UUID, never an account, browser, provider, admission or ledger ID. */
  eventId: string;
  occurredAt: number;
  source: AnalyticsSource;
  platform: AnalyticsPlatform;
};

type FieldRule = readonly string[] | { readonly maximum: number };
const surfaces = ['home', 'account', 'private', 'public'] as const;
const endReasons = ['user', 'silence', 'limit', 'navigation', 'failure', 'unknown'] as const;
const evidence = ['provider_confirmed', 'ledger_committed'] as const;
const properties: Record<AnalyticsEventName, Record<string, FieldRule>> = {
  session_visited: { surface: surfaces, visit: ['first_in_tab', 'return_in_tab'] },
  waveform_viewed: { surface: surfaces },
  demo_started: {},
  demo_ended: { reason: endReasons },
  navigation_selected: { destination: [...surfaces, 'news'] },
  creation_step: { step: ['opened', 'editing', 'review_pending', 'review_approved', 'review_rejected', 'saved', 'published'], outcome: ['success', 'blocked', 'failure'] },
  voice_start_requested: { surface: surfaces },
  voice_connected: { surface: surfaces },
  voice_ended: { surface: surfaces, reason: endReasons },
  paywall_shown: { mode: ['creator', 'intro', 'visitor'] },
  payer_selected: { payer: ['creator', 'self'] },
  usage_observed: { seconds: { maximum: 86_400 }, evidence },
  cost_observed: { amountMicrounits: { maximum: 1_000_000_000_000 }, currency: ['USD'], evidence },
};
const eventKeys = ['schemaVersion', 'eventId', 'occurredAt', 'source', 'platform', 'eventName', 'properties'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read data fields only. Accessors, symbols and custom prototypes are not telemetry. */
function dataRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== Object.keys(descriptors).length) return null;
  if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) return null;
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

function observation(input: unknown): AnalyticsObservation | null {
  const value = dataRecord(input);
  if (!value || !exactKeys(value, ['eventName', 'properties']) || typeof value.eventName !== 'string'
    || !Object.hasOwn(properties, value.eventName)) return null;
  const rules = properties[value.eventName as AnalyticsEventName];
  const fields = dataRecord(value.properties);
  if (!fields || !exactKeys(fields, Object.keys(rules))) return null;
  for (const [key, rule] of Object.entries(rules)) {
    const field = fields[key];
    if (Array.isArray(rule)) {
      if (typeof field !== 'string' || !rule.includes(field)) return null;
    } else if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0 || field > (rule as { maximum: number }).maximum) return null;
  }
  return { eventName: value.eventName, properties: { ...fields } } as AnalyticsObservation;
}

/** Reject the whole observation if any field is unknown; never retain raw input or errors. */
export function validateAnalyticsObservation(input: unknown): AnalyticsObservation | null {
  try { return observation(input); } catch { return null; }
}

/** Metrics are server observations only; this validation grants no financial authority. */
export function validateAnalyticsEvent(input: unknown): AnalyticsEvent | null {
  try {
    const value = dataRecord(input);
    if (!value || !exactKeys(value, eventKeys) || value.schemaVersion !== 1
      || typeof value.eventId !== 'string' || !uuid.test(value.eventId)
      || typeof value.occurredAt !== 'number' || !Number.isSafeInteger(value.occurredAt) || value.occurredAt < 0 || value.occurredAt > 8_640_000_000_000_000
      || !['client', 'server'].includes(value.source as string) || !['web', 'ios', 'android'].includes(value.platform as string)) return null;
    const safe = observation({ eventName: value.eventName, properties: value.properties });
    if (!safe || (['usage_observed', 'cost_observed'].includes(safe.eventName) && value.source !== 'server')) return null;
    return { schemaVersion: 1, eventId: value.eventId, occurredAt: value.occurredAt,
      source: value.source as AnalyticsSource, platform: value.platform as AnalyticsPlatform, ...safe };
  } catch {
    return null;
  }
}
