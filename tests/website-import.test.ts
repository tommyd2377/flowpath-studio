import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { discoverWebsite, importWebsitePages, normalizeWebsiteUrl, extractWebsitePage, robotsAllows, websitePageCatalog, designWebsite } from '../lib/website-import';
import { retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { publishedWorkspace } from '../lib/visitor-workspace';
import type { WebsiteTransport } from '../lib/website-fetch';
import { applyWebsiteDesign } from '../lib/website-import-model';
import { sampleContent } from '../lib/site-model';

const home = '<html><head><title>Harbor Studio</title><meta property="og:site_name" content="Harbor Studio"><meta name="theme-color" content="#72542e"><meta name="description" content="Thoughtful spaces for everyday living."></head><body><h1>Room for what matters.</h1><p>We design practical, welcoming spaces with thoughtful materials and attention to the people who use them.</p><a href="/about">About us</a><a href="/services">Our services</a><a href="/account">Account</a><a href="https://outside.example/">Outside</a></body></html>';
const about = '<html><title>About Harbor</title><h1>About our studio</h1><p>Our independent studio brings people and places together. We work with our clients from first conversation through the final details.</p><a href="/team">Meet the team</a></html>';
function fixture(overrides: Record<string, { text: string; status?: number; type?: string; location?: string }> = {}) {
  const calls: string[] = [];
  const pages = { '/': { text: home }, '/about': { text: about }, '/services': { text: about.replaceAll('About', 'Services') }, '/team': { text: about.replaceAll('About', 'Team') },
    '/robots.txt': { text: 'User-agent: *\nDisallow: /private\nDisallow: /account', type: 'text/plain' },
    '/sitemap.xml': { text: '<urlset><url><loc>https://harbor.example/services</loc></url><url><loc>https://harbor.example/private</loc></url></urlset>', type: 'application/xml' }, ...overrides };
  const io: WebsiteTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], connect: async url => {
    calls.push(url.toString()); const page = pages[url.pathname as keyof typeof pages] as { text: string; status?: number; type?: string; location?: string } | undefined;
    return { remoteAddress: '93.184.216.34', status: page?.status ?? (page ? 200 : 404), bytes: Buffer.from(page?.text ?? ''), contentType: page?.type ?? 'text/html', location: page?.location };
  } };
  return { io, calls };
}

test('domain normalization is HTTPS-only and rejects credentials, private and transactional destinations', () => {
  assert.equal(normalizeWebsiteUrl('harbor.example/about?utm_source=share#team').toString(), 'https://harbor.example/about');
  for (const url of ['http://harbor.example', 'https://user:secret@harbor.example', 'https://127.0.0.1', 'https://harbor.example/checkout', 'https://harbor.example/?search=all', 'https://harbor.example/%61ccount']) assert.throws(() => normalizeWebsiteUrl(url));
  for (const path of ['/my-account', '/my-account-2/', '/account-2', '/checkout-2', '/basket', '/basket-3', '/shopping-cart', '/orders', '/order-now', '/order-online-2', '/online-ordering', '/place-order', '/shop/cart-2', '/wp-login.php']) {
    assert.throws(() => normalizeWebsiteUrl(`https://harbor.example${path}`), /cannot be imported/);
  }
  for (const path of ['/accounting', '/ordering-guide', '/basket-weaving', '/checkout-policy']) assert.equal(normalizeWebsiteUrl(`https://harbor.example${path}`).pathname, path);
});

test('discovery combines sitemaps with nested navigation and records robots exclusions', async () => {
  const { io, calls } = fixture(); const result = await discoverWebsite('harbor.example', io);
  assert.ok(result.pages.some(page => page.url.endsWith('/team')));
  assert.equal(result.pages.find(page => page.url.endsWith('/private'))?.status, 'failed');
  assert.equal(result.pages[0].title, 'Harbor Studio');
  assert.ok(calls.every(url => new URL(url).hostname === 'harbor.example'));
  assert.ok(!calls.some(url => /\/private|\/account/.test(url)));
});

test('discovery prioritizes primary navigation over body links and noisy sitemaps within existing bounds', async () => {
  const primary = ['/our-menu', '/about-us', '/faq-page', '/contact-us', '/catering'];
  const transactional = ['/my-account-2', '/checkout-2', '/basket', '/order-online-2'];
  const bodyLinks = Array.from({ length: 30 }, (_, index) => `/archive-${index}`);
  const sitemapPaths = [...Array.from({ length: 110 }, (_, index) => `/sample-page-${index}`), ...transactional, ...primary];
  const anchor = (path: string) => `<a href="${path}">${path.slice(1)}</a>`;
  const { io, calls } = fixture({
    '/': { text: `${home}${bodyLinks.map(anchor).join('')}<nav aria-label="Main">${[...transactional, ...primary].map(anchor).join('')}</nav>` },
    '/sitemap.xml': { text: `<urlset>${sitemapPaths.map(path => `<url><loc>https://harbor.example${path}</loc></url>`).join('')}</urlset>`, type: 'application/xml' },
    ...Object.fromEntries([...primary, ...bodyLinks].map(path => [path, { text: about.replaceAll('About', path.slice(1)) }])),
  });
  const result = await discoverWebsite('harbor.example', io);
  const selected = result.pages.filter(page => page.status === 'ready').slice(0, 24).map(page => new URL(page.url).pathname);
  assert.deepEqual(result.pages.slice(0, primary.length + 1).map(page => new URL(page.url).pathname), ['/', ...primary]);
  assert.ok(primary.every(path => selected.includes(path)));
  assert.equal(result.pages.length, 100);
  assert.equal(calls.filter(url => !['/robots.txt', '/sitemap.xml'].includes(new URL(url).pathname)).length, 12);
  assert.ok(result.notes.some(note => note.startsWith('Discovery reached a bound')));
  assert.ok(!result.pages.some(page => transactional.includes(new URL(page.url).pathname)));
  assert.ok(!calls.some(url => transactional.includes(new URL(url).pathname)));
});

test('an unreadable starting page is attempted once and still falls back to sitemap discovery', async () => {
  const { io, calls } = fixture({ '/': { text: '<div id="root"></div><script>loadContent()</script>' } });
  const result = await discoverWebsite('harbor.example', io);
  assert.equal(result.pages[0].status, 'failed');
  assert.equal(result.pages.find(page => page.url.endsWith('/services'))?.status, 'ready');
  assert.equal(calls.filter(url => new URL(url).pathname === '/').length, 1);
});

test('nested sitemaps and www redirects are bounded; redirects never fetch other hosts or blocked paths', async () => {
  const first = fixture({ '/sitemap.xml': { text: '<sitemapindex><sitemap><loc>https://harbor.example/pages.xml</loc></sitemap></sitemapindex>', type: 'application/xml' }, '/pages.xml': { text: '<urlset><url><loc>https://harbor.example/team</loc></url></urlset>', type: 'text/xml' }, '/old': { text: '', status: 301, location: 'https://www.harbor.example/about' } });
  assert.ok((await discoverWebsite('harbor.example', first.io)).pages.some(page => page.url.endsWith('/team')));
  assert.equal((await importWebsitePages('harbor.example', ['https://harbor.example/old'], first.io)).pages[0].url, 'https://www.harbor.example/about');
  for (const location of ['https://outside.example/', 'https://harbor.example/private', 'https://harbor.example/account', 'https://harbor.example/my-account-2', 'https://harbor.example/checkout-2', 'https://harbor.example/basket', 'https://harbor.example/order-online-2', 'https://127.0.0.1/']) {
    const { io, calls } = fixture({ '/old': { text: '', status: 302, location } });
    await assert.rejects(() => importWebsitePages('harbor.example', ['https://harbor.example/old'], io));
    assert.ok(!calls.includes(location));
  }
});

test('robots longest-match allow wins and a site-specific group overrides wildcard', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /about$', 'https://harbor.example/about'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /about$', 'https://harbor.example/about/team'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nUser-agent: FlowPathStudio\nAllow: /', 'https://harbor.example/about'), true);
});

test('selected-page extraction reports failures, exact duplicates and the aggregate limit without truncation', async () => {
  const long = `<title>Long page</title><p>${'A'.repeat(35000)}</p>`;
  const { io } = fixture({ '/long': { text: long }, '/longer': { text: long.replaceAll('A', 'B') }, '/same': { text: home }, '/empty': { text: '<div id="root"></div><script>loadContent()</script>' } });
  const result = await importWebsitePages('harbor.example', ['/', '/same', '/missing', '/empty', '/long', '/longer'].map(path => `https://harbor.example${path}`), io);
  assert.deepEqual(result.report.map(page => page.status), ['imported', 'duplicate', 'failed', 'failed', 'imported', 'skipped']);
  assert.ok(result.text.length <= 60000); assert.ok(result.pages[1].text.includes('A'.repeat(35000)));
  await assert.rejects(() => importWebsitePages('harbor.example', ['https://outside.example/'], io));
});

test('HTML supplies identity and complete reading blocks, never executable markup or invented capabilities', () => {
  const page = extractWebsitePage(`${home}<script><a href="/injected">Bad</a></script><style>bad{}</style>`, 'https://harbor.example/');
  assert.ok(!page.text.includes('bad{}')); assert.ok(!page.links.some(link => link.url.endsWith('/injected')));
  const catalog = websitePageCatalog([page]); assert.equal(catalog.entities[0].blocks?.map(block => block.text).join('\n'), page.text.replace(/^#{1,6} /gm, ''));
  assert.equal(catalog.capabilities, undefined);
  const design = designWebsite(page, 2); assert.equal(design.name, 'Harbor Studio');
  const content = sampleContent('general'); const applied = applyWebsiteDesign(content, design);
  assert.equal(applied.style?.entry, 'website'); assert.equal(applied.opening?.copyMode, 'personalized');
  const longPage = extractWebsitePage(`${home}<p>${'ordinary content '.repeat(140)}Distinctive endmatter keyword.</p>`, page.url);
  const searchable = websitePageCatalog([longPage]);
  assert.equal(retrieveKnowledge(searchable, { revisionId: searchable.id, query: 'endmatter', expansion: 0 }).entities.length, 1);
  assert.ok(publishedWorkspace(applied, searchable).records.find(record => record.reference.kind === 'entity')?.keywords?.includes('endmatter'));
  assert.equal(applied.contact, content.contact); assert.deepEqual(applied.sections, content.sections);
});

test('website snapshot lifecycle: private review, design correction, partial approval, publish, stale protection and Undo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'website-import-test-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No external network or model calls allowed'); };
  try {
    const { listSites, getSite, modifySite } = await import('../lib/site-store');
    const { analyzeKnowledgeWebsite, applyKnowledge, reviseKnowledge, reviewKnowledgeAssertions, getKnowledgeState } = await import('../lib/ingestion');
    const { getPublishedKnowledge } = await import('../lib/knowledge-store');
    const { applyCommand } = await import('../lib/site-commands');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const site = await getSite(user, (await listSites(user))[0].id), { io, calls } = fixture();
    const requestId = randomUUID();
    const input = { url: 'harbor.example', urls: ['https://harbor.example/', 'https://harbor.example/about', 'https://harbor.example/missing'], revision: site.revision, requestId };
    let state = await analyzeKnowledgeWebsite(user, site.id, input, io);
    assert.equal(state.candidates.length, 1, JSON.stringify(state.jobs));
    let candidate = state.candidates[0];
    assert.deepEqual((await getSite(user, site.id)).draft, site.draft);
    assert.equal(candidate.website?.pages.at(-1)?.status, 'failed');
    const design = { ...candidate.website!.design, headline: 'Our reviewed headline' };
    state = await reviseKnowledge(user, site.id, { candidateId: candidate.id, revision: site.revision, catalog: candidate.catalog, websiteDesign: design });
    candidate = state.candidates[0]; assert.equal(candidate.website?.design.headline, design.headline);
    await assert.rejects(() => applyKnowledge(user, site.id, { candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision, websiteDesign: design }), /acknowledge/);
    state = await reviewKnowledgeAssertions(user, site.id, { candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision, decisions: candidate.assertionReviews!.filter(review => review.status === 'pending').map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: 'approve' })) });
    candidate = state.candidates[0];
    const count = calls.length;
    const applied = await applyKnowledge(user, site.id, { candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision, websiteDesign: design, acceptPartial: true });
    assert.equal(calls.length, count, 'Apply never recrawls');
    assert.equal(applied.site.draft.headline, design.headline); assert.equal(applied.site.draft.style?.entry, 'website'); assert.equal(applied.site.published, site.published);
    await assert.rejects(() => getPublishedKnowledge(site.id, candidate.catalog.id), /published knowledge revision/);
    const published = await modifySite(user, site.id, applied.site.revision, current => applyCommand(current, { action: 'publish', revision: current.revision }));
    const catalog = await getPublishedKnowledge(site.id, candidate.catalog.id);
    assert.equal(catalog?.entities.length, 2); assert.ok(catalog?.entities[1].blocks?.length);
    assert.ok(!JSON.stringify(catalog).includes('capturedAt')); assert.ok(!JSON.stringify(catalog).includes('harbor.example'));
    const undone = await modifySite(user, site.id, published.revision, current => applyCommand(current, { action: 'undo', revision: current.revision }));
    assert.deepEqual(undone.draft, site.draft); assert.equal(undone.published?.headline, design.headline);
    const fresh = await analyzeKnowledgeWebsite(user, site.id, { ...input, revision: undone.revision, requestId: randomUUID() }, io);
    const edited = await modifySite(user, site.id, undone.revision, current => applyCommand(current, { action: 'save', revision: current.revision, content: { ...current.draft, name: 'Concurrent edit' } }));
    const latest = fresh.candidates.at(-1)!;
    await assert.rejects(() => applyKnowledge(user, site.id, { candidateId: latest.id, candidateRevisionId: latest.catalog.id, revision: edited.revision, acceptPartial: true }), /draft changed/i);
    assert.equal((await getKnowledgeState(user, site.id)).jobs.at(-1)?.status, 'needs_review');
  } finally { globalThis.fetch = originalFetch; delete process.env.VOICE_DATA_DIR; await rm(directory, { recursive: true, force: true }); }
});

test('image-only links, empty metadata and missing headings do not reject a readable website', async () => {
  const markup = '<html><meta name="description" content=""><meta name="theme-color" content=""><body><a href="/" aria-label="Home"><img src="logo.png" alt=""></a><a href="/about"><svg aria-hidden="true"></svg></a><p>Our independent bakery prepares cakes and pastries for local celebrations. Learn about our menu, our team and how to visit our shop.</p></body></html>';
  const page = extractWebsitePage(markup, 'https://harbor.example/');
  assert.match(page.text, /independent bakery/);
  assert.equal(page.links[0].title, 'Home');
  assert.equal(page.links[1].title, 'https://harbor.example/about');
  const { io } = fixture({ '/': { text: markup }, '/about': { text: markup } });
  const discovery = await discoverWebsite('harbor.example', io);
  assert.equal(discovery.pages[0].status, 'ready');
  const imported = await importWebsitePages(discovery.url, [discovery.pages[0].url], io);
  assert.equal(imported.report[0].status, 'imported');
  assert.throws(() => extractWebsitePage('<html><meta name="description" content=""><a href="/"><img src="logo.png"></a></html>', 'https://harbor.example/'), /readable text/);
});
