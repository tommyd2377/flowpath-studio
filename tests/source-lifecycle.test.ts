import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { mergeKnowledge, type KnowledgeArtifact } from '../lib/knowledge-model';
import { removeSourceContribution } from '../lib/source-lifecycle';
import { textPdf } from './knowledge-fixtures';

function catalog(): KnowledgeCatalog { return { schemaVersion: 1, id: randomUUID(), name: 'Synthetic information', description: '', attributes: [{ id: 'price', label: 'Price', type: 'number' }, { id: 'notice', label: 'Notice', type: 'text' }], entities: [
  { id: 'stable', name: 'Shared offering', kind: 'service', summary: 'Supported description', attributes: { price: 20, notice: '48 hours' } },
], collections: [{ id: 'offers', name: 'Offerings', entityIds: ['stable'] }], facts: [{ id: 'price', entityId: 'stable', field: 'attributes.price', value: 20 }], relationships: [], jobs: [], capabilities: [] }; }

test('source withdrawal retains other field support, publisher corrections, identity and tombstones', () => {
  const first = catalog(), second = structuredClone(first); second.entities[0].attributes = { price: 20 }; second.entities[0].summary = '';
  const artifact: KnowledgeArtifact = { schemaVersion: 1, id: first.id, catalog: structuredClone(first), notes: [], origins: [
    { key: 'one.csv', name: 'one.csv', hash: 'one', fileId: randomUUID(), entityIds: ['stable'], baseline: first },
    { key: 'two.csv', name: 'two.csv', hash: 'two', fileId: randomUUID(), entityIds: ['stable'], baseline: second },
  ] };
  artifact.catalog.entities[0].name = 'Publisher corrected name';
  const removed = removeSourceContribution(artifact, 'one.csv');
  assert.equal(removed.catalog.entities[0].id, 'stable'); assert.equal(removed.catalog.entities[0].name, 'Publisher corrected name');
  assert.equal(removed.catalog.entities[0].attributes.price, 20); assert.equal(removed.catalog.entities[0].attributes.notice, null); assert.equal(removed.catalog.entities[0].summary, '');
  assert.equal(removed.catalog.facts?.length, 1); assert.equal(removed.origins[0].retired, true);
  const final = removeSourceContribution(removed, 'two.csv');
  assert.equal(final.catalog.entities[0].name, 'Publisher corrected name'); assert.equal(final.catalog.entities[0].attributes.price, null); assert.equal(final.catalog.facts?.length, 0);
  assert.deepEqual(artifact.catalog.entities[0].attributes, { price: 20, notice: '48 hours' });
});

test('last-source withdrawal yields an empty valid revision and changed reimports do not resurrect items', () => {
  const original = catalog(), source = { name: 'menu.csv', hash: 'one', fileId: randomUUID() };
  const artifact = mergeKnowledge(null, original, source);
  const removed = removeSourceContribution(artifact, 'menu.csv');
  assert.equal(removed.catalog.entities.length, 0); assert.equal(removed.catalog.collections.length, 0);
  const renumbered = structuredClone(artifact); renumbered.catalog.facts![0].id = 'canonical-fact';
  assert.equal(removeSourceContribution(renumbered, 'menu.csv').catalog.entities.length, 0, 'A remapped fact ID alone is not a publisher correction.');
  original.entities[0].summary = 'Changed after withdrawal';
  const later = mergeKnowledge(removed, original, { ...source, hash: 'two' });
  assert.equal(later.catalog.entities.length, 0); assert.equal(later.updates?.[0].kind, 'removed_by_publisher');
});

test('real corroborated source merges retain shared support after either source is withdrawn', () => {
  const first = catalog(); first.entities[0].identifiers = [{ scheme: 'publisher-id', value: 'example.org:shared-001' }];
  const original = mergeKnowledge(null, first, { name: 'first.csv', hash: 'first', fileId: randomUUID() });
  const together = mergeKnowledge(original, first, { name: 'second.csv', hash: 'second', fileId: randomUUID() });
  assert.equal(together.catalog.entities.length, 1);
  assert.equal(together.catalog.entities[0].id, original.catalog.entities[0].id);
  for (const source of ['first.csv', 'second.csv']) {
    const result = removeSourceContribution(together, source);
    assert.equal(result.catalog.entities.length, 1); assert.equal(result.catalog.entities[0].attributes.price, 20);
    assert.ok(result.catalog.facts?.some(fact => fact.value === 20));
  }
});

test('related PDF batch: explicit partial review, corrections, removal, reimport and publication isolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-template-sources-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  const network = mock.method(globalThis, 'fetch', async () => { throw new Error('No network in this test.'); });
  try {
    const { listSites, getSite, uploadFile, modifySite } = await import('../lib/site-store');
    const { analyzeKnowledgeFiles, applyKnowledge, reviseKnowledge, reviewSourceRemoval, analyzeKnowledge } = await import('../lib/ingestion');
    const { applyCommand } = await import('../lib/site-commands');
    const { readKnowledgeArtifact } = await import('../lib/knowledge-store');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await getSite(user, (await listSites(user))[0].id);
    const upload = async (name: string, bytes: Uint8Array, pdf = true) => { const id = randomUUID(); await uploadFile(user, site.id, site.revision, { id, name, mime: pdf ? 'application/pdf' : 'text/plain', kind: pdf ? 'pdf' : 'text', size: bytes.length, uploadedAt: new Date().toISOString(), data: Buffer.from(bytes).toString('base64') }); site = await getSite(user, site.id); return id; };
    const menuBytes = textPdf([['Name: Shared lunch', 'Kind: offering', 'Price: from 18 per person', 'Notice: minimum 6 people; 48 hours notice']]);
    const one = await upload('menu.pdf', menuBytes);
    const same = await upload('menu-copy.pdf', menuBytes);
    const two = await upload('practical.pdf', textPdf([['Name: Dietary requests', 'Kind: policy', 'Summary: Please discuss requirements before confirming.']]));
    const failed = await upload('unsupported.txt', Buffer.from('Unstructured prose awaiting a connected interpreter.'), false);
    const ambiguous = await upload('MENU.PDF', textPdf([['Name: Another menu', 'Kind: offering', 'Summary: Unrelated content with the same source name.']]));
    await assert.rejects(() => analyzeKnowledgeFiles(user, site.id, { revision: site.revision, requestId: randomUUID(), sources: [one, ambiguous].map(fileId => ({ fileId })) }), /same source/);
    let state = await analyzeKnowledgeFiles(user, site.id, { revision: site.revision, requestId: randomUUID(), sources: [one, two, same, failed].map(fileId => ({ fileId })) });
    let candidate = state.candidates.at(-1)!;
    assert.deepEqual(candidate.files?.map(file => file.status), ['ready', 'ready', 'unchanged', 'failed']);
    assert.equal(candidate.catalog.entities.length, 2); assert.ok(!site.draft.knowledgeRevisionId);
    await assert.rejects(() => applyKnowledge(user, site.id, { revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id }), /incomplete file report/);
    const edited = structuredClone(candidate.catalog); edited.entities[0].name = 'Publisher lunch';
    state = await reviseKnowledge(user, site.id, { revision: site.revision, candidateId: candidate.id, catalog: edited }); candidate = state.candidates.at(-1)!;
    const applied = await applyKnowledge(user, site.id, { revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, acceptPartial: true }); site = applied.site;
    assert.equal(site.published, null);
    await modifySite(user, site.id, site.revision, stored => applyCommand(stored, { action: 'publish', revision: site.revision })); site = await getSite(user, site.id);
    const publication = structuredClone(site.published);
    state = await reviewSourceRemoval(user, site.id, { revision: site.revision, requestId: randomUUID(), sourceKey: 'menu.pdf' }); candidate = state.candidates.at(-1)!;
    assert.equal(candidate.catalog.entities.find(entity => entity.name === 'Publisher lunch')?.attributes.price, null);
    site = (await applyKnowledge(user, site.id, { revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id })).site;
    assert.deepEqual(site.published, publication); assert.ok(site.files.some(file => file.id === one));
    const replay = await analyzeKnowledge(user, site.id, { revision: site.revision, requestId: randomUUID(), fileId: one });
    assert.equal(replay.jobs.at(-1)?.status, 'discarded');
    const draft = await readKnowledgeArtifact(user, site.id, site.draft.knowledgeRevisionId!);
    assert.equal(draft.origins.find(origin => origin.key === 'menu.pdf')?.retired, true);
    assert.equal(network.mock.callCount(), 0);
  } finally { network.mock.restore(); await rm(directory, { recursive: true, force: true }); }
});
