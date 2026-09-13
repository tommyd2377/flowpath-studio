import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialSite, pruneMediaReferences } from '../lib/local-store';
import { applyCommand, commandSchema } from '../lib/site-commands';

test('clearing history releases historical files but keeps draft and publication protection', () => {
  const site = initialSite('general');
  const [old, current, published] = [randomUUID(), randomUUID(), randomUUID()];
  site.files = [old, current, published].map(id => ({ id, name: 'test.jpg', kind: 'image', mime: 'image/jpeg', size: 10, uploadedAt: new Date().toISOString() }));
  const oldMedia = randomUUID(), liveMedia = randomUUID();
  site.history = [{ ...site.draft, logoAssetId: old, mediaRevisionId: oldMedia }];
  site.draft.logoAssetId = current;
  site.published = { ...site.draft, logoAssetId: published, mediaRevisionId: liveMedia };
  site.mediaRefs = { [oldMedia]: [old], [liveMedia]: [published] };
  const before = structuredClone({ draft: site.draft, published: site.published, files: site.files });
  assert.throws(() => applyCommand(site, { action: 'remove-file', revision: 1, fileId: old }), /Undo history/);
  applyCommand(site, commandSchema.parse({ action: 'clear-history', revision: 1 }));
  pruneMediaReferences(site);
  assert.deepEqual({ draft: site.draft, published: site.published, files: site.files }, before);
  assert.deepEqual(site.history, []);
  assert.deepEqual(site.mediaRefs, { [liveMedia]: [published] });
  for (const fileId of [current, published]) assert.throws(() => applyCommand(site, { action: 'remove-file', revision: 1, fileId }), /used by/);
  applyCommand(site, { action: 'remove-file', revision: 1, fileId: old });
  assert.deepEqual(site.files.map(file => file.id), [current, published]);
  assert.throws(() => applyCommand(site, { action: 'undo', revision: 1 }), /no draft changes/);
});
