import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initialSite, readDatabaseSnapshot, withDatabase } from '../lib/local-store';
import { getPublished } from '../lib/site-store';
import { visitorAccess } from '../lib/visitor-store';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { CatalogRepository } from '../lib/catalog-repository';
import { taskFixture } from '../fixtures/visitor-tasks';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-publication-preparation-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  t.after(async () => { process.env = previous; await rm(directory, { recursive: true, force: true }); });
  return { directory, path: join(directory, 'workspace.json') };
}

async function publishedFixture() {
  const site = initialSite('general', 'Synthetic publisher', 'synthetic-publisher');
  site.published = structuredClone(site.draft); site.publishedAt = new Date().toISOString();
  await withDatabase(db => { db.sites = [site]; });
  return site;
}

test('read-only initialization persists stable default identities but no callback mutations', async t => {
  const { path } = await fixture(t);
  const ids = await readDatabaseSnapshot(db => {
    const ids = db.sites.map(site => site.id);
    db.sites[0].draft.name = 'A read must not persist this'; db.sites.pop();
    return ids;
  });
  assert.equal(ids.length, 2);
  const original = await stat(path);
  const saved = await readDatabaseSnapshot(db => db);
  assert.deepEqual(saved.sites.map(site => site.id), ids);
  assert.notEqual(saved.sites[0].draft.name, 'A read must not persist this');
  assert.equal((await stat(path)).ino, original.ino, 'later reads cannot atomically rewrite the workspace');
});

test('publication and availability reads reload fresh data without writing or leaking mutations', async t => {
  const { path } = await fixture(t), site = await publishedFixture(), original = await stat(path), text = await readFile(path, 'utf8');
  const first = await getPublished(site.slug);
  assert.ok(first); first.content.headline = 'Only in this returned object';
  await readDatabaseSnapshot(db => { db.sites[0].published!.description = 'Only in this read'; });
  assert.deepEqual((await getPublished(site.slug))?.content, site.published);
  await visitorAccess(site.slug);
  assert.equal(await readFile(path, 'utf8'), text);
  const after = await stat(path);
  assert.equal(after.ino, original.ino); assert.equal(after.mtimeMs, original.mtimeMs);
  const updated = JSON.parse(text); updated.sites[0].published.headline = 'Published externally';
  await writeFile(path, JSON.stringify(updated));
  assert.equal((await getPublished(site.slug))?.content.headline, 'Published externally', 'no cross-call snapshot cache');
});

test('queued publication writes precede fresh reads and invalidate prepared record authority', async t => {
  await fixture(t); const site = await publishedFixture(), context = await visitorTaskContext(site.slug);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const update = withDatabase(async db => { entered.resolve(); await release.promise; db.sites[0].published!.headline = 'New published headline'; });
  await entered.promise;
  let settled = false;
  const staleRecords = context.records([]).finally(() => { settled = true; });
  const rejected = assert.rejects(staleRecords, /Publication changed/);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
  release.resolve(); await update; await rejected;
  assert.equal((await getPublished(site.slug))?.content.headline, 'New published headline');
  await withDatabase(db => { db.sites[0].published = null; });
  assert.equal(await getPublished(site.slug), null);
  await assert.rejects(context.records([]), /Publication changed/);
});

test('failed reads preserve the queue, never repair corrupt data, and do not block a following write', async t => {
  const { path } = await fixture(t); const site = await publishedFixture();
  await assert.rejects(readDatabaseSnapshot(db => { db.sites = []; throw new Error('Synthetic read failure'); }), /Synthetic read failure/);
  assert.equal((await getPublished(site.slug))?.siteId, site.id);
  const saved = await readFile(path, 'utf8'); await writeFile(path, '{broken');
  await assert.rejects(getPublished(site.slug), SyntaxError);
  assert.equal(await readFile(path, 'utf8'), '{broken');
  await writeFile(path, saved);
  await withDatabase(db => { db.sites[0].published!.headline = 'After failure'; });
  assert.equal((await getPublished(site.slug))?.content.headline, 'After failure');
});

test('attempt reservations remain serialized writes with unchanged duplicate protection', async t => {
  const { path } = await fixture(t); const site = await publishedFixture(), initial = await visitorAccess(site.slug);
  const firstId = randomUUID(), secondId = randomUUID();
  const first = await visitorAccess(site.slug, { requestId: firstId, kind: 'chat' });
  assert.equal(first.availability.chatRemaining, initial.availability.chatRemaining - 1);
  const results = await Promise.allSettled([
    visitorAccess(site.slug, { requestId: secondId, kind: 'chat' }),
    visitorAccess(site.slug, { requestId: secondId, kind: 'chat' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(String((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /already received/);
  assert.equal((await visitorAccess(site.slug)).availability.chatRemaining, initial.availability.chatRemaining - 2);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.visitorUsage.sites[site.id].chat, 2);
});

for (const kind of ['catalog', 'knowledge'] as const) for (const mode of ['unchanged', 'republished', 'invalid-media'] as const) test(`cold task preparation overlaps independent media/${kind} I/O and handles ${mode}`, async t => {
  const { directory, path } = await fixture(t), site = await publishedFixture(), mediaId = randomUUID();
  let indexPath: string, revision: { catalogPublicationId: string } | { knowledgeRevisionId: string }, expectedRecord: { id: string; name: string };
  if (kind === 'catalog') {
    const space = taskFixture(); space.publication.siteId = site.id;
    const manifest = await new CatalogRepository().stage(site.id, space);
    indexPath = join(directory, 'catalogPublications', `${manifest.id}.json`); revision = { catalogPublicationId: manifest.id }; expectedRecord = space.records[0];
  } else {
    const catalog = JSON.parse(await readFile(new URL('../fixtures/catalogs/classes.json', import.meta.url), 'utf8')); catalog.id = randomUUID();
    await mkdir(join(directory, 'knowledge-public'));
    indexPath = join(directory, 'knowledge-public', `${site.id}-${catalog.id}.json`);
    await writeFile(indexPath, JSON.stringify(catalog)); revision = { knowledgeRevisionId: catalog.id }; expectedRecord = catalog.entities[0];
  }
  const media = { schemaVersion: 1, id: mediaId, assets: [], albums: [], associations: [] };
  await mkdir(join(directory, 'media-public'));
  const mediaPath = join(directory, 'media-public', `${site.id}-${mediaId}.json`);
  await writeFile(mediaPath, JSON.stringify(mode === 'invalid-media' ? { ...media, id: randomUUID() } : media));
  await withDatabase(db => { db.sites[0].published = { ...site.published!, ...revision, mediaRevisionId: mediaId }; });
  const originalWorkspace = await stat(path);
  const mediaStarted = Promise.withResolvers<void>(), indexStarted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const originalRead = fs.readFile;
  const mockedRead = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]) === mediaPath) { mediaStarted.resolve(); await release.promise; }
    if (String(args[0]) === indexPath) { indexStarted.resolve(); await release.promise; }
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  const preparing = visitorTaskContext(site.slug);
  const outcome = mode === 'republished' ? assert.rejects(preparing, /Publication changed/)
    : mode === 'invalid-media' ? assert.rejects(preparing, /media identity/) : undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.all([mediaStarted.promise, indexStarted.promise]), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Independent cold inputs were serialized')), 2000); })]);
    if (mode === 'republished') await withDatabase(db => { db.sites[0].published!.headline = 'Changed during preparation'; });
    release.resolve();
    if (outcome) await outcome;
    else {
      const context = await preparing;
      assert.ok(context.index.records.has(expectedRecord.id));
      assert.equal(context.site.content.mediaRevisionId, mediaId);
      assert.equal((await context.records([expectedRecord.id]))[0].name, expectedRecord.name);
      assert.equal((await stat(path)).ino, originalWorkspace.ino, 'publication, knowledge and media authority reads must not rewrite the workspace');
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    release.resolve(); await preparing.catch(() => undefined);
    mockedRead.mock.restore(); syncBuiltinESMExports();
  }
});
