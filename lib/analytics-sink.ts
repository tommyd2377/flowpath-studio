import { validateAnalyticsEvent, validateAnalyticsObservation,
  type AnalyticsEvent, type AnalyticsPlatform, type AnalyticsSource } from './analytics-events';

export type AnalyticsSink = { write: (event: AnalyticsEvent) => void | Promise<void> };

/** Default delivery deliberately does nothing. No vendor, network or storage is selected. */
export const noopAnalyticsSink: AnalyticsSink = Object.freeze({ write() {} });

export function createAnalyticsRecorder({ source, platform, sink = noopAnalyticsSink,
  now = () => Date.now(), eventId = () => globalThis.crypto.randomUUID() }: {
  source: AnalyticsSource; platform: AnalyticsPlatform; sink?: AnalyticsSink;
  now?: () => number; eventId?: () => string;
}) {
  let closed = false;
  return {
    /** True means accepted for observation, never delivered, charged, admitted or settled. */
    record(input: unknown): boolean {
      if (closed) return false;
      try {
        const safe = validateAnalyticsObservation(input);
        if (!safe) return false;
        const event = validateAnalyticsEvent({ schemaVersion: 1, eventId: eventId(), occurredAt: now(), source, platform, ...safe });
        if (!event) return false;
        const delivery = sink.write(event);
        if (delivery) void Promise.resolve(delivery).catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    /** Close before replacing a host or identity so late callbacks cannot record. */
    close() { closed = true; },
  };
}

export function createInMemoryAnalyticsSink({ maxEvents = 100 }: { maxEvents?: number } = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 1_000) throw new RangeError('Analytics event capacity must be between 1 and 1000.');
  const events: AnalyticsEvent[] = [];
  const ids = new Set<string>();
  let closed = false;
  return {
    write(input: AnalyticsEvent) {
      if (closed || events.length >= maxEvents) return;
      const event = validateAnalyticsEvent(input);
      if (!event || ids.has(event.eventId)) return;
      events.push(event);
      ids.add(event.eventId);
    },
    snapshot(): AnalyticsEvent[] {
      return events.map(event => ({ ...event, properties: { ...event.properties } }) as AnalyticsEvent);
    },
    clear() { events.length = 0; ids.clear(); },
    /** Erase and stop capture. A stale host cannot add records after navigation. */
    close() { closed = true; events.length = 0; ids.clear(); },
  } satisfies AnalyticsSink & { snapshot: () => AnalyticsEvent[]; clear: () => void; close: () => void };
}
