import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

test('source choices cannot reinterpret old amounts under a corrected currency; identity collisions fail before reserving work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-source-boundaries-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  const network = mock.method(globalThis, 'fetch', async () => { throw new Error('Network is forbidden.'); });
  try {
    const { listSites, getSite, uploadFile } = await import('../lib/site-store');
    const { analyzeKnowledge, reviseKnowledge, applyKnowledge, resolveKnowledge } = await import('../lib/ingestion');
    const { readKnowledgeLedger } = await import('../lib/knowledge-store');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const siteId = (await listSites(user))[0].id;
    const upload = async (name: string, text: string) => {
      const site = await getSite(user, siteId);
      const file = { id: randomUUID(), name, mime: 'text/csv', kind: 'text' as const, size: Buffer.byteLength(text), uploadedAt: new Date().toISOString(), text, data: Buffer.from(text).toString('base64') };
      return { file, site: await uploadFile(user, siteId, site.revision, file) };
    };
    for (const [name, text] of [['first.csv', 'ID,Name,Price [USD]\na,Alpha,10'], ['second.csv', 'ID,Name,Price [USD]\nb,Beta,20']]) {
      const { file, site } = await upload(name, text);
      const state = await analyzeKnowledge(user, siteId, { fileId: file.id, revision: site.revision, requestId: randomUUID() });
      await applyKnowledge(user, siteId, { candidateId: state.candidates[0].id, revision: site.revision });
    }
    const updated = await upload('first.csv', 'ID,Name,Price [USD]\na,Alpha,15');
    const state = await analyzeKnowledge(user, siteId, { fileId: updated.file.id, revision: updated.site.revision, requestId: randomUUID() });
    const candidate = state.candidates[0]; const change = candidate.updates![0];
    const corrected = structuredClone(candidate.catalog); corrected.attributes[0].currency = 'EUR';
    const revised = await reviseKnowledge(user, siteId, { candidateId: candidate.id, revision: updated.site.revision, catalog: corrected });
    assert.ok(!revised.candidates[0].updates!.some(update => update.id === change.id), 'old USD choices must not become EUR choices');
    await assert.rejects(() => resolveKnowledge(user, siteId, { candidateId: candidate.id, candidateRevisionId: revised.candidates[0].catalog.id, revision: updated.site.revision, decisions: [{ id: change.id, choice: 'keep' }] }), /no longer available/);
    const collision = await upload('second.csv', 'ID,Name,Price [USD]\na,Alpha,30');
    const jobsBefore = await readKnowledgeLedger(user, siteId);
    await assert.rejects(() => analyzeKnowledge(user, siteId, { fileId: collision.file.id, revision: collision.site.revision, requestId: randomUUID(), replacesSourceKey: 'first.csv' }), /already uses this filename/);
    assert.deepEqual(await readKnowledgeLedger(user, siteId), jobsBefore, 'identity rejection happens before an import or paid reservation');
    assert.equal(network.mock.callCount(), 0);
  } finally { network.mock.restore(); await rm(directory, { recursive: true, force: true }); }
});
