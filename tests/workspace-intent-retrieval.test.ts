import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { KNOWLEDGE_LIMITS, retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { sampleContent } from '../lib/site-model';
import { planWorkspaceIntent, publishedWorkspace, workspaceInstructions } from '../lib/visitor-workspace';
import { PUBLISHED_CONTENT_BYTES, readPublishedContent } from '../lib/visitor-published-content';

const conditions = 'The final registration-fee exception applies only to returning students; a listed course fee does not establish current availability.';
const fixture = () => validateCatalog({ schemaVersion: 1, id: 'published-workshop-pages', name: 'Synthetic workshop', description: 'Approved pages.',
  attributes: [{ id: 'fee', label: 'Fee', type: 'money', currency: 'USD' }],
  entities: Array.from({ length: 6 }, (_, index) => ({ id: `page-${index}`, name: index ? `Workshop page ${index}` : 'Foundation Workshop', kind: 'page', summary: 'Workshop registration fee and approved program information.', attributes: {},
    blocks: [{ id: 'body', kind: 'paragraph', text: 'Workshop registration fee information and program background. '.repeat(110) },
      ...(index ? [] : [{ id: 'terms', kind: 'paragraph', text: `${'Read the entire published conditions before relying on a fee. '.repeat(105)}${conditions}` }])] })),
  collections: [{ id: 'pages', name: 'Workshop information', entityIds: Array.from({ length: 6 }, (_, index) => `page-${index}`) }], relationships: [], facts: [], jobs: [], capabilities: [],
});

test('factual-question classification stays bounded for several complete published page records', () => {
  const catalog = fixture(), content = sampleContent('general'), original = JSON.stringify(catalog);
  const authority = publishedWorkspace(content, catalog), workspace = emptyWorkspace(authority.publicationId);
  for (const query of ['What is the fee for Foundation Workshop?', 'Does the workshop charge a registration fee?']) {
    assert.throws(() => retrieveKnowledge(catalog, { revisionId: catalog.id, query, expansion: 1 }), /32,000/, 'the full prose exceeds the unchanged safety limit');
    assert.doesNotThrow(() => planWorkspaceIntent(query, workspace, authority, undefined, catalog));
    const instructions = workspaceInstructions(workspace, authority, undefined, query, catalog, undefined, 'tool');
    const context = JSON.parse(instructions.split('\n').at(-1)!);
    assert.equal(context.directory.filter((entry: { reference: { kind: string } }) => entry.reference.kind === 'entity').length, 6, 'all page references remain discoverable');
    assert.equal(context.knowledge.entities.length, 6);
    assert.equal(context.knowledge.omitted.blocks, 7, 'omitted full prose is explicit rather than represented as complete');
    assert.ok(context.knowledge.entities.every((entity: { blocks?: unknown }) => !entity.blocks));
    assert.ok(Buffer.byteLength(JSON.stringify(context.knowledge)) <= KNOWLEDGE_LIMITS.bytes);
    assert.ok(Buffer.byteLength(JSON.stringify(context.publishedText)) <= PUBLISHED_CONTENT_BYTES);
    assert.ok(context.publishedText.nextOffset !== null, 'more source text remains available through the existing reader');
  }
  assert.deepEqual(workspace.objects, []);
  assert.equal(JSON.stringify(catalog), original, 'classification neither rewrites nor truncates the published records');
});

test('omitting prose during classification preserves complete structured conflicts and qualifications', () => {
  const catalog = fixture();
  catalog.facts = [
    { id: 'fee-a', entityId: 'page-0', field: 'attributes.fee', value: 250 },
    { id: 'fee-b', entityId: 'page-0', field: 'attributes.fee', value: 275 },
    { id: 'fee-waiver', entityId: 'page-0', field: 'properties.registration-fee-waiver', value: true,
      definition: { id: 'registration-fee-waiver', label: 'Registration fee waiver', type: 'boolean' }, qualifiers: [{ predicate: 'requires', value: 'returning student' }] },
  ];
  const authority = publishedWorkspace(sampleContent('general'), catalog), workspace = emptyWorkspace(authority.publicationId), query = 'What is the registration fee for Foundation Workshop?';
  assert.doesNotThrow(() => planWorkspaceIntent(query, workspace, authority, undefined, catalog));
  const context = JSON.parse(workspaceInstructions(workspace, authority, undefined, query, catalog, undefined, 'tool').split('\n').at(-1)!);
  assert.equal(context.knowledge.values.find((value: { field: string }) => value.field === 'attributes.fee').status, 'conflict');
  assert.equal(context.knowledge.values.find((value: { field: string }) => value.field === 'properties.registration-fee-waiver').status, 'qualified');
  assert.deepEqual(context.knowledge.facts.find((fact: { id: string }) => fact.id === 'fee-waiver').qualifiers, [{ predicate: 'requires', value: 'returning student' }]);
  assert.equal(context.knowledge.omitted.facts, 0);
});

test('full source-reference paging retrieves every character including the final fee qualification', () => {
  const catalog = fixture(), authority = publishedWorkspace(sampleContent('general'), catalog);
  const reference = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === 'page-0')!.reference;
  let offset: number | null = 0, pages = 0;
  const blocks = new Map<string, string>();
  do {
    const result = readPublishedContent({ query: '', reference, offset }, authority, catalog); pages++;
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= PUBLISHED_CONTENT_BYTES);
    assert.ok(result.passages.length > 0);
    for (const passage of result.passages) {
      assert.deepEqual(passage.reference, reference);
      assert.equal(passage.start, (blocks.get(passage.blockId) ?? '').length);
      blocks.set(passage.blockId, (blocks.get(passage.blockId) ?? '') + passage.text);
    }
    if (result.nextOffset !== null) assert.ok(result.nextOffset > offset!);
    offset = result.nextOffset;
  } while (offset !== null && pages < 20);
  assert.equal(offset, null);
  assert.ok(pages > 1);
  for (const block of catalog.entities[0].blocks!) assert.equal(blocks.get(block.id), block.text);
  assert.ok(blocks.get('terms')?.endsWith(conditions));
});
