import { AppError } from './errors';
import { exploreSettings } from './explore-model';
import type { SiteContent } from './site-model';
import type { VisitorLedger } from './visitor-quota';

export const GLOBAL_SEARCH_LIMIT = 100;
export function searchRemaining(ledger: VisitorLedger, siteId: string, content: SiteContent) {
  const settings = exploreSettings(content);
  return settings.enabled && content.visitor?.enabled ? Math.max(0, Math.min(settings.dailyLimit - (ledger.search?.sites[siteId] ?? 0), GLOBAL_SEARCH_LIMIT - (ledger.search?.total ?? 0))) : 0;
}
export function reserveSearch(ledger: VisitorLedger, siteId: string, requestId: string, content: SiteContent) {
  if (!exploreSettings(content).enabled || !content.visitor?.enabled) throw new AppError('Search and explore is not enabled on this published site.', 403);
  if (ledger.requests[requestId]) throw new AppError('This search was already received. Start a new search to continue.', 409);
  if (!searchRemaining(ledger, siteId, content)) throw new AppError('Search has reached its daily limit. Existing results and site browsing remain available.', 429);
  ledger.search ??= { total: 0, sites: {} };
  ledger.search.total++;
  ledger.search.sites[siteId] = (ledger.search.sites[siteId] ?? 0) + 1;
  ledger.requests[requestId] = true;
}
