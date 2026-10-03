import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceQualityMessage } from '../lib/source-quality';
import { textPdf } from './knowledge-fixtures';

test('PDF coverage warnings survive ready, failed and duplicate reports without applying the proposal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-pdf-quality-'));
  const previous = { directory: process.env.VOICE_DATA_DIR, backend: process.env.VOICE_BACKEND, ai: process.env.VOICE_AI_MODE };
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network is forbidden in this offline regression.'); });
  try {
    const { listSites, getSite, uploadFile, modifySite } = await import('../lib/site-store');
    const { applyCommand } = await import('../lib/site-commands');
    const { analyzeKnowledgeFiles, getKnowledgeState } = await import('../lib/ingestion');
    const { readKnowledgeArtifact, readKnowledgeLedger } = await import('../lib/knowledge-store');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await getSite(user, (await listSites(user))[0].id);
    // Establish an existing synthetic publication before preparing new sources.
    await modifySite(user, site.id, site.revision, stored => applyCommand(stored, { action: 'publish', revision: site.revision }));
    site = await getSite(user, site.id);
    assert.ok(site.published);
    const upload = async (name: string, bytes: Uint8Array, pdf = true) => {
      const id = randomUUID();
      await uploadFile(user, site.id, site.revision, { id, name, mime: pdf ? 'application/pdf' : 'text/plain', kind: pdf ? 'pdf' : 'text', size: bytes.length, uploadedAt: new Date().toISOString(), data: Buffer.from(bytes).toString('base64') });
      site = await getSite(user, site.id);
      return id;
    };
    const structured = textPdf([['Name: Synthetic lunch', 'Kind: offering', 'Price [USD]: 12']]);
    const prose = textPdf([['This unstructured synthetic menu needs semantic interpretation.', 'Cedar pie 12/12.36; cash/card prices.']]);
    const fileIds = [
      await upload('structured.pdf', structured),
      await upload('structured-copy.pdf', structured),
      await upload('prose.pdf', prose),
      await upload('prose-copy.pdf', prose),
      await upload('policy.txt', Buffer.from('Name: Synthetic policy\nKind: policy\nSummary: Review original source.'), false),
      await upload('invalid.pdf', Buffer.from('%PDF-1.4\nThis is not a complete PDF.')),
    ];
    const before = structuredClone(await getSite(user, site.id));
    const requestId = randomUUID();
    const state = await analyzeKnowledgeFiles(user, site.id, { revision: site.revision, requestId, sources: fileIds.map(fileId => ({ fileId })) });
    const job = state.jobs.find(item => item.id === requestId)!;
    const candidate = state.candidates.find(item => item.id === requestId)!;
    assert.equal(job.status, 'needs_review');
    assert.deepEqual(job.files?.map(file => file.status), ['ready', 'unchanged', 'failed', 'failed', 'ready', 'failed']);
    assert.deepEqual(candidate.files, job.files);
    for (const report of job.files!.slice(0, 4)) assert.deepEqual(report.warnings, ['pdf-text-only'], report.name);
    assert.equal(job.files![4].warnings, undefined, 'ordinary text has no PDF warning');
    assert.equal(job.files![5].warnings, undefined, 'failed PDF extraction must not claim that text extraction completed');
    assert.match(job.files![2].message, /connected semantic interpreter/);
    assert.match(job.files![3].message, /prose\.pdf.*could not be processed/);
    assert.equal(candidate.catalog.entities.length, 2, 'copies and uninterpreted prose do not add entities');
    assert.equal(candidate.catalog.entities.find(entity => entity.name === 'Synthetic lunch')?.attributes['price-usd'], 12);
    assert.ok(candidate.notes.some(note => note.includes(sourceQualityMessage('pdf-text-only'))));
    assert.equal(job.paidAttempt, undefined);

    const reloaded = await getKnowledgeState(user, site.id);
    assert.deepEqual(reloaded.jobs.find(item => item.id === requestId)?.files, job.files);
    assert.deepEqual(reloaded.candidates.find(item => item.id === requestId)?.files, candidate.files);
    const saved = await readKnowledgeArtifact(user, site.id, candidate.catalog.id);
    assert.deepEqual(saved.files, job.files);
    assert.ok(saved.notes.some(note => note.includes(sourceQualityMessage('pdf-text-only'))));
    assert.deepEqual((await readKnowledgeLedger(user, site.id)).jobs.find(item => item.id === requestId)?.files, job.files);

    const after = await getSite(user, site.id);
    assert.deepEqual(after.draft, before.draft);
    assert.deepEqual(after.published, before.published);
    assert.equal(after.revision, before.revision);
    assert.equal(network.mock.callCount(), 0);
  } finally {
    network.mock.restore();
    for (const [name, value] of Object.entries({ VOICE_DATA_DIR: previous.directory, VOICE_BACKEND: previous.backend, VOICE_AI_MODE: previous.ai })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('an identical previously applied PDF retains its warning without extraction, interpretation or a new candidate', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-pdf-quality-reimport-'));
  const previous = { directory: process.env.VOICE_DATA_DIR, backend: process.env.VOICE_BACKEND, ai: process.env.VOICE_AI_MODE };
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network is forbidden in this offline regression.'); });
  try {
    const { listSites, getSite, uploadFile, modifySite } = await import('../lib/site-store');
    const { applyCommand } = await import('../lib/site-commands');
    const { analyzeKnowledgeFiles, applyKnowledge, getKnowledgeState } = await import('../lib/ingestion');
    const { readPlatformEventSummary } = await import('../lib/platform-events');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await getSite(user, (await listSites(user))[0].id);
    const bytes = textPdf([['Name: Reviewed synthetic lunch', 'Kind: offering', 'Price [USD]: 12']]);
    const upload = async (name: string) => {
      const id = randomUUID();
      await uploadFile(user, site.id, site.revision, { id, name, mime: 'application/pdf', kind: 'pdf', size: bytes.length, uploadedAt: new Date().toISOString(), data: Buffer.from(bytes).toString('base64') });
      site = await getSite(user, site.id);
      return id;
    };
    const originalId = await upload('reviewed.pdf');
    const initial = await analyzeKnowledgeFiles(user, site.id, { revision: site.revision, requestId: randomUUID(), sources: [{ fileId: originalId }] });
    const candidate = initial.candidates[0];
    assert.ok(candidate);
    await applyKnowledge(user, site.id, { revision: site.revision, candidateId: candidate.id, candidateRevisionId: candidate.catalog.id });
    site = await getSite(user, site.id);
    await modifySite(user, site.id, site.revision, stored => applyCommand(stored, { action: 'publish', revision: site.revision }));
    site = await getSite(user, site.id);
    const copyId = await upload('reviewed-copy.pdf');
    const before = structuredClone(await getSite(user, site.id));
    assert.ok(before.draft.knowledgeRevisionId);
    assert.equal(before.published?.knowledgeRevisionId, before.draft.knowledgeRevisionId);
    const beforeState = await getKnowledgeState(user, site.id);
    const beforeActivity = await readPlatformEventSummary(site.id);
    assert.ok(beforeActivity.events.some(event => event.type === 'extraction' && event.status === 'succeeded'));

    const requestId = randomUUID();
    const state = await analyzeKnowledgeFiles(user, site.id, { revision: site.revision, requestId, sources: [{ fileId: copyId }] });
    const job = state.jobs.find(item => item.id === requestId)!;
    assert.equal(job.status, 'discarded');
    assert.equal(job.files?.[0].status, 'unchanged');
    assert.deepEqual(job.files?.[0].warnings, ['pdf-text-only']);
    assert.match(job.files![0].message, /Exact source already reviewed/);
    assert.equal(job.paidAttempt, undefined);
    assert.equal(job.candidateRevisionId, undefined);
    assert.deepEqual(state.candidates, beforeState.candidates);
    assert.deepEqual((await getKnowledgeState(user, site.id)).jobs.find(item => item.id === requestId)?.files, job.files);
    assert.deepEqual(await readPlatformEventSummary(site.id), beforeActivity, 'the unchanged-source shortcut records no new extraction or interpretation work');
    const after = await getSite(user, site.id);
    assert.deepEqual(after.draft, before.draft);
    assert.deepEqual(after.published, before.published);
    assert.equal(after.revision, before.revision);
    assert.equal(network.mock.callCount(), 0);
  } finally {
    network.mock.restore();
    for (const [name, value] of Object.entries({ VOICE_DATA_DIR: previous.directory, VOICE_BACKEND: previous.backend, VOICE_AI_MODE: previous.ai })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
