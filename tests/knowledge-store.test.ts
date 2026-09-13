import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { textPdf } from './knowledge-fixtures';

test('local lifecycle: review correction, immutable Apply, publication, private deletion, Undo and reimport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-knowledge-test-'));
  process.env.VOICE_DATA_DIR = directory;
  process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite, uploadFile, modifySite } = await import('../lib/site-store');
    const { applyCommand } = await import('../lib/site-commands');
    const { analyzeKnowledge, reviewDraftKnowledge, reviseKnowledge, applyKnowledge, correctKnowledge, removeKnowledge, getKnowledgeState, parseSemanticReply } = await import('../lib/ingestion');
    const { getPublishedKnowledge, getKnowledgeCatalogForSite, readKnowledgeArtifact, changeKnowledgeLedger, applyLocalKnowledgeClaim } = await import('../lib/knowledge-store');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const id = (await listSites(user))[0].id;
    const add = async (text: string, name = 'catalog.csv') => {
      const file = { id: randomUUID(), name, mime: 'text/csv', size: Buffer.byteLength(text), kind: 'text' as const, uploadedAt: new Date().toISOString(), data: Buffer.from(text).toString('base64'), text };
      const site = await getSite(user, id); const updated = await uploadFile(user, id, site.revision, file);
      return { file, site: updated };
    };
    const first = await add('ID,Name,Price [USD]\none,One,10\ntwo,Two,20');
    const review = await analyzeKnowledge(user, id, { fileId: first.file.id, revision: first.site.revision, requestId: randomUUID() });
    assert.equal(review.candidates.length, 1); assert.equal(review.catalog, null);
    const corrected = await correctKnowledge(user, id, { candidateId: review.candidates[0].id, revision: first.site.revision, requestId: randomUUID(), text: 'Set Price [USD] for One to 12' });
    assert.equal(corrected.candidates[0].catalog.entities[0].attributes['price-usd'], 12);
    await assert.rejects(() => getPublishedKnowledge(id, corrected.candidates[0].catalog.id), /published knowledge revision/);
    const applied = await applyKnowledge(user, id, { candidateId: corrected.candidates[0].id, revision: first.site.revision });
    assert.equal(applied.site.published, null);
    assert.equal(applied.catalog?.entities[0].attributes['price-usd'], 12);
    const revisionId = applied.site.draft.knowledgeRevisionId!;
    await changeKnowledgeLedger(user, id, ledger => {
      const job = ledger.jobs[0]; job.status = 'running'; job.stage = 'review'; job.updatedAt = Date.now() - 130_000;
    });
    assert.equal((await getKnowledgeState(user, id)).jobs[0].status, 'applied', 'a completed site write repairs interrupted job status');
    const otherId = (await listSites(user)).find(site => site.id !== id)!.id;
    await assert.rejects(() => readKnowledgeArtifact(user, otherId, revisionId), /could not be validated/);
    const published = await modifySite(user, id, applied.site.revision, site => applyCommand(site, { action: 'publish', revision: site.revision }));
    assert.equal((await getPublishedKnowledge(id, revisionId))?.entities[0].name, 'One');
    const deleted = await modifySite(user, id, published.revision, site => applyCommand(site, { action: 'remove-file', revision: site.revision, fileId: first.file.id }));
    assert.equal(deleted.files.length, 0);
    assert.equal((await getPublishedKnowledge(id, revisionId))?.entities.length, 2);
    const rereview = await reviewDraftKnowledge(user, id, { revision: deleted.revision, requestId: randomUUID() });
    const renamed = await correctKnowledge(user, id, { candidateId: rereview.candidates[0].id, revision: deleted.revision, requestId: randomUUID(), text: 'Rename "One" to "Reviewed One"' });
    const reapplied = await applyKnowledge(user, id, { candidateId: renamed.candidates[0].id, revision: deleted.revision });
    assert.equal(reapplied.catalog?.entities[0].name, 'Reviewed One');
    assert.equal((await getPublishedKnowledge(id, revisionId))?.entities[0].name, 'One', 'reviewing a draft without originals leaves publication unchanged');
    const withOpening = await modifySite(user, id, reapplied.site.revision, site => {
      site.draft.catalogPublicationId = 'f45568f4-d389-48e7-99bd-fd6f9ec53054';
      site.draft.opening = { highlights: ['Welcome'], featuredEntityIds: [reapplied.catalog!.entities[0].id], capabilityIds: [], tone: 'warm' };
    });
    const removed = await removeKnowledge(user, id, withOpening.revision);
    assert.equal(removed.site.draft.catalogPublicationId, undefined);
    assert.deepEqual(removed.site.draft.opening?.featuredEntityIds, []);
    assert.deepEqual(removed.site.draft.opening?.highlights, ['Welcome']);
    assert.equal(await getKnowledgeCatalogForSite(user, id), null);
    assert.equal((await getPublishedKnowledge(id, revisionId))?.entities.length, 2);
    await modifySite(user, id, removed.site.revision, site => applyCommand(site, { action: 'undo', revision: site.revision }));
    assert.equal((await getKnowledgeCatalogForSite(user, id))?.entities[0].attributes['price-usd'], 12);
    assert.equal((await getSite(user, id)).draft.opening?.featuredEntityIds.length, 1);
    const newer = await add('ID,Name,Price [USD]\none,One,15\ntwo,Two,25');
    const update = await analyzeKnowledge(user, id, { fileId: newer.file.id, revision: newer.site.revision, requestId: randomUUID() });
    assert.equal(update.candidates[0].catalog.entities[0].attributes['price-usd'], 12);
    assert.equal(update.candidates[0].catalog.entities[1].attributes['price-usd'], 25);
    assert.equal((await readKnowledgeArtifact(user, id, revisionId)).catalog.entities[1].attributes['price-usd'], 20);
    const stale = structuredClone(update.candidates[0].catalog);
    await reviseKnowledge(user, id, { candidateId: update.candidates[0].id, revision: newer.site.revision, catalog: stale });
    await assert.rejects(() => reviseKnowledge(user, id, { candidateId: update.candidates[0].id, revision: newer.site.revision, catalog: stale }), /interpretation changed/);
    const oldClaim = await changeKnowledgeLedger(user, id, ledger => {
      const job = ledger.jobs.find(job => job.id === update.candidates[0].id)!;
      job.status = 'running'; job.stage = 'review'; job.updatedAt = Date.now() - 130_000;
      return job.claim;
    });
    assert.equal((await getKnowledgeState(user, id)).jobs.at(-1)?.status, 'needs_review');
    let lateWrite = false;
    await assert.rejects(() => applyLocalKnowledgeClaim(user, id, update.candidates[0].id, oldClaim, async () => { lateWrite = true; }), /superseded/);
    assert.equal(lateWrite, false);
    assert.throws(() => parseSemanticReply({ complete: false, issues: ['Too many records.'], name: 'Partial', description: '', attributes: [], entities: [], collections: [], relationships: [], jobs: [] }), /incomplete/);
    await modifySite(user, id, newer.site.revision, site => { site.draft.headline = 'Concurrent publisher edit'; });
    await assert.rejects(() => applyKnowledge(user, id, { candidateId: update.candidates[0].id, revision: newer.site.revision }), /site changed/);
    const { readPlatformEventSummary } = await import('../lib/platform-events');
    const activity = await readPlatformEventSummary(id);
    assert.ok(activity.events.some(event => event.type === 'interpretation' && event.status === 'ready'));
    assert.ok(activity.events.some(event => event.type === 'correction' && event.status === 'succeeded'));
    assert.ok(activity.events.some(event => event.type === 'approval' && event.status === 'succeeded'));
    assert.ok(activity.events.every(event => !('text' in event) && !('prompt' in event) && !('catalog' in event)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('owner routes accept a real PDF over 2 MB and return a validated review candidate offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-knowledge-route-test-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite } = await import('../lib/site-store');
    const { POST: upload } = await import('../app/api/sites/[siteId]/files/route');
    const { POST: knowledge } = await import('../app/api/sites/[siteId]/knowledge/route');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const id = (await listSites(user))[0].id; const site = await getSite(user, id);
    const origin = 'http://127.0.0.1:3220';
    const bytes = textPdf([['Name: Route item', 'Kind: offering', 'Price [USD]: 19']], 3 * 1024 * 1024);
    assert.ok(bytes.length > 2 * 1024 * 1024 && bytes.length < 10 * 1024 * 1024);
    const result = await upload(new Request(`${origin}/api/sites/${id}/files`, { method: 'POST', headers: { origin, 'content-type': 'application/pdf', 'x-site-revision': String(site.revision), 'x-file-name': 'route-item.pdf' }, body: bytes }), { params: Promise.resolve({ siteId: id }) });
    assert.equal(result.status, 200); const uploaded = await result.json();
    const interpretation = await knowledge(new Request(`${origin}/api/sites/${id}/knowledge`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'analyze', revision: uploaded.site.revision, fileId: uploaded.site.files.at(-1).id, requestId: randomUUID() }) }), { params: Promise.resolve({ siteId: id }) });
    assert.equal(interpretation.status, 200);
    const state = await interpretation.json();
    assert.equal(state.candidates[0].catalog.entities[0].name, 'Route item');
    assert.equal(state.candidates[0].catalog.entities[0].attributes['price-usd'], 19);
    assert.equal((await getSite(user, id)).draft.knowledgeRevisionId, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
