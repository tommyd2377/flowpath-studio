import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { taskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { buildVisitorTaskView, visitorCapabilities } from '../lib/visitor-capabilities';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';

test('schema tools describe zero-based offsets and return bounded pages from those positions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-schema-pages-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const space = taskFixture();
  for (let i = 0; i < 30; i++) {
    space.collections.push({ id: `extra-${i}`, name: `Category ${i}`, introduction: '', kind: 'explicit', view: 'grid' });
    space.edges.push({ parentId: space.rootId, childId: `extra-${i}` });
  }
  for (let i = 0; i < 35; i++) space.fields.push({ ...space.fields[0], id: `extra-field-${i}`, label: `Field ${i}`, coverage: { known: 0, total: space.records.length } });
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
  const session = await store.create(space.publication), context = { index, session, signal: new AbortController().signal };
  buildVisitorTaskView(context);
  const childIds = space.edges.filter(edge => edge.parentId === space.rootId).map(edge => edge.childId);
  const fieldIds = space.fields.map(field => field.id);
  for (const id of ['schema.describe', 'collection.page']) {
    const capability = visitorCapabilities.get(id)!;
    const schema = z.toJSONSchema(capability.input) as { properties: Record<string, { description?: string }> };
    for (const key of ['children', 'fields']) assert.match(schema.properties[key].description ?? '', /Zero-based .* offset, not a count or limit\. Use 0 for the first page/);
    const execute = async (children: number, fields: number) => capability.execute(context, { children, fields }) as Promise<{ children: { id: string }[]; fields: { id: string }[]; omittedChildren: number; omittedFields: number }>;
    const first = await execute(0, 0), next = await execute(24, 32);
    assert.deepEqual(first.children.map(child => child.id), childIds.slice(0, 24));
    assert.deepEqual(first.fields.map(field => field.id), fieldIds.slice(0, 32));
    assert.deepEqual(next.children.map(child => child.id), childIds.slice(24));
    assert.deepEqual(next.fields.map(field => field.id), fieldIds.slice(32));
    assert.equal(next.omittedChildren, 0); assert.equal(next.omittedFields, 0);
    const skipped = await execute(100, 0);
    assert.equal(skipped.children.length, 0, '100 skips the first 100 children rather than requesting 100 entries');
    assert.equal(skipped.fields.length, 32);
  }
  const describe = visitorCapabilities.get('schema.describe')!;
  assert.deepEqual(await describe.execute(context, {}), await describe.execute(context, { children: 0, fields: 0 }), 'Omitted offsets begin at the first page');
});
