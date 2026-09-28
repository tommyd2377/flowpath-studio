import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalRecordSchema } from '@thevoice/platform-ui/collection-space';
import { displayedTaskRecordIds, type VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { acknowledgeTaskDisplay } from '../lib/visitor-capabilities';
import { resolveEvidence } from '../lib/visitor-evidence-store';

test('model record lookup supplies exact calculable price variants while retained record handles stay canonical', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-price-options-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { newSite } = await import('../lib/site-store');
    const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
    const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
    const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Published service estimates', slug: 'published-service-estimates', kind: 'general' });
    const space = websiteTaskFixture('services', 3); space.publication.siteId = site.id;
    const price = space.fields.find(field => field.id === 'price')!; price.id = 'source_amount_a17';
    space.fields.push({ ...price, id: 'source_amount_z31' }, { ...price, id: 'source_amount_p90', basis: 'package' });
    for (const [position, record] of space.records.entries()) {
      const assertion = record.assertions.find(value => value.fieldId === 'price')!;
      assertion.fieldId = position === 1 ? 'source_amount_z31' : price.id;
      assertion.value = { type: 'money', value: [12.5, 3.5, 9][position], currency: 'USD', basis: 'session' };
      if (position === 2) assertion.conditions = ['Requires a reviewed quote'];
    }
    space.records[0].assertions.push({ id: 'package-price', fieldId: 'source_amount_p90', value: { type: 'money', value: 75, currency: 'USD', basis: 'package' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
    const request = (input: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(input) });
    const collections = async (input: unknown) => {
      const response = await collectionRoute(request(input), { params: Promise.resolve({ siteId: site.id }) });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
    };
    let { review } = await collections({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
    ({ review } = await collections({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
    ({ review } = await collections({ action: 'finish', reviewId: review.id, revision: review.revision }));
    const applied = await collections({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
    assert.equal((await siteRoute(request({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) })).status, 200);
    const bridge = await createVisitorTaskBridge(site.slug), context = await visitorTaskContext(site.slug), signal = new AbortController().signal;
    let sceneRevision = 0, displays = 0;
    const display = async (view: VisitorTaskView) => {
      displays++;
      await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision,
        resultSetId: view.result.resultSetId, sceneRevision: ++sceneRevision, recordIds: displayedTaskRecordIds(view), generation: view.generation });
    };
    const lookup = await bridge.execute(JSON.stringify({ capabilityId: 'records.lookup', input: { recordIds: space.records.map(record => record.id) } }), signal, display);
    assert.equal(lookup.data.status, 'retrieved');
    const projected = lookup.data.result as { id: string; priceOptions: { recordId: string; fieldId: string; label: string; text: string }[] }[];
    assert.deepEqual(projected[0].priceOptions.map(({ recordId, fieldId, text }) => ({ recordId, fieldId, text })), [
      { recordId: space.records[0].id, fieldId: 'source_amount_a17', text: 'USD 12.50 / session' },
      { recordId: space.records[0].id, fieldId: 'source_amount_p90', text: 'USD 75.00 / package' },
    ]);
    assert.equal(projected[1].priceOptions[0].fieldId, 'source_amount_z31');
    assert.deepEqual(projected[2].priceOptions, [], 'A qualified price is not presented as a calculable exact amount');
    const session = await context.store.read(bridge.sessionId, context.publication);
    const retained = canonicalRecordSchema.array().parse(resolveEvidence(session, lookup.data.handleId!, 'records'));
    assert.ok(retained.every(record => !Object.hasOwn(record, 'priceOptions')));
    assert.equal(displays, 0);
    const compared = await bridge.execute(JSON.stringify({ capabilityId: 'selection.compare', input: { records: [] }, bindings: [{ input: 'records', handleId: lookup.data.handleId, outputType: 'records' }] }), signal, display);
    assert.equal(compared.data.status, 'applied', 'The unchanged canonical handle remains bindable');
    const estimate = await bridge.execute(JSON.stringify({ capabilityId: 'estimate.update', input: { op: 'set', expectedRevision: 0, lines: projected.slice(0, 2).map((record, index) => ({ recordId: record.priceOptions[0].recordId, fieldId: record.priceOptions[0].fieldId, quantity: index === 0 ? 2 : 1 })) } }), signal, display);
    assert.equal(estimate.data.status, 'applied');
    assert.equal((estimate.data.result as { formattedSubtotal: string }).formattedSubtotal, 'USD 28.50');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
