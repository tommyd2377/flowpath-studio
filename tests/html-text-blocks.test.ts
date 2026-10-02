import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogEntitySchema } from '@thevoice/platform-ui/contracts';
import { textBlocks } from '../lib/html-document';
import { extractWebsitePage, importWebsitePages, websitePageCatalog } from '../lib/website-import';
import type { WebsiteTransport } from '../lib/website-fetch';

const tail = 'FINAL QUALIFICATION: Access requires prior approval.';
const paragraph = (length: number) => `${'Source context '.repeat(Math.ceil(length / 15)).slice(0, length - tail.length)}${tail}`;
const markup = (body: string) => `<html><head><title>Harbor terms</title></head><body>${body}</body></html>`;
const pageUrl = 'https://harbor.example/terms';
function assertBounded(blocks: ReturnType<typeof textBlocks>) {
  assert.ok(blocks.length <= 24);
  assert.ok(blocks.every(block => block.text.length <= 8000));
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  catalogEntitySchema.parse({ id: 'terms', name: 'Terms', kind: 'page', summary: '', attributes: {}, blocks });
}
function transport(pages: Record<string, string>): WebsiteTransport {
  return { resolve: async () => [{ address: '93.184.216.34', family: 4 }], connect: async url => ({
    remoteAddress: '93.184.216.34', status: url.pathname === '/robots.txt' || pages[url.pathname] ? 200 : 404,
    contentType: url.pathname === '/robots.txt' ? 'text/plain' : 'text/html', bytes: Buffer.from(pages[url.pathname] ?? ''),
  }) };
}

for (const length of [7900, 8000, 8100, 12000]) {
  test(`HTML paragraph of ${length} characters retains exact text and its final qualification in the native catalog`, () => {
    const body = paragraph(length);
    const page = extractWebsitePage(markup(`<h1>Terms</h1><p>${body}</p>`), pageUrl);
    assert.equal(page.text, `# Terms\n${body}`);
    const blocks = websitePageCatalog([page]).entities[0].blocks!;
    assertBounded(blocks);
    assert.equal(blocks[0].kind, 'heading');
    assert.equal(blocks.slice(1).map(block => block.text).join(''), body);
    assert.ok(blocks.at(-1)!.text.endsWith(tail));
  });
}

for (const count of [23, 25, 40]) {
  test(`${count} HTML heading blocks preserve every section and newline when compacted to the schema bound`, () => {
    const headings = Array.from({ length: count }, (_, index) => `Section ${index + 1}: ${paragraph(700)}`);
    const page = extractWebsitePage(markup(headings.map(text => `<h2>${text}</h2>`).join('')), pageUrl);
    const blocks = websitePageCatalog([page]).entities[0].blocks!;
    assertBounded(blocks);
    // Normal headings retain their kind; compaction stores the complete joined text.
    assert.equal(blocks.map(block => block.text).join(count <= 24 ? '\n' : ''), headings.join('\n'));
    if (count <= 24) assert.ok(blocks.every(block => block.kind === 'heading'));
    assert.ok(blocks.at(-1)!.text.endsWith(tail));
  });
}

test('paragraph boundaries and Unicode characters survive chunk boundaries without duplication', () => {
  const first = `${'a'.repeat(7999)}🧭${tail}`;
  const second = 'The second paragraph retains its own line.';
  const blocks = textBlocks(`${first}\n${second}`);
  assertBounded(blocks);
  assert.equal(blocks.map(block => block.text).join(''), `${first}\n${second}`);
  assert.ok(blocks.every(block => block.text.isWellFormed()));
  assert.deepEqual(textBlocks('  \n\t'), []);
});

test('reading chunks prefer paragraph and word boundaries so an ordinary price stays together', () => {
  const source = `${'a'.repeat(7995)} $1000 is the maximum.\n${paragraph(8100)}`;
  const blocks = textBlocks(source);
  assertBounded(blocks);
  assert.equal(blocks.map(block => block.text).join(''), source);
  assert.ok(blocks.some(block => block.text.includes('$1000')));
  assert.ok(!blocks.some(block => /\$\d{1,3}$/.test(block.text)));
  assert.ok(blocks.some(block => block.text.endsWith('maximum.\n')), 'an existing paragraph boundary is preferred when it fits');
});

test('the true reading-block capacity is accepted exactly and exceeded capacity fails without a partial result', () => {
  const body = paragraph(24 * 8000);
  const blocks = textBlocks(body);
  assertBounded(blocks);
  assert.equal(blocks.length, 24);
  assert.equal(blocks.map(block => block.text).join(''), body);
  assert.throws(() => textBlocks(`${body}!`), /24 reading blocks.*no partial text was imported/);
});

test('preferred word boundaries cannot cause a false capacity failure around a later surrogate pair', () => {
  const body = `${'a'.repeat(7998)} ${'b'.repeat(7999)}🧭${'c'.repeat(175999)}`;
  assert.equal(body.length, 191999);
  const blocks = textBlocks(body);
  assertBounded(blocks);
  assert.equal(blocks.length, 24);
  assert.equal(blocks.map(block => block.text).join(''), body);
  assert.ok(blocks.every(block => block.text.isWellFormed()));
});

test('malformed HTML and encoded literal markup retain their extracted tail as inert reading text', () => {
  const page = extractWebsitePage(markup(`<p>${paragraph(12000)}<div>&lt;script&gt;literal()&lt;/script&gt;<p>Malformed final paragraph`), pageUrl);
  const blocks = websitePageCatalog([page]).entities[0].blocks!;
  assertBounded(blocks);
  assert.equal(blocks.map(block => block.text).join(''), page.text);
  assert.ok(blocks.some(block => block.text.includes('<script>literal()</script>')));
  assert.ok(blocks.at(-1)!.text.endsWith('Malformed final paragraph'));
});

test('selected-page imports retain large bodies up to their aggregate bound and report oversized pages explicitly', async () => {
  const first = paragraph(35000), second = `Second source: ${paragraph(24000)}`;
  const io = transport({ '/terms': markup(`<p>${first}</p>`), '/details': markup(`<p>${second}</p>`),
    '/extra': markup(`<p>${paragraph(2000)}</p>`), '/too-long': markup(`<p>${paragraph(60001)}</p>`),
    '/over-capacity': markup(`<p>${paragraph(192001)}</p>`) });
  const result = await importWebsitePages(pageUrl, ['terms', 'details', 'extra', 'too-long', 'over-capacity'].map(path => `https://harbor.example/${path}`), io);
  assert.deepEqual(result.report.map(page => page.status), ['imported', 'imported', 'skipped', 'failed', 'failed']);
  assert.match(result.report[3].message, /60,000-character/);
  assert.match(result.report[4].message, /24 reading blocks.*no partial text was imported/);
  assert.ok(result.text.length <= 60000);
  assert.equal(result.pages[0].text, first);
  assert.equal(result.pages[1].text, second);
  const catalog = websitePageCatalog(result.pages);
  assert.deepEqual(catalog.entities.map(entity => entity.blocks!.map(block => block.text).join('')), [first, second]);
  await assert.rejects(() => importWebsitePages(pageUrl, ['https://harbor.example/over-capacity'], io), /No pages could be imported.*no partial text was imported/);
});

test('the catalog fallback for saved captures also retains all long source text', () => {
  const page = extractWebsitePage(markup(`<p>${paragraph(12000)}</p>`), pageUrl);
  delete page.blocks;
  const blocks = websitePageCatalog([page]).entities[0].blocks!;
  assertBounded(blocks);
  assert.equal(blocks.map(block => block.text).join(''), page.text);
});
