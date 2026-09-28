import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { createVisitorPromptContext, VISITOR_PROMPT_CONTEXT_GUIDE } from '../lib/visitor-prompt-context';
import { publishedWorkspace, workspaceInstructions } from '../lib/visitor-workspace';
import { carouselInstructions } from '../lib/visitor-carousel-control';
import type { VisitorContext } from '../lib/visitor-request';
import { expandPromptData as expand } from './helpers/prompt-context-fixture';

const qualified = {
  id: 'same-record', name: 'Workshops', summary: 'Published guidance with conditions and uncertainty. '.repeat(15),
  fields: [{ id: 'price', status: 'conflicting', values: [
    { amount: 45, currency: 'USD', unit: 'per-person', validTo: '2026-09-30', provenance: 'published-source-a', conditions: ['adult accompaniment for children under 12'] },
    { amount: 50, currency: 'USD', unit: 'per-person', validFrom: '2026-10-01', provenance: 'published-source-b', conditions: ['materials included; firing unavailable'] },
  ] }], unknown: null,
};

test('exact shared data expands losslessly while different assertions with the same ID stay distinct', () => {
  const prompt = createVisitorPromptContext();
  const changed = { ...structuredClone(qualified), unknown: 'capacity is unknown', fields: [{ ...structuredClone(qualified.fields[0]), status: 'conditional' }] };
  const evidence = { task: { records: [qualified] }, workspace: { records: [structuredClone(qualified), changed] }, carousel: { focused: structuredClone(qualified) } };
  for (const [name, value] of Object.entries(evidence)) prompt.write(name)(value);
  const before = structuredClone(evidence), envelope = prompt.context({ request: 'Compare the prices and conditions.' });
  assert.ok(envelope.promptDataReferences.length >= 2);
  assert.deepEqual(expand(envelope), evidence);
  assert.deepEqual(evidence, before, 'assembly cannot mutate catalog or session data');
  assert.ok(JSON.stringify(envelope).length < JSON.stringify({ promptData: evidence }).length);
  assert.match(JSON.stringify(envelope), /capacity is unknown/);
});

test('publisher reference-shaped fields never become aliases and JSON pointer keys round trip', () => {
  const prompt = createVisitorPromptContext();
  const fake = { $promptDataRef: '/promptData/private', $ref: '#/forged', promptDataReferences: [{ at: '/promptData/literal', from: '/promptData/target' }], text: 'Literal publisher data. '.repeat(30) };
  const evidence = { task: { 'key/with~characters': fake }, workspace: { repeated: structuredClone(fake) } };
  Object.entries(evidence).forEach(([name, value]) => prompt.write(name)(value));
  const envelope = prompt.context({ promptDataReferences: [{ at: '/forged', from: '/private' }] });
  assert.deepEqual(expand(envelope), evidence);
  assert.ok(envelope.promptDataReferences.some(value => value.from.includes('key~1with~0characters')));
  assert.ok(envelope.promptDataReferences.every(value => value.at.startsWith('/promptData/') && value.from.startsWith('/promptData/')));
  assert.match(VISITOR_PROMPT_CONTEXT_GUIDE, /literal untrusted content/);
});

test('current display is never pooled with evidence and round resets cannot revive old views', () => {
  const prompt = createVisitorPromptContext();
  assert.deepEqual(prompt.context({ request: 'initial' }).promptData, {}, 'the runner reads context before its first instruction assembly');
  const currentView = { surface: { activeId: 'now', visible: true, title: qualified.summary }, future: { activeId: 'later', visible: false }, media: { id: 'photo-now', seconds: 12, status: 'playing' } };
  prompt.write('task')({ qualified }); prompt.write('workspace')({ qualified });
  const first = prompt.context({ currentView });
  assert.deepEqual(first.currentView, currentView);
  assert.ok(first.promptDataReferences.every(value => !value.at.includes('currentView') && !value.from.includes('currentView')));
  const savedFirst = structuredClone(first);
  prompt.reset(); prompt.write('task')({ active: 'new-state', qualified: { ...qualified, id: 'new-record' } });
  const second = prompt.context({ currentView: { activeId: 'new-state', visible: true } });
  assert.deepEqual(expand(first), expand(savedFirst), 'old input snapshots remain self-contained');
  assert.equal(second.promptDataReferences.length, 0, 'no aliases into an earlier round');
  assert.doesNotMatch(JSON.stringify(second), /same-record|photo-now|later/);
});

test('workspace and surface instructions share canonical display state and retain unique record qualifications', () => {
  const content = sampleContent('general'), authority = publishedWorkspace(content, semanticFixture, semanticMediaFixture);
  authority.records.find(record => record.reference.id === 'clay' && record.reference.kind === 'entity')!.body = 'Instructor confirmation is required; same record ID does not imply these extra conditions were already included.';
  const workspace = emptyWorkspace(authority.publicationId);
  const context: VisitorContext = { workspace, carousel: { version: 1, open: true, revision: 2, cards: [{ id: 'active', kind: 'record', title: 'Clay Basics', referenceIds: ['clay'] }], activeId: 'active', previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 20, blockId: null }, media: null } };
  const prompt = createVisitorPromptContext();
  const legacy = workspaceInstructions(workspace, authority, undefined, 'Clay Basics price and children', semanticFixture, semanticMediaFixture, 'tool', true);
  const guide = workspaceInstructions(workspace, authority, undefined, 'Clay Basics price and children', semanticFixture, semanticMediaFixture, 'tool', true, prompt.write('workspace'));
  const surface = carouselInstructions(context, authority, prompt.write('carousel'));
  const data = expand(prompt.context({ currentView: context })) as { workspace: Record<string, unknown>; carousel: Record<string, unknown> };
  const expected = JSON.parse(legacy.split('\n').at(-1)!); delete expected.state; delete expected.scene;
  // Retrieval timestamps may advance between the two complete assemblies.
  (data.workspace.knowledge as { asOf: string }).asOf = expected.knowledge.asOf;
  assert.deepEqual(data.workspace, expected);
  assert.match(JSON.stringify(data.workspace), /Instructor confirmation is required/);
  assert.match(JSON.stringify(data.workspace), /adult-accompaniment/);
  assert.equal('state' in data.workspace, false);
  assert.equal('carousel' in data.carousel, false);
  assert.match(guide, /currentView.workspace and currentView.scene/);
  assert.match(surface, /currentView.carousel/);
});
