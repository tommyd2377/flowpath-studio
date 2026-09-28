import { htmlDocument, textBlocks, parseHtml } from './html-document';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';
import { recommendWebsiteDesign } from './website-design-recommendation';
import { extractWebsiteImages } from './website-image-discovery';
import { AppError } from './errors';
import { assertPublicWebsiteUrl, fetchWebsiteResource, type WebsiteTransport } from './website-fetch';
import { htmlToText } from './source-adapters';
import { WEBSITE_LIMITS, websiteDesignSchema, type WebsiteDesign, type WebsiteDiscovery, type WebsitePageReport } from './website-import-model';

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const siteHost = (url: URL) => url.hostname.replace(/^www\./, '');
const blockedPath = /(?:^|\/)(?:(?:my[-_]?)?accounts?|log[-_]?in|sign[-_]?in|log[-_]?out|admin|wp-admin|wp-login\.php|check[-_]?out|cart|basket|shopping[-_](?:cart|basket)|payments?|billing|subscribe|orders?|ordering|order[-_](?:now|online)|online[-_]order(?:ing)?|place[-_]order)(?:[-_]\d+)?(?:\/|$)/i;
const excludedFile = /\.(?:pdf|zip|jpe?g|png|webp|gif|svg|mp[34]|css|js|json|xml|txt|woff2?)$/i;
// Optional labels/metadata can be empty (for example an image-only home link).
// Only the complete page must contain readable text.
const plain = (value: string) => htmlToText(value, { allowEmpty: true }).replace(/\s+/g, ' ').trim();
export function normalizeWebsiteUrl(value: string) {
  const trimmed = value.trim();
  const url = assertPublicWebsiteUrl(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
  if (url.search) throw new AppError('Import a page URL without query parameters. Search and filtered pages are not crawled.');
  if (blockedPath.test(decodeURIComponent(url.pathname))) throw new AppError('Account, checkout and administrative pages cannot be imported.');
  return url;
}
function pageUrl(value: string, base: string, root: string) {
  try {
    const url = normalizeWebsiteUrl(new URL(value, base).toString());
    if (siteHost(url) !== siteHost(new URL(root)) || excludedFile.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}
export type ExtractedWebsitePage = { url: string; title: string; text: string; name: string; headline: string; description: string; accent?: string; rawText?: string; contact?: string; hours?: string; blocks?: ReturnType<typeof textBlocks>; links: { url: string; title: string }[]; images: ReturnType<typeof extractWebsiteImages> };
export function extractWebsitePage(html: string, url: string): ExtractedWebsitePage {
  const root = parseHtml(html);
  const meta = new Map(root.querySelectorAll('meta').map(node => { const a=node.attributes;return [a.property || a.name,a.content || '']; }));
  const title = (root.querySelector('title')?.text.trim() ?? '').slice(0,160);
  const headline = (root.querySelector('h1')?.text.trim() || title).slice(0,140);
  let businessName = '';
  for (const node of root.querySelectorAll('script[type="application/ld+json"]').slice(0,20)) {
    try {
      const value = JSON.parse(node.innerHTML);
      const records = Array.isArray(value) ? value : Array.isArray(value['@graph']) ? value['@graph'] : [value];
      const business = records.find((r: Record<string,unknown>) => r && ['Organization','LocalBusiness','Bakery','Store','Restaurant'].some(type => [r['@type']].flat().includes(type)) && typeof r.name === 'string');
      if(business) { businessName=plain(business.name);break; }
    } catch { /* Invalid structured metadata is not evidence. */ }
  }
  for(const node of root.querySelectorAll('script,style,noscript,template'))node.remove();
  // Keep contact/navigation/footer text as source evidence; exact repeated pages are deduplicated later.
  const document = htmlDocument(html);
  const text = document.text;
  if (!text) throw new AppError('This webpage did not contain readable text.');
  const accent = meta.get('theme-color');
  // Read primary navigation before product carousels, archives and footer links.
  const navigation = root.querySelectorAll('nav a[href],header a[href],[role="navigation"] a[href],[role="banner"] a[href],[data-elementor-type="header"] a[href]');
  const links = [...new Set([...navigation, ...root.querySelectorAll('a[href]')])].slice(0,2000).flatMap(node => {
    const a=node.attributes, target=pageUrl(a.href,url,url);
    return target ? [{url:target,title:(node.text.trim() || a['aria-label'] || a.title || target).slice(0,160)}] : [];
  });
  return { url, rawText: document.rawText, blocks: textBlocks(text), contact: document.contact, hours: document.hours, title: title || headline || new URL(url).pathname, text, name: (businessName || meta.get('og:site_name') || title.split(/\s[|–—]\s/)[0] || new URL(url).hostname).slice(0, 80),
    headline: headline || new URL(url).hostname, description: (meta.get('description') || meta.get('og:description') || text.replace(/^Title:[^\n]*\n?/, '').trim()).slice(0, 1500),
    ...(/^#[\da-f]{6}$/i.test(accent ?? '') ? { accent } : {}), links, images: extractWebsiteImages(html, url) };
}
export function designWebsite(page: ExtractedWebsitePage, pages: number, catalog?: KnowledgeCatalog, discoveredImageCount = page.images.length): WebsiteDesign {
  const { template } = recommendWebsiteDesign({ catalog, pageCount: pages, discoveredImageCount });
  return websiteDesignSchema.parse({ name: page.name, headline: page.headline, description: page.description,
    accent: page.accent ?? '#72542e', contact: page.contact ?? '', hours: page.hours ?? '', style: { ...WEBSITE_TEMPLATES[template].defaults, palette: 'parchment', entry: 'website', customAccent: true } });
}

/** Pinned DNS and TLS validation on every hop; no cookies, scripts, forms or external hosts. */
async function fetchResource(value: string, root: string, io: WebsiteTransport | undefined, signal: AbortSignal, rules?: string) {
  let url = assertPublicWebsiteUrl(value); const visited = new Set<string>();
  for (let hop = 0; hop <= 3; hop++) {
    if (siteHost(url) !== siteHost(new URL(root)) || blockedPath.test(decodeURIComponent(url.pathname))) throw new AppError('The page redirects outside this website or to an excluded page.');
    if (rules !== undefined && !robotsAllows(rules, url.toString())) throw new AppError('Excluded by robots.txt.');
    if (visited.has(url.toString())) throw new AppError('Redirect loop.');
    visited.add(url.toString());
    const response = await fetchWebsiteResource(url.toString(), io, signal);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) { url = normalizeWebsiteUrl(new URL(response.location, url).toString()); continue; }
    return response;
  }
  throw new AppError('The page exceeded the three-redirect limit.');
}
export function robotsAllows(text: string, url: string) {
  const groups: { agents: string[]; rules: { path: string; allow: boolean }[] }[] = [];
  let current = { agents: [] as string[], rules: [] as { path: string; allow: boolean }[] };
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, '').match(/^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/i); if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2];
    if (key === 'user-agent') { if (current.rules.length) { groups.push(current); current = { agents: [], rules: [] }; } current.agents.push(value.toLowerCase()); }
    else if (current.agents.length && value) current.rules.push({ path: value, allow: key === 'allow' });
  }
  groups.push(current);
  const specific = groups.filter(group => group.agents.includes('flowpathstudio'));
  const applicable = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  const path = new URL(url).pathname + new URL(url).search;
  const matching = applicable.flatMap(group => group.rules).filter(rule => {
    const end = rule.path.endsWith('$'); const pattern = (end ? rule.path.slice(0, -1) : rule.path).split('*').map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${end ? '$' : ''}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}
async function robots(root: string, io: WebsiteTransport | undefined, signal: AbortSignal) {
  const response = await fetchResource(new URL('/robots.txt', root).toString(), root, io, signal);
  if (response.status === 404 || response.status === 410) return '';
  if (response.status !== 200 || !['text/plain', 'text/html'].includes(response.contentType)) throw new AppError('Could not verify robots.txt. Try again later; no pages were crawled.');
  return response.text;
}
async function readPage(url: string, root: string, rules: string, io: WebsiteTransport | undefined, signal: AbortSignal) {
  if (!robotsAllows(rules, url)) throw new AppError('Excluded by robots.txt.');
  const response = await fetchResource(url, root, io, signal, rules);
  if (!robotsAllows(rules, response.url)) throw new AppError('The destination is excluded by robots.txt.');
  if (response.status !== 200) throw new AppError(`Page returned HTTP ${response.status}.`);
  if (!['text/html', 'application/xhtml+xml'].includes(response.contentType)) throw new AppError('Not an HTML page.');
  const page = extractWebsitePage(response.text, response.url);
  if (page.text.length < 80) throw new AppError('Too little HTML text. This page may need JavaScript rendering or may be empty.');
  if (page.text.length > WEBSITE_LIMITS.characters) throw new AppError('Page exceeds the 60,000-character import limit.');
  return page;
}
const message = (error: unknown) => (error instanceof AppError ? error.message : 'Page could not be read.').slice(0, 500);
export async function discoverWebsite(value: string, io?: WebsiteTransport): Promise<WebsiteDiscovery> {
  const root = normalizeWebsiteUrl(value).toString(), signal = AbortSignal.timeout(WEBSITE_LIMITS.durationMs);
  const rules = await robots(root, io, signal);
  const images = new Map<string, ReturnType<typeof extractWebsiteImages>[number]>();
  const pages = new Map<string, WebsitePageReport>(); const notes: string[] = [];
  const add = (url: string, title = url) => { if (!pages.has(url) && pages.size < WEBSITE_LIMITS.discovered) pages.set(url, { url, title, status: 'ready', message: 'Discovered; content will be read when selected.', characters: 0 }); };
  add(root);
  const visited = new Set<string>();
  const visit = async (next: WebsitePageReport) => {
    visited.add(next.url);
    try {
      const page = await readPage(next.url, root, rules, io, signal);
      Object.assign(next, { title: page.title, message: 'HTML available.', characters: page.text.length });
      for (const image of page.images) if (images.size < WEBSITE_LIMITS.images && !images.has(image.url)) images.set(image.url, image);
      for (const link of page.links) add(link.url, link.title);
    } catch (error) { Object.assign(next, { status: 'failed', message: message(error) }); }
  };
  // Navigation leads both the bounded crawl and the default page selection.
  // Reading it first also prevents a large sitemap from filling the discovery cap.
  await visit(pages.get(root)!);
  const maps = [...new Set([new URL('/sitemap.xml', root).toString(), ...[...rules.matchAll(/^sitemap:\s*(\S+)/gim)].map(match => match[1])])];
  const seenMaps = new Set<string>();
  for (let i = 0; i < maps.length && seenMaps.size < WEBSITE_LIMITS.sitemaps && !signal.aborted; i++) {
    try {
      const target = assertPublicWebsiteUrl(new URL(maps[i], root).toString());
      if (siteHost(target) !== siteHost(new URL(root)) || seenMaps.has(target.toString()) || !robotsAllows(rules, target.toString())) continue;
      seenMaps.add(target.toString());
      const response = await fetchResource(target.toString(), root, io, signal, rules);
      if (response.status !== 200 || !['application/xml', 'text/xml'].includes(response.contentType)) { notes.push('A sitemap was unavailable; navigation links were also checked.'); continue; }
      const locations = [...response.text.matchAll(/<loc\b[^>]*>([^<]+)<\/loc\s*>/gi)].slice(0, 2000).map(match => plain(match[1]));
      if (/<sitemapindex\b/i.test(response.text)) maps.push(...locations);
      else for (const location of locations) { const url = pageUrl(location, response.url, root); if (url) add(url); }
    } catch { notes.push('A sitemap could not be read; discovery continued through navigation links.'); }
  }
  while (visited.size < WEBSITE_LIMITS.discoveryFetches && !signal.aborted) {
    const next = [...pages.values()].find(page => !visited.has(page.url)); if (!next) break;
    await visit(next);
  }
  if (pages.size >= WEBSITE_LIMITS.discovered || [...pages.keys()].some(url => !visited.has(url)) || maps.length > seenMaps.size) notes.push('Discovery reached a bound. This is a partial map, not a guarantee that every page was found. You can import another section separately.');
  notes.push('Public HTML only. Discover images to import supported photos. Script-only content, downloads, working forms and account pages are not imported.');
  return { url: root, pages: [...pages.values()], images: [...images.values()], notes: [...new Set(notes)].slice(0, 20) };
}
export async function importWebsitePages(value: string, selected: string[], io?: WebsiteTransport) {
  const root = normalizeWebsiteUrl(value).toString();
  if (!selected.length || selected.length > WEBSITE_LIMITS.pages || new Set(selected).size !== selected.length) throw new AppError('Select between 1 and 24 distinct pages.');
  const urls = selected.map(value => { const url = pageUrl(value, root, root); if (!url) throw new AppError('Every selected page must be a public HTML URL on the same website.'); return url; });
  const signal = AbortSignal.timeout(WEBSITE_LIMITS.durationMs), rules = await robots(root, io, signal);
  const pages: ExtractedWebsitePage[] = [], report: WebsitePageReport[] = [], hashes = new Set<string>(); let characters = 0;
  for (const url of urls) {
    try {
      const page = await readPage(url, root, rules, io, signal), hash = digest(page.text);
      if (hashes.has(hash)) { report.push({ url, title: page.title, status: 'duplicate', message: 'Same text as another selected page; imported once.', characters: page.text.length }); continue; }
      // Include the per-page labels in the model input limit. Never silently truncate selected content.
      if (characters + page.text.length + url.length + 20 > WEBSITE_LIMITS.characters) { report.push({ url, title: page.title, status: 'skipped', message: 'Combined 60,000-character limit reached. Import this page separately.', characters: page.text.length }); continue; }
      hashes.add(hash); characters += page.text.length + url.length + 20; pages.push(page);
      report.push({ url, title: page.title, status: 'imported', message: 'Captured as HTML text for review.', characters: page.text.length });
    } catch (error) { report.push({ url, title: url, status: 'failed', message: message(error), characters: 0 }); }
  }
  if (!pages.length) throw new AppError(`No pages could be imported. ${report[0]?.message ?? ''}`);
  return { pages, report, text: pages.map(page => `[Webpage: ${page.url}]\n${page.text}`).join('\n\n') };
}

/** Offline imports preserve page text verbatim as reading blocks; they do not claim model interpretation. */
export function websitePageCatalog(pages: ExtractedWebsitePage[]): KnowledgeCatalog {
  const entities = pages.map(page => ({ id: `page-${digest(page.url)}`, kind: 'page', name: page.headline.slice(0, 160), summary: page.text.slice(0, 1600), attributes: {},
    blocks: page.blocks ?? textBlocks(page.text) }));
  return validateCatalog({ schemaVersion: 1, id: randomUUID(), name: pages[0].name, description: 'Imported website pages. Review their content before publishing.',
    attributes: [], entities, collections: [{ id: 'website-pages', name: 'Explore', entityIds: entities.map(entity => entity.id) }], relationships: [], jobs: [] });
}

export async function readWebsiteImageSource(rootValue: string, pageValue: string, io?: WebsiteTransport) {
  const root = normalizeWebsiteUrl(rootValue).toString(), signal = AbortSignal.timeout(WEBSITE_LIMITS.durationMs);
  const page = pageUrl(pageValue, root, root);
  if (!page) throw new AppError('The image source must be a public page of this website.');
  return readPage(page, root, await robots(root, io, signal), io, signal);
}

export async function readWebsitePageSource(rootValue: string, pageValue: string, io?: WebsiteTransport) {
  const root = normalizeWebsiteUrl(rootValue).toString(), signal = AbortSignal.timeout(WEBSITE_LIMITS.durationMs);
  const page = pageUrl(pageValue,root,root); if(!page) throw new AppError('Choose a public page from this website.');
  const rules=await robots(root,io,signal); const response=await fetchResource(page,root,io,signal,rules);
  if(response.status!==200||!['text/html','application/xhtml+xml'].includes(response.contentType))throw new AppError('Source HTML unavailable.');
  return {url:response.url,html:response.text};
}
