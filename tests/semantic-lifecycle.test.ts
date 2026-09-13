import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { WebsiteTransport } from '../lib/website-fetch';
import type { Site } from '../lib/site-model';
import { semanticFixture } from '../fixtures/semantic-knowledge/graph';

test('publication-scoped retrieval, identity photo/opening remaps and Undo use the real offline stores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'semantic-lifecycle-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite, uploadFile, modifySite } = await import('../lib/site-store');
    const { analyzeKnowledge, applyKnowledge, reviewDraftKnowledge, resolveKnowledgeIdentityReview, reviseKnowledge } = await import('../lib/ingestion');
    const { saveMediaLibrary, readMediaLibrary } = await import('../lib/media-store');
    const { retrievePublishedKnowledge } = await import('../lib/knowledge-retrieval');
    const { getPublishedKnowledge, readKnowledgeArtifact } = await import('../lib/knowledge-store');
    const { updateDraft } = await import('../lib/local-store');
    const { applyCommand } = await import('../lib/site-commands');
    const { POST } = await import('../app/api/sites/[siteId]/route');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site: Site = await getSite(user, (await listSites(user))[0].id);
    const upload = async (name: string, text: string) => {
      const id = randomUUID(); await uploadFile(user, site.id, site.revision, { id, name, mime: 'text/csv', size: Buffer.byteLength(text), kind: 'text', uploadedAt: new Date().toISOString(), text, data: Buffer.from(text).toString('base64') }); site = await getSite(user, site.id); return id;
    };
    const firstFile = await upload('address.csv', 'Name,Kind,Address\nHarbor Studio,business,12 Example Lane');
    let state = await analyzeKnowledge(user, site.id, { fileId: firstFile, requestId: randomUUID(), revision: site.revision });
    let candidate = state.candidates[0];
    const canonical = candidate.catalog.entities[0].id;
    await assert.rejects(() => retrievePublishedKnowledge(site.id, { revisionId: candidate.catalog.id, query: 'address' }), /published/);
    site = (await applyKnowledge(user, site.id, { candidateId: candidate.id, revision: site.revision })).site;
    const secondFile = await upload('contact.csv', 'Name,Kind,Email\nHarbor Studio,business,hello@harbor.example');
    state = await analyzeKnowledge(user, site.id, { fileId: secondFile, requestId: randomUUID(), revision: site.revision }); candidate = state.candidates[0];
    const incoming = candidate.catalog.entities.find(entity => entity.id !== canonical)!.id;
    assert.equal(candidate.identityMatches?.[0].status, 'review');
    site = (await applyKnowledge(user, site.id, { candidateId: candidate.id, revision: site.revision })).site;
    const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#246' } }).png().toBuffer();
    const photoId = randomUUID();
    await uploadFile(user, site.id, site.revision, { id: photoId, name: 'fixture.png', mime: 'image/png', kind: 'image', size: image.length, uploadedAt: new Date().toISOString(), data: image.toString('base64') }); site = await getSite(user, site.id);
    await saveMediaLibrary(user, site.id, site.revision, { schemaVersion: 1, id: randomUUID(), assets: [{ id: photoId, width: 12, height: 12, caption: 'Reviewed location photo', alt: 'Synthetic square' }], albums: [], associations: [{ id: 'photo-link', targetType: 'entity', targetId: incoming, assetId: photoId, role: 'depicts', primary: true }] }); site = await getSite(user, site.id);
    await modifySite(user, site.id, site.revision, current => updateDraft(current, { ...current.draft, greetingPoints: [{ kind: 'entity', id: incoming }, null, null], opening: { tone: 'warm', highlights: [], featuredEntityIds: [incoming], capabilityIds: [] } })); site = await getSite(user, site.id);
    const beforeMerge = structuredClone(site.draft);
    state = await reviewDraftKnowledge(user, site.id, { revision: site.revision, requestId: randomUUID() }); candidate = state.candidates[0];
    state = await resolveKnowledgeIdentityReview(user, site.id, { candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision, decisions: [{ id: candidate.identityMatches![0].id, action: 'approve' }] }); candidate = state.candidates[0];
    site = (await applyKnowledge(user, site.id, { candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision })).site;
    assert.deepEqual(site.draft.opening?.featuredEntityIds, [canonical]);
    assert.deepEqual(site.draft.greetingPoints, [{ kind: 'entity', id: canonical }, null, null]);
    assert.equal((await readMediaLibrary(user, site.id, site.draft.mediaRevisionId!)).associations[0].targetId, canonical);
    const publish = await POST(new Request(`http://127.0.0.1:3220/api/sites/${site.id}`, { method: 'POST', headers: { origin: 'http://127.0.0.1:3220', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', revision: site.revision }) }), { params: Promise.resolve({ siteId: site.id }) });
    assert.equal(publish.status, 200, await publish.clone().text()); site = await getSite(user, site.id);
    const result = await retrievePublishedKnowledge(site.id, { revisionId: site.published!.knowledgeRevisionId!, query: 'email', entityIds: [canonical] }, site.published!.mediaRevisionId);
    assert.equal(result.values.find(value => value.field === 'attributes.email')?.value, 'hello@harbor.example');
    assert.equal(result.media?.associations[0].targetId, canonical);
    for (const privateKey of ['origins', 'anchorIds', 'sourceKey', 'correctionHistory', 'identityRemaps', 'valueHash']) assert.ok(!JSON.stringify(result).includes(privateKey), privateKey);
    await modifySite(user, site.id, site.revision, current => applyCommand(current, { action: 'undo', revision: current.revision })); site = await getSite(user, site.id);
    assert.deepEqual(site.draft, beforeMerge, 'one Undo reverses catalog, remaps, media and opening together');
    assert.equal((await getPublishedKnowledge(site.id, site.published!.knowledgeRevisionId!))!.entities.length, 1, 'Undo is draft-only');
    state = await reviewDraftKnowledge(user, site.id, { revision: site.revision, requestId: randomUUID() }); candidate = state.candidates[0];
    const corrected = structuredClone(candidate.catalog); corrected.entities[0].attributes.address = '14 Example Lane';
    state = await reviseKnowledge(user, site.id, { candidateId: candidate.id, revision: site.revision, catalog: corrected }); candidate = state.candidates[0];
    assert.ok(candidate.correctionHistory?.some(entry => entry.action === 'publisher-corrected' && entry.anchorIds?.length));
    const privateArtifact = await readKnowledgeArtifact(user, site.id, candidate.catalog.id);
    assert.ok(privateArtifact.assertionReviews?.some(review => review.targetId === `${canonical}/attributes.address` && review.support === 'publisher'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('HTML URL import reserves once, uses a bounded mock transport, rechecks replacement and preserves provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'semantic-website-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite } = await import('../lib/site-store');
    const { analyzeKnowledgeUrl, applyKnowledge } = await import('../lib/ingestion');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site: Site = await getSite(user, (await listSites(user))[0].id); let calls = 0; let html = '<p>Name: Harbor Studio</p><p>Kind: business</p><p>Email: hello@harbor.example</p>';
    const io: WebsiteTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], connect: async () => { calls++; return { status: 200, contentType: 'text/html', remoteAddress: '93.184.216.34', bytes: Buffer.from(html) }; } };
    const input = { revision: site.revision, requestId: randomUUID(), url: 'https://example.com/about' };
    const state = await analyzeKnowledgeUrl(user, site.id, input, io); const candidate = state.candidates[0];
    assert.ok(candidate, JSON.stringify(state.jobs));
    assert.ok(candidate.origins?.[0].provenance?.anchors.every(anchor => anchor.format === 'html'));
    await assert.rejects(() => analyzeKnowledgeUrl(user, site.id, input, io), /already received/);
    assert.equal(calls, 1, 'replayed requests cannot even fetch a website twice');
    html = '<p>Changed content</p>';
    await assert.rejects(() => applyKnowledge(user, site.id, { candidateId: candidate.id, revision: site.revision }, io), /webpage changed/);
    site = await getSite(user, site.id); assert.equal(site.draft.knowledgeRevisionId, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('authorized as-of retrieval reads historical relationships before the legacy current-time projection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'semantic-history-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  try {
    const { listSites, getSite, modifySite } = await import('../lib/site-store');
    const { updateDraft } = await import('../lib/local-store');
    const { writeKnowledgeArtifact, getPublishedKnowledge } = await import('../lib/knowledge-store');
    const { retrievePublishedKnowledge } = await import('../lib/knowledge-retrieval');
    const { POST } = await import('../app/api/sites/[siteId]/route');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site: Site = await getSite(user, (await listSites(user))[0].id);
    const id = randomUUID(); const catalog = { ...structuredClone(semanticFixture), id };
    catalog.relationships.find(relation => relation.id === 'affiliation')!.validTo = '2020-12-31';
    await writeKnowledgeArtifact(user, site.id, { schemaVersion: 1, id, catalog, origins: [], notes: ['Synthetic publisher-reviewed legacy snapshot.'] });
    await modifySite(user, site.id, site.revision, current => updateDraft(current, { ...current.draft, knowledgeRevisionId: id })); site = await getSite(user, site.id);
    const response = await POST(new Request(`http://127.0.0.1:3220/api/sites/${site.id}`, { method: 'POST', headers: { origin: 'http://127.0.0.1:3220', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', revision: site.revision }) }), { params: Promise.resolve({ siteId: site.id }) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.ok(!(await getPublishedKnowledge(site.id, id))!.relationships.some(relation => relation.id === 'affiliation'));
    const result = await retrievePublishedKnowledge(site.id, { revisionId: id, asOf: '2020-06-01', entityIds: ['mira', 'harbor'], expansion: 0 });
    assert.ok(result.relationships.some(relation => relation.id === 'affiliation'));
    assert.equal(result.asOf, '2020-06-01');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
