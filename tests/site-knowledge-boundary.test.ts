import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyCommand } from '../lib/site-commands';
import { sampleContent } from '../lib/site-model';
import type { StoredSite } from '../lib/local-store';

test('ordinary content edits cannot attach an arbitrary knowledge revision', () => {
  const site: StoredSite = { id: randomUUID(), slug: 'boundary-test', ownerId: 'local-demo', template: 'voice-v1', revision: 1,
    draft: sampleContent('photographer'), published: null, publishedAt: null, files: [], history: [], messages: [] };
  assert.throws(() => applyCommand(site, { action: 'save', revision: 1, content: { ...site.draft, knowledgeRevisionId: randomUUID() } }), /Knowledge review/);
  const revisionId = randomUUID(); site.draft.knowledgeRevisionId = revisionId;
  applyCommand(site, { action: 'save', revision: 1, content: { ...site.draft, headline: 'Updated introduction' } });
  assert.equal(site.draft.knowledgeRevisionId, revisionId);
  applyCommand(site, { action: 'publish', revision: 1 });
  site.draft.headline = 'Unpublished change';
  assert.equal(site.published?.headline, 'Updated introduction');
  assert.equal(site.published?.knowledgeRevisionId, revisionId);
});
