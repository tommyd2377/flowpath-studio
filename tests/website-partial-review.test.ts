import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WebsiteTransport } from '../lib/website-fetch';

test('semantic partial website proposals require acknowledgement and assertion review even when every page imported', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'website-partial-review-'));
  process.env.VOICE_DATA_DIR = directory; process.env.VOICE_BACKEND = 'demo'; process.env.VOICE_AI_MODE = 'demo';
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No external network or paid model calls allowed'); };
  try {
    const { listSites, getSite } = await import('../lib/site-store');
    const { analyzeKnowledgeWebsite, applyKnowledge, reviseKnowledge, reviewKnowledgeAssertions, getKnowledgeState } = await import('../lib/ingestion');
    const { readKnowledgeArtifact, writeKnowledgeArtifact, changeKnowledgeLedger } = await import('../lib/knowledge-store');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    const site = await getSite(user, (await listSites(user))[0].id);
    const io: WebsiteTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], connect: async url => ({
      remoteAddress: '93.184.216.34', status: 200, contentType: url.pathname === '/robots.txt' ? 'text/plain' : 'text/html',
      bytes: Buffer.from(url.pathname === '/robots.txt' ? '' : '<title>Neighborhood Workshop</title><h1>Neighborhood Workshop</h1><p>We offer practical lessons for local makers. Contact our team to discuss workshop topics, accessibility needs and the published schedule.</p>'),
    }) };
    let state = await analyzeKnowledgeWebsite(user, site.id, { url: 'https://workshop.example', urls: ['https://workshop.example/'], revision: site.revision, requestId: randomUUID() }, io);
    let candidate = state.candidates[0];
    assert.ok(candidate);
    const saved = await readKnowledgeArtifact(user, site.id, candidate.catalog.id);
    const id = randomUUID();
    const partial = { ...saved, id, catalog: { ...saved.catalog, id }, website: { ...saved.website!, incomplete: true, notes: ['The source gives conflicting schedules; review the unresolved information.'] } };
    assert.ok(partial.website.pages.every(page => page.status === 'imported'));
    await writeKnowledgeArtifact(user, site.id, partial);
    await changeKnowledgeLedger(user, site.id, ledger => { ledger.jobs.find(job => job.id === candidate.id)!.candidateRevisionId = id; });
    state = await getKnowledgeState(user, site.id); candidate = state.candidates[0];
    assert.equal(candidate.website?.incomplete, true, 'the persisted schema retains the partial marker');
    const input = () => ({ candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, revision: site.revision });
    for (const acceptPartial of [undefined, false]) {
      await assert.rejects(() => applyKnowledge(user, site.id, { ...input(), acceptPartial }), /acknowledge the incomplete website import report/);
      const unchanged = await getSite(user, site.id);
      assert.deepEqual(unchanged.draft, site.draft);
      assert.deepEqual(unchanged.published, site.published);
      assert.equal((await getKnowledgeState(user, site.id)).jobs.find(job => job.id === candidate.id)?.status, 'needs_review');
    }
    await assert.rejects(() => applyKnowledge(user, site.id, { ...input(), acceptPartial: true }), /unsupported assertions/);
    state = await reviseKnowledge(user, site.id, { candidateId: candidate.id, revision: site.revision, catalog: candidate.catalog,
      websiteDesign: { ...candidate.website!.design, headline: 'A reviewed workshop headline' } });
    candidate = state.candidates[0];
    assert.equal(candidate.website?.incomplete, true, 'saving corrections cannot erase the partial marker');
    state = await reviewKnowledgeAssertions(user, site.id, { ...input(), decisions: candidate.assertionReviews!.filter(review => review.status === 'pending')
      .map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: 'approve' })) });
    candidate = state.candidates[0];
    await assert.rejects(() => applyKnowledge(user, site.id, input()), /acknowledge the incomplete website import report/);
    const applied = await applyKnowledge(user, site.id, { ...input(), acceptPartial: true });
    assert.equal(applied.site.draft.knowledgeRevisionId, candidate.catalog.id);
    assert.equal(applied.site.draft.headline, site.draft.headline, 'opting out of design cannot bypass the acknowledgement');
    assert.deepEqual(applied.site.published, site.published, 'acknowledgement applies only to the draft');
  } finally {
    globalThis.fetch = fetch; delete process.env.VOICE_DATA_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});
