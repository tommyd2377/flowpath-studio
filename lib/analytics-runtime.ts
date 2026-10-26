import { createAnalyticsRecorder } from './analytics-sink';
import type { AnalyticsSurface } from './analytics-events';

// No external delivery or persistence is configured. Hosts can inject a tested adapter later.
export const clientAnalytics = createAnalyticsRecorder({ source: 'client', platform: 'web' });
export const serverAnalytics = createAnalyticsRecorder({ source: 'server', platform: 'web' });
const visited = new Set<AnalyticsSurface>();
export function observeVisit(surface: AnalyticsSurface) {
  clientAnalytics.record({ eventName: 'session_visited', properties: { surface, visit: visited.has(surface) ? 'return_in_tab' : 'first_in_tab' } });
  visited.add(surface);
  clientAnalytics.record({ eventName: 'waveform_viewed', properties: { surface } });
}
