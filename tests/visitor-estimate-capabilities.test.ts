import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { displayedTaskRecordIds, type VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { publishedEstimateSchema } from '@thevoice/platform-ui/estimate';
import type { VisitorEstimateTaxInput } from '@thevoice/platform-ui/estimate-tax';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { acknowledgeTaskDisplay, buildVisitorTaskView, CapabilityInputError, executeVisitorCapability } from '../lib/visitor-capabilities';
import { VisitorTaskStore, restoreTaskSurface } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import type { ExploreResult } from '../lib/explore-model';
import { visitorEstimateContext } from '../lib/visitor-estimate-context';
import { researchEvidenceExcerpts } from '../lib/visitor-research-excerpts';

async function setup(modify?: (space: ReturnType<typeof websiteTaskFixture>) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-estimate-capabilities-'));
  const space = websiteTaskFixture('products', 3); space.relationships = [];
  space.records.forEach((record, position) => { record.assertions.find(value => value.fieldId === 'price')!.value = { type: 'money', value: [12.5, 3.5, 6][position], currency: 'USD', basis: 'item' }; });
  modify?.(space);
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory)), signal = new AbortController().signal;
  let session = await store.create(space.publication), researchCalls = 0, sceneRevision = 0;
  buildVisitorTaskView({ index, session, signal }); session = await store.save(session, session.revision);
  const source = { title: 'Synthetic Example County reference', url: 'https://revenue.gov/rates' };
  const answer = 'Example County applies 8.875% tax to prepared goods for pickup, without exemptions.';
  const research: ExploreResult = { id: 'scoped-tax-result', query: 'Example County prepared goods pickup tax', kind: 'web', demo: false,
    fetchedAt: new Date().toISOString(), answer, sources: [source], citations: [{ ...source, start: 0, end: answer.length }], images: [], map: null };
  const read = () => store.read(session.id, space.publication);
  const execute = async (capabilityId: string, input: unknown, expectedRevision?: number) => {
    session = await read();
    return executeVisitorCapability({ index, store, sessionId: session.id, signal, assertCurrent: async () => {},
      research: async () => { researchCalls++; return research; }, call: { capabilityId, input, operationId: randomUUID(), expectedRevision: expectedRevision ?? session.revision } });
  };
  const ack = async (view: VisitorTaskView) => acknowledgeTaskDisplay(store, session.id, space.publication, { operationId: view.operationId!, queryId: view.query.queryId,
    queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: ++sceneRevision, recordIds: displayedTaskRecordIds(view), generation: view.generation });
  const line = (position: number, quantity = 1) => ({ recordId: space.records[position].id, fieldId: 'price', quantity });
  const tax: VisitorEstimateTaxInput = { mode: 'researched', jurisdiction: 'Example County', location: 'Example County store', fulfillment: 'pickup', applicabilityNotes: ['Prepared goods; no exemptions claimed.'], visitorAssumption: null,
    lines: [0, 1].map(position => ({ recordId: space.records[position].id, fieldId: 'price', classification: 'prepared goods', taxability: 'taxable', ratePercent: '8.875', taxabilityNotes: 'Prepared goods for pickup are taxable.', evidence: [{ resultId: research.id, url: source.url, excerpt: answer }] })) };
  return { directory, index, store, read, execute, ack, line, tax, research, researchCalls: () => researchCalls };
}

test('estimate capabilities retain one research result across acknowledged tax and quantity edits; Home and Back do not roll back the basket', async t => {
  const f = await setup(); t.after(() => rm(f.directory, { recursive: true, force: true }));
  const empty = await f.execute('estimate.read', {});
  assert.equal(publishedEstimateSchema.parse(empty.data).revision, 0);
  assert.deepEqual((await f.read()).business, {});
  const set = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(0, 2), f.line(1)] });
  assert.equal(set.view.focus, 'estimate');
  assert.equal(set.view.estimate?.subtotal, '28.50');
  assert.equal((await f.read()).tasks.at(-1)?.status, 'awaitingDisplay');
  await f.ack(set.view);
  assert.equal((await f.read()).tasks.at(-1)?.status, 'completed');
  await f.execute('research.lookup', { query: f.research.query, kind: 'web' });
  const taxed = await f.execute('estimate.tax', { expectedRevision: 1, tax: f.tax });
  assert.equal(taxed.view.estimate?.revision, 2);
  assert.equal(taxed.view.estimate?.tax?.estimatedTax, '2.53');
  assert.equal(taxed.view.estimate?.tax?.estimatedTotal, '31.03');
  assert.match(taxed.view.estimate!.tax!.notes[0], /interpreted.*not verified tax authority/);
  const unacknowledgedRevision = (await f.read()).revision;
  await f.ack(taxed.view);
  await assert.rejects(f.execute('estimate.update', { op: 'upsert', expectedRevision: 2, lines: [f.line(0, 3)] }, unacknowledgedRevision), /Visitor state changed/);
  const changed = await f.execute('estimate.update', { op: 'upsert', expectedRevision: 2, lines: [f.line(0, 3)] });
  await f.ack(changed.view);
  assert.equal(changed.view.estimate?.revision, 3);
  assert.equal(changed.view.estimate?.subtotal, '41.00');
  assert.equal(changed.view.estimate?.tax?.estimatedTotal, '44.64');
  assert.equal(changed.view.estimate?.tax?.lines[0].evidence[0].fetchedAt, f.research.fetchedAt);
  assert.notEqual(changed.view.estimate?.tax?.basisHash, taxed.view.estimate?.tax?.basisHash);
  assert.equal(f.researchCalls(), 1, 'Quantity edits reuse retained evidence without searching again');
  const current = structuredClone((await f.read()).business);
  const back = await f.execute('view.back', { target: 'previous' }); await f.ack(back.view);
  assert.equal(back.view.estimate?.revision, 2);
  assert.equal(back.view.estimate?.tax?.estimatedTotal, '31.03');
  assert.deepEqual((await f.read()).business, current, 'Back restores presentation, not business state');
  await assert.rejects(f.execute('estimate.update', { op: 'upsert', expectedRevision: 2, lines: [f.line(0, 4)] }), /Estimate changed/);
  assert.deepEqual((await f.read()).business, current, 'Historical controls cannot overwrite current quantities');
  const home = await f.execute('home', {}); await f.ack(home.view);
  assert.equal(home.view.navigation, 'home');
  assert.deepEqual((await f.read()).business, current);
  let session = await f.read();
  const historical = restoreTaskSurface(session, taxed.view.operationId!);
  session = await f.store.save(session, session.revision);
  assert.equal(historical.estimate?.revision, 2);
  assert.deepEqual(session.business, current, 'Whole-answer Back also preserves the current basket');
  assert.equal(publishedEstimateSchema.parse(historical.business.estimate).revision, 3);
  const reopened = await f.execute('estimate.show', {}); await f.ack(reopened.view);
  assert.equal(reopened.view.estimate?.revision, 3);
  assert.equal(reopened.view.estimate?.tax?.estimatedTotal, '44.64');
  assert.equal(f.researchCalls(), 1);
});

test('follow-up context carries current prices and exact retained tax excerpts without a new lookup', async t => {
  const f = await setup(); t.after(() => rm(f.directory, { recursive: true, force: true }));
  const set = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(0, 2), f.line(1)] }); await f.ack(set.view);
  await f.execute('research.lookup', { query: f.research.query, kind: 'web' });
  const taxed = await f.execute('estimate.tax', { expectedRevision: 1, tax: f.tax }); await f.ack(taxed.view);
  const session = await f.read(), before = structuredClone(session);
  const context = visitorEstimateContext(session, f);
  assert.equal(context.revision, 2);
  assert.equal(context.tax?.estimatedTotal, '31.03');
  assert.equal(context.priceOptions?.[0].recordId, f.line(0).recordId);
  assert.equal(context.priceOptions?.[0].fieldId, 'price');
  assert.deepEqual(context.taxResearch?.[0].evidenceExcerpts, researchEvidenceExcerpts(f.research).evidenceExcerpts);
  assert.equal(context.taxResearch?.[0].fetchedAt, f.research.fetchedAt);
  assert.equal(f.researchCalls(), 1);
  assert.deepEqual(session, before, 'Context preparation does not change tax treatment or business state');
  for (const invalid of ['expired', 'other-visitor', 'other-publication'] as const) {
    const stale = structuredClone(session);
    if (invalid === 'expired') stale.researchMemory[0].expiresAt = new Date(0).toISOString();
    else if (invalid === 'other-visitor') stale.researchMemory[0].sessionId = randomUUID();
    else stale.researchMemory[0].publication.revisionId = 'foreign';
    const projected = visitorEstimateContext(stale, f);
    assert.deepEqual(projected.taxResearch, []);
    assert.deepEqual(projected.omittedTaxResearch, [f.research.id]);
  }
});

test('new priced lines remain tax-incomplete, removal restores applicable evidence, and clear removes tax assumptions', async t => {
  const f = await setup(); t.after(() => rm(f.directory, { recursive: true, force: true }));
  const set = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(0, 2), f.line(1)] }); await f.ack(set.view);
  await f.execute('research.lookup', { query: f.research.query, kind: 'web' });
  const taxed = await f.execute('estimate.tax', { expectedRevision: 1, tax: f.tax }); await f.ack(taxed.view);
  const added = await f.execute('estimate.update', { op: 'upsert', expectedRevision: 2, lines: [f.line(2)] }); await f.ack(added.view);
  assert.equal(added.view.estimate?.tax?.status, 'incomplete');
  assert.equal(added.view.estimate?.tax?.estimatedTotal, null);
  assert.match(added.view.estimate!.tax!.missing.join(' '), /classification/);
  const removed = await f.execute('estimate.update', { op: 'remove', expectedRevision: 3, lines: [{ recordId: f.line(2).recordId, fieldId: 'price' }] }); await f.ack(removed.view);
  assert.equal(removed.view.estimate?.tax?.status, 'complete');
  assert.equal(removed.view.estimate?.tax?.estimatedTotal, '31.03');
  const cleared = await f.execute('estimate.update', { op: 'clear', expectedRevision: 4 }); await f.ack(cleared.view);
  assert.deepEqual(cleared.view.estimate?.lines, []);
  assert.equal(cleared.view.estimate?.tax, undefined);
  assert.equal((await f.read()).business.estimateTax, undefined);
  assert.equal(f.researchCalls(), 1);
});

test('changing every price variant keeps prior cited research available but requires new tax treatment', async t => {
  const f = await setup(space => {
    space.fields.push({ ...space.fields.find(value => value.id === 'price')!, id: 'bundle-price', label: 'Bundle price', basis: 'bundle' });
    for (const record of space.records) record.assertions.push({ id: `bundle-${record.id}`, fieldId: 'bundle-price', value: { type: 'money', value: 50, currency: 'USD', basis: 'bundle' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
  });
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const set = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(0, 2), f.line(1)] }); await f.ack(set.view);
  await f.execute('research.lookup', { query: f.research.query, kind: 'web' });
  const taxed = await f.execute('estimate.tax', { expectedRevision: 1, tax: f.tax }); await f.ack(taxed.view);
  const before = visitorEstimateContext(await f.read(), f);
  assert.ok(before.priceOptions?.some(option => option.fieldId === 'bundle-price'));
  const changed = await f.execute('estimate.update', { op: 'set', expectedRevision: 2, lines: [0, 1].map(position => ({ ...f.line(position), fieldId: 'bundle-price' })) }); await f.ack(changed.view);
  const context = visitorEstimateContext(await f.read(), f);
  assert.equal(context.tax?.status, 'incomplete');
  assert.equal(context.tax.estimatedTotal, null, 'Old treatment must not silently apply to the new variants');
  assert.deepEqual(context.taxResearch?.[0].evidenceExcerpts, researchEvidenceExcerpts(f.research).evidenceExcerpts);
  assert.equal(f.researchCalls(), 1);
});

test('invalid tax evidence and stale tax revisions leave the current basket and assumptions unchanged', async t => {
  const f = await setup(); t.after(() => rm(f.directory, { recursive: true, force: true }));
  const set = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(0, 2), f.line(1)] }); await f.ack(set.view);
  const before = structuredClone((await f.read()).business);
  await assert.rejects(f.execute('estimate.tax', { expectedRevision: 1, tax: f.tax }), /research is unavailable/);
  assert.deepEqual((await f.read()).business, before);
  await f.execute('research.lookup', { query: f.research.query, kind: 'web' });
  await assert.rejects(f.execute('estimate.tax', { expectedRevision: 0, tax: f.tax }), /Estimate changed/);
  assert.deepEqual((await f.read()).business, before);
  const forged = structuredClone(f.tax);
  assert.ok('url' in forged.lines[0].evidence[0]);
  forged.lines[0].evidence[0].url = 'https://unrelated.gov/rate';
  const beforeRejection = await f.read();
  await assert.rejects(f.execute('estimate.tax', { expectedRevision: 1, tax: forged }), (error: unknown) => {
    assert.ok(error instanceof CapabilityInputError);
    assert.equal(error.issues[0]?.path, 'input.tax');
    assert.equal(error.issues[0]?.code, 'invalid_tax_evidence');
    assert.match(error.issues[0]?.message ?? '', /cited paragraph.*exact retained cited excerpt/);
    return true;
  });
  assert.deepEqual(await f.read(), beforeRejection, 'Tax evidence correction happens before any operation, history, capability step or session revision is reserved');
  assert.deepEqual((await f.read()).business, before);
  const corrected = await f.execute('estimate.tax', { expectedRevision: 1, tax: f.tax });
  assert.equal(corrected.view.estimate?.tax?.status, 'complete');
  await f.ack(corrected.view);
  assert.equal((await f.read()).operations.length, beforeRejection.operations.length + 1);
});

test('wrong price fields are correctable input before session reservation and the published field succeeds', async t => {
  for (const action of ['prices.total', 'set', 'upsert'] as const) {
    const f = await setup(); t.after(() => rm(f.directory, { recursive: true, force: true }));
    if (action === 'upsert') {
      const seed = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(1)] });
      await f.ack(seed.view);
    }
    const expectedRevision = action === 'upsert' ? 1 : 0;
    const capability = action === 'prices.total' ? action : 'estimate.update';
    const input = (fieldId: string) => ({ ...(action === 'prices.total' ? {} : { op: action, expectedRevision }), lines: [{ ...f.line(0, 2), fieldId }] });
    const before = await f.read();
    for (const fieldId of ['unpublished-price', 'size']) {
      await assert.rejects(f.execute(capability, input(fieldId)), (error: unknown) => {
        assert.ok(error instanceof CapabilityInputError);
        assert.equal(error.issues[0]?.path, 'input.lines');
        assert.equal(error.issues[0]?.code, 'invalid_published_price');
        assert.match(error.issues[0]?.message ?? '', /records\.lookup.*priceOptions.*never guess/);
        return true;
      });
      assert.deepEqual(await f.read(), before, `${action}: rejection cannot reserve an operation, consume a capability step, alter history or change the basket`);
    }
    const corrected = await f.execute(capability, input('price'));
    if (action === 'prices.total') {
      assert.equal((corrected.data as { subtotal: string }).subtotal, '25.00');
      assert.deepEqual((await f.read()).business, before.business);
    } else {
      assert.equal(corrected.view.estimate?.subtotal, action === 'upsert' ? '28.50' : '25.00');
      assert.equal(corrected.view.estimate?.revision, expectedRevision + 1);
      await f.ack(corrected.view);
    }
    const after = await f.read();
    assert.equal(after.operations.length, before.operations.length + 1, 'Only the corrected operation is reserved');
    assert.equal(after.tasks.at(-1)?.budget.capabilityCalls, 1, 'Rejected references do not use the task capability budget');
    assert.equal(after.operations.at(-1)?.status, 'completed');
  }
});

test('price-reference correction never relaxes conditional prices or mixed-currency bounds', async t => {
  for (const scenario of ['conditional', 'mixed'] as const) {
    const f = await setup(space => {
      if (scenario === 'conditional') space.records[0].assertions.find(value => value.fieldId === 'price')!.conditions = ['Only for members'];
      else {
        space.fields.push({ ...space.fields.find(value => value.id === 'price')!, id: 'euro-price', currency: 'EUR' });
        space.records[1].assertions.push({ id: 'euro-price-1', fieldId: 'euro-price', value: { type: 'money', value: 4, currency: 'EUR', basis: 'item' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
      }
    });
    t.after(() => rm(f.directory, { recursive: true, force: true }));
    const before = await f.read();
    const lines = scenario === 'conditional' ? [f.line(0)] : [f.line(0), { ...f.line(1), fieldId: 'euro-price' }];
    for (const action of ['prices.total', 'set', 'upsert'] as const) {
      await assert.rejects(f.execute(action === 'prices.total' ? action : 'estimate.update', { ...(action === 'prices.total' ? {} : { op: action, expectedRevision: 0 }), lines }), (error: unknown) => {
        assert.ok(error instanceof CapabilityInputError);
        assert.equal(error.issues[0]?.code, 'invalid_published_price');
        assert.match(error.issues[0]?.message ?? '', scenario === 'conditional' ? /unconditional/ : /cannot mix currencies/);
        return true;
      });
      assert.deepEqual(await f.read(), before, `${scenario} ${action}: typed validation must leave all session state untouched`);
    }
  }
});

test('a single foreign-currency upsert is correctable input against the complete basket before reserving state', async t => {
  const f = await setup(space => {
    space.fields.push({ ...space.fields.find(value => value.id === 'price')!, id: 'euro-price', currency: 'EUR' });
    space.records[1].assertions.push({ id: 'euro-price-1', fieldId: 'euro-price', value: { type: 'money', value: 4, currency: 'EUR', basis: 'item' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
  });
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const seed = await f.execute('estimate.update', { op: 'set', expectedRevision: 0, lines: [f.line(0)] });
  await f.ack(seed.view);
  const before = await f.read();
  await assert.rejects(f.execute('estimate.update', { op: 'upsert', expectedRevision: 1, lines: [{ ...f.line(1), fieldId: 'euro-price' }] }), (error: unknown) => {
    assert.ok(error instanceof CapabilityInputError);
    assert.equal(error.issues[0]?.code, 'invalid_published_price');
    assert.match(error.issues[0]?.message ?? '', /cannot mix currencies/);
    return true;
  });
  assert.deepEqual(await f.read(), before);
  const corrected = await f.execute('estimate.update', { op: 'upsert', expectedRevision: 1, lines: [f.line(1)] });
  assert.equal(corrected.view.estimate?.subtotal, '16.00');
  await f.ack(corrected.view);
});
