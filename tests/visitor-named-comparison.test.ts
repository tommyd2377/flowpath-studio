import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publisherVocabularies, taskFixture, websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { VisitorTaskStore, confirmVisitorView } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { acknowledgeTaskDisplay, buildVisitorTaskView, CapabilityInputError, executeVisitorCapability } from '../lib/visitor-capabilities';

async function isolated(space = taskFixture()) {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-named-comparison-'));
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
  let session = await store.create(space.publication);
  buildVisitorTaskView({ index, session, signal: new AbortController().signal });
  confirmVisitorView(session); session = await store.save(session, session.revision);
  const read = () => store.read(session.id, space.publication);
  return { index, store, session, read, close: () => rm(directory, { recursive: true, force: true }),
    compare: async (input: unknown, overrides: Partial<Parameters<typeof executeVisitorCapability>[0]> = {}) => executeVisitorCapability({
      index, store, sessionId: session.id, signal: new AbortController().signal, assertCurrent: async () => {}, ...overrides,
      call: { capabilityId: 'selection.compare', input, operationId: randomUUID(), expectedRevision: (await read()).revision },
    }),
  };
}

test('named comparisons resolve exact published IDs across vocabularies without lookup or changing active filters', async () => {
  for (const vocabulary of publisherVocabularies) {
    const fixture = await isolated(taskFixture(vocabulary));
    try {
      let before = await fixture.read();
      before.queries[0].current.where = { kind: 'all', id: 'criteria', children: [{ kind: 'field', id: 'flag-filter', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } }] };
      before = await fixture.store.save(before, before.revision);
      let lookups = 0;
      const compared = await fixture.compare({ recordIds: ['record-00002', 'record-00000'] }, { records: async () => { lookups++; throw new Error('A mechanical record lookup must not be needed.'); } });
      assert.equal(lookups, 0);
      assert.equal(compared.view.focus, 'comparison');
      assert.deepEqual(compared.view.comparison!.rows.map(row => [row.id, row.name]), [['record-00002', `${vocabulary.type} 2`], ['record-00000', `${vocabulary.type} 0`]]);
      const cells = compared.view.comparison!.rows.map(row => Object.fromEntries(row.values.map(value => [value.fieldId, value.text])));
      assert.equal(cells[0][vocabulary.field], 'unknown');
      assert.equal(cells[1][vocabulary.field], '0 units');
      assert.equal(cells[0].flag, 'unknown'); assert.equal(cells[1].flag, 'true');
      const pending = await fixture.read();
      assert.deepEqual(pending.queries, before.queries, 'Named references do not alter the visitor\'s active query');
      assert.deepEqual(pending.selection, before.selection);
      assert.equal(pending.operations.length, 1, 'One comparison, no prerequisite lookup or selection mutation');
      assert.equal(pending.presentation, null, 'Execution is not evidence that a comparison was displayed');
      assert.equal(pending.tasks[0].status, 'awaitingDisplay');
      const view = compared.view;
      const shown = await acknowledgeTaskDisplay(fixture.store, view.sessionId, view.query.publication, {
        operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision,
        resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.comparison!.rows.map(row => row.id),
      });
      assert.equal(shown.presentation?.type, 'comparison');
      assert.equal(shown.receipts.at(-1)?.kind, 'display');
    } finally { await fixture.close(); }
  }
});

test('named comparisons retain both published price bases and every requested record in order', async () => {
  for (const kind of ['products', 'services'] as const) {
    const space = websiteTaskFixture(kind, 8), price = space.fields.find(field => field.id === 'price')!;
    const variant = kind === 'products' ? 'pack' : 'workshop';
    space.fields.push({ ...price, id: 'variant-price', label: `${variant} price`, basis: variant });
    space.records.forEach((record, i) => record.assertions.push({ id: `variant-${i}`, fieldId: 'variant-price', value: { type: 'money', value: 100 + i, currency: 'USD', basis: variant }, polarity: 'affirmed', conditions: [], authority: 'publisher' }));
    const fixture = await isolated(space);
    try {
      const recordIds = ['record-00007', 'record-00000', 'record-00005', 'record-00002', 'record-00006', 'record-00001'];
      const compared = await fixture.compare({ recordIds });
      assert.deepEqual(compared.view.comparison!.rows.map(row => row.id), recordIds);
      for (const row of compared.view.comparison!.rows) {
        const ordinal = Number(row.id.slice(-5)), cells = Object.fromEntries(row.values.map(value => [value.fieldId, value.text]));
        assert.equal(cells.price, ordinal === 0 ? 'unknown' : `${20 + ordinal} USD / ${kind === 'products' ? 'item' : 'session'}`);
        assert.equal(cells['variant-price'], `${100 + ordinal} USD / ${variant}`);
      }
    } finally { await fixture.close(); }
  }
});

test('invalid, duplicate, oversized and unpublished named comparison references fail before mutation', async () => {
  const fixture = await isolated();
  try {
    const before = await fixture.read();
    for (const input of [
      { recordIds: [] }, { recordIds: ['record-00000'] },
      { recordIds: ['record-00000', 'record-00000'] },
      { recordIds: fixture.index.space.records.slice(0, 7).map(record => record.id) },
      { recordIds: ['record-00000', 'article 1'] },
      { recordIds: ['record-00000', { id: 'record-00001', name: 'Invented', assertions: [] }] },
      { recordIds: ['record-00000', 'record-00001'], prices: [1, 2] },
    ]) {
      await assert.rejects(fixture.compare(input), error => error instanceof CapabilityInputError);
      assert.deepEqual(await fixture.read(), before);
    }
    for (const id of ['private-draft', 'foreign-publisher-record', 'removed-record']) {
      await assert.rejects(fixture.compare({ recordIds: ['record-00000', id] }), error => error instanceof CapabilityInputError && error.issues[0].code === 'unavailable_comparison_record');
      assert.deepEqual(await fixture.read(), before, 'Unknown references cannot reserve an operation or display a partial comparison');
    }
  } finally { await fixture.close(); }
});

test('named IDs cannot be mixed with query identities, query handles or record bindings', async () => {
  const fixture = await isolated();
  try {
    const before = await fixture.read(), query = before.queries[0].current;
    for (const otherSource of [
      { queryId: query.queryId, baseRevision: query.revision }, { queryId: query.queryId }, { baseRevision: query.revision },
      { queryHandleId: 'some-query-handle' }, { records: [] }, { records: fixture.index.space.records.slice(0, 2) },
    ]) {
      await assert.rejects(fixture.compare({ recordIds: ['record-00000', 'record-00001'], ...otherSource }), error => error instanceof CapabilityInputError && error.issues[0].code === 'ambiguous_comparison_source');
      assert.deepEqual(await fixture.read(), before);
    }
  } finally { await fixture.close(); }
});

test('named comparisons still require compatible published field evidence', async () => {
  for (const incompatible of [false, true]) {
    const space = taskFixture(undefined, 2);
    if (incompatible) { space.records[1].type = 'unrelated-type'; space.records[1].assertions = []; space.relationships = []; }
    else for (const record of space.records) record.assertions = [];
    const fixture = await isolated(space);
    try {
      const before = await fixture.read();
      await assert.rejects(fixture.compare({ recordIds: space.records.map(record => record.id) }), error => error instanceof CapabilityInputError && error.issues[0].code === 'comparison_fields');
      assert.deepEqual(await fixture.read(), before, 'Names alone do not authorize invented comparison fields');
    } finally { await fixture.close(); }
  }
});

test('named comparison rejects a stale publication or aborted request before reserving work', async () => {
  const fixture = await isolated();
  try {
    const before = await fixture.read(), recordIds = ['record-00000', 'record-00001'];
    const foreign = structuredClone(fixture.index.space); foreign.publication.siteId = 'other-publisher';
    await assert.rejects(fixture.compare({ recordIds }, { index: compileQueryIndex(foreign), sessionSnapshot: before }), /does not match this publication/);
    await assert.rejects(fixture.compare({ recordIds }, { assertCurrent: async () => { throw new Error('Publication changed.'); } }), /Publication changed/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fixture.compare({ recordIds }, { signal: controller.signal }), /abort/i);
    assert.deepEqual(await fixture.read(), before);
  } finally { await fixture.close(); }
});

test('manual interruption or publication change prevents an in-flight named comparison from becoming a result', async () => {
  for (const failure of ['manual', 'publication'] as const) {
    const fixture = await isolated();
    try {
      const before = await fixture.read(); let checks = 0;
      await assert.rejects(fixture.compare({ recordIds: ['record-00000', 'record-00001'] }, { assertCurrent: async () => {
        if (++checks !== 2) return;
        if (failure === 'publication') throw new Error('Publication changed.');
        const current = await fixture.read(); current.generation++; await fixture.store.save(current, current.revision);
      } }), failure === 'manual' ? /superseded|State changed in another request/ : /Publication changed/);
      const after = await fixture.read();
      assert.deepEqual(after.queries, before.queries);
      assert.deepEqual(after.evidence, before.evidence);
      assert.equal(after.presentation, before.presentation);
      assert.equal(after.tasks[0].status, failure === 'manual' ? 'cancelled' : 'failed');
      assert.equal(after.operations[0].status, 'failed');
      assert.equal(after.tasks[0].receipts.length, 0);
    } finally { await fixture.close(); }
  }
});
