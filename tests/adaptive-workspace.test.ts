import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceBatch, emptyWorkspace, resolveWorkspaceTarget, validateWorkspace, type WorkspaceState, type WorkspaceScene } from '@thevoice/platform-ui/workspace';
import { validatePlan } from '@thevoice/platform-ui/contracts';
import { semanticFixture as catalog, semanticMediaFixture as media } from '../fixtures/semantic-knowledge/graph';
import { sampleContent, contentSchema as siteContentSchema } from '../lib/site-model';
import { DEFAULT_OPENING, publicationContent } from '../lib/site-opening';
import { objectInput, openingWorkspace, parseWorkspaceReply, planWorkspaceIntent, publishedWorkspace, workspaceBatch, workspaceFact, workspaceFromPlan, workspaceInstructions } from '../lib/visitor-workspace';
import { validateVisitorContext } from '../lib/visitor-realtime-context';
import { getWelcomeMessage, pruneGreeting, validateGreeting } from '../lib/site-greeting';
import { SITE_PALETTES } from '../lib/site-style';
import { applyCommand } from '../lib/site-commands';
import { initialSite } from '../lib/local-store';

const content = publicationContent(sampleContent('general', 'Harbor Studio'));
const authority = publishedWorkspace(content, catalog, media);
const record = (kind: string, id: string) => authority.records.find(record => record.reference.kind === kind && record.reference.id === id)!;
const fresh = () => emptyWorkspace(authority.publicationId);
const add = (state: WorkspaceState, kind: string, id: string, instance?: string) => applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: objectInput(record(kind, id), record(kind, id).component, instance) }]), authority).state;
function scene(state: WorkspaceState): WorkspaceScene {
  return { revision: 1, workspaceRevision: state.revision, focusedId: state.focusedId, visibility: 'visible', objects: state.objects.map((object, index) => ({ selected: object.selected, expanded: object.expanded, instanceId: object.instanceId, name: authority.records.find(record => record.reference.id === object.references[0].id)!.name,
    references: object.references, order: index + 1, mounted: true, open: true, visibility: 'full', position: index % 2 ? 'right' : 'left', rect: { x: index % 2 * 300, y: 10, width: 250, height: 200 }, controls: ['focus', 'close'], scroll: null })) };
}
function intent(state: WorkspaceState, text: string) {
  const currentScene = scene(state), reply = planWorkspaceIntent(text, state, authority, currentScene, catalog, media);
  assert.ok(reply.batch, reply.message);
  return applyWorkspaceBatch(state, reply.batch, authority, currentScene.revision).state;
}
test('new/republished snapshots are intro-only; legacy and selected references remain available', () => {
  assert.equal(openingWorkspace(authority, content).objects.length, 0);
  assert.ok(openingWorkspace(authority, sampleContent('general')).objects.length > 0);
  const selected = { ...content, opening: { ...DEFAULT_OPENING, visibility: 'publisher-selected' as const, featuredEntityIds: ['blue', 'white'], initialAssetIds: ['blue-photo'], initialAlbumIds: ['items'] } };
  const state = openingWorkspace(authority, selected);
  assert.deepEqual(state.objects.flatMap(object => object.references.map(ref => ref.id)).sort(), ['blue', 'blue-photo', 'items', 'white']);
});
test('address → email → collection photo → map is additive and scoped closing keeps everything else', () => {
  let state = intent(fresh(), 'Show me the address');
  state = intent(state, 'Show me the email too');
  state = intent(state, 'Show Items collection');
  state = intent(state, 'Open the first photo from Items collection');
  const photo = state.focusedId!;
  state = intent(state, 'Show a map too');
  assert.equal(state.objects.length, 5);
  state = intent(state, 'Make that photo bigger');
  assert.equal(state.objects.find(object => object.instanceId === photo)?.expanded, true);
  state = intent(state, 'Close the map but keep the photo');
  assert.equal(state.objects.length, 4); assert.equal(state.focusedId, photo);
  state = intent(state, "I'm done with this photo");
  assert.equal(state.objects.length, 3);
  assert.ok(state.objects.some(object => object.references[0].id === 'address'));
  assert.ok(state.objects.some(object => object.references[0].id === 'email'));
});
test('reopening identical content reuses its surface; nested return preserves per-object state', () => {
  let state = add(add(fresh(), 'entity', 'blue', 'first'), 'entity', 'white', 'second');
  state = add(state, 'entity', 'blue', 'third');
  assert.equal(state.objects.length, 2); assert.equal(state.objects.some(object => object.instanceId === 'third'), false);
  state = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'focus', instanceId: 'first' }, { kind: 'expand', instanceId: 'first' }, { kind: 'scroll', instanceId: 'first', scrollTop: 200 }, { kind: 'select', instanceId: 'first', selected: true }, { kind: 'focus', instanceId: 'second' }]), authority).state;
  state = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'return' }]), authority).state;
  assert.equal(state.focusedId, 'first'); assert.equal(state.objects[0].expanded, true); assert.equal(state.objects[0].scrollTop, 200); assert.equal(state.objects[0].selected, true);
  state = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'close', instanceId: 'second' }]), authority).state;
  assert.equal(state.focusedId, 'first'); assert.equal(state.objects.length, 1);
});
test('batch atomicity, duplicate delivery, conflicts, stale scene/manual revisions and publication identity', () => {
  const initial = fresh(), batch = workspaceBatch(initial, [{ kind: 'add', object: objectInput(record('fact', 'address')) }]);
  const accepted = applyWorkspaceBatch(initial, batch, authority).state;
  assert.equal(applyWorkspaceBatch(accepted, batch, authority).status, 'duplicate');
  assert.throws(() => applyWorkspaceBatch(accepted, { ...batch, operations: [{ kind: 'reset', objects: [] }] }, authority), /conflicting/);
  assert.throws(() => applyWorkspaceBatch(accepted, { ...batch, requestId: 'later' }, authority), /workspace changed/);
  assert.throws(() => applyWorkspaceBatch(initial, { ...batch, sceneRevision: 2 }, authority, 3), /workspace changed/);
  assert.throws(() => applyWorkspaceBatch(initial, { ...batch, publicationId: 'old' }, authority), /publication changed/);
  assert.throws(() => applyWorkspaceBatch(initial, { ...batch, operations: [...batch.operations, { kind: 'focus', instanceId: 'missing' }] }, authority), /no longer open/);
  assert.deepEqual(initial, fresh());
});
test('invalid/private/revision-mismatched references, unsafe IDs and invented capabilities fail closed', () => {
  const base = objectInput(record('entity', 'blue'));
  for (const object of [{ ...base, instanceId: 'x()' }, { ...base, references: [{ ...base.references[0], id: 'private-draft' }] }, { ...base, references: [{ ...base.references[0], revisionId: 'old' }] }, { ...base, component: 'actions' }]) {
    assert.throws(() => applyWorkspaceBatch(fresh(), workspaceBatch(fresh(), [{ kind: 'add', object: object as typeof base }]), authority));
  }
  assert.throws(() => validateWorkspace({ ...fresh(), focusedId: 'missing' }, authority));
});
test('closing every object tolerates layout-only changes but still rejects changed workspace ownership', () => {
  const state = add(add(add(fresh(), 'entity', 'blue', 'first'), 'entity', 'white', 'second'), 'photo', 'blue-photo', 'third');
  const focused = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'focus', instanceId: 'first' }, { kind: 'focus', instanceId: 'second' }]), authority).state;
  const groups = [
    [{ kind: 'reset' as const, objects: [] }],
    [{ kind: 'replace' as const, objects: [] }],
    focused.objects.map(object => ({ kind: 'close' as const, instanceId: object.instanceId })),
  ];
  for (const operations of groups) {
    const batch = workspaceBatch(focused, operations, crypto.randomUUID(), 1);
    const cleared = applyWorkspaceBatch(focused, batch, authority, 9).state;
    assert.deepEqual(cleared.objects, []); assert.equal(cleared.focusedId, null); assert.deepEqual(cleared.focusHistory, []);
    assert.equal(applyWorkspaceBatch(cleared, batch, authority, 10).status, 'duplicate');
    const changed = add(focused, 'fact', 'address', 'new-item');
    assert.throws(() => applyWorkspaceBatch(changed, batch, authority, 9), /workspace changed/);
    assert.throws(() => applyWorkspaceBatch(focused, { ...batch, publicationId: 'old-publication' }, authority, 9), /publication changed/);
  }
  const partial = workspaceBatch(focused, [{ kind: 'close', instanceId: 'first' }], 'close-spatial-subset', 1);
  assert.throws(() => applyWorkspaceBatch(focused, partial, authority, 9), /workspace changed/);
  const mixed = workspaceBatch(focused, [{ kind: 'reset', objects: [] }, { kind: 'add', object: objectInput(record('fact', 'address')) }], 'replace-from-old-scene', 1);
  assert.throws(() => applyWorkspaceBatch(focused, mixed, authority, 9), /workspace changed/);
  assert.equal(focused.objects.length, 3);
});
test('capacity never silently evicts and explicit replacement/reset stay deterministic', () => {
  let state = fresh(); for (const record of authority.records.slice(0, 12)) state = add(state, record.reference.kind, record.reference.id);
  const overflow = authority.records[12];
  assert.throws(() => add(state, overflow.reference.kind, overflow.reference.id), /nothing was removed/);
  assert.equal(state.objects.length, 12);
  state = intent(state, 'Replace everything with the address'); assert.equal(state.objects.length, 1);
  state = intent(state, 'Clear workspace'); assert.equal(state.objects.length, 0);
});
test('ambiguity and actual spatial visibility are distinguished from retained offscreen objects', () => {
  let state = add(add(fresh(), 'entity', 'blue'), 'entity', 'white');
  const observed = scene(state);
  assert.equal(resolveWorkspaceTarget(state, observed, 'that one'), null);
  assert.equal(resolveWorkspaceTarget(state, observed, 'the one on the left'), state.objects[0].instanceId);
  observed.objects[0].visibility = 'offscreen';
  assert.equal(resolveWorkspaceTarget(state, observed, 'the one on the left'), null);
  assert.equal(resolveWorkspaceTarget(state, observed, 'second'), state.objects[1].instanceId);
  observed.visibility = 'hidden'; assert.equal(resolveWorkspaceTarget(state, observed, 'second'), null);
  state = intent(state, 'Show Items collection');
  assert.equal(planWorkspaceIntent('Open this photo from that collection', state, authority, scene(state), catalog, media).batch, undefined);
});
test('photo membership preserves album order and unsupported entity imagery is honest', () => {
  assert.equal(record('album', 'items').members?.[0].id, 'blue-photo');
  assert.equal(intent(fresh(), 'Show photos of Blue Bowl').objects[0].references[0].id, 'blue-photo');
  assert.equal(planWorkspaceIntent('Show photos of White Bowl', fresh(), authority, undefined, catalog, media).batch, undefined);
});
test('graph values keep qualified, unknown and temporal facts instead of invented certainty', () => {
  assert.match(workspaceFact(catalog, 'address')!.value.display, /12 Example Lane/);
  assert.notEqual(workspaceFact(catalog, 'latitude')!.value.status, 'known');
  assert.match(workspaceFact(catalog, 'child-policy')!.value.display, /12|adult/);
  assert.equal(workspaceFact(catalog, 'october-price', '2026-10-02')!.value.value, 50);
  const instructions = workspaceInstructions(fresh(), authority, undefined, 'address and email', catalog, media);
  assert.match(instructions, /hello@harbor.example/); assert.doesNotMatch(instructions, /sourceArtifacts|correctionHistory|origins/);
});
test('v1 compatibility is explicit; instance plans support two details and preserve collection filters', () => {
  const component = { id: 'detail', type: 'detail' as const, variant: 'expanded' as const, entityIds: ['blue'], attributeIds: [] };
  const legacy = { schemaVersion: 1, snapshotId: catalog.id, operation: 'understand', components: [component], transition: { type: 'none' } };
  validatePlan(legacy, catalog, catalog.id);
  assert.throws(() => validatePlan({ ...legacy, components: [{ ...component, id: 'one' }] }, catalog, catalog.id));
  const instances = { ...legacy, identityMode: 'instances', components: [{ ...component, id: 'one' }, { ...component, id: 'two', entityIds: ['white'] }] };
  const state = applyWorkspaceBatch(fresh(), workspaceFromPlan(JSON.parse(JSON.stringify(instances)), fresh(), authority, catalog), authority).state;
  assert.deepEqual(state.objects.map(object => object.instanceId), ['one', 'two']);
  const batch = workspaceFromPlan({ ...legacy, components: [{ id: 'collection', type: 'collection', variant: 'grid', entityIds: [], attributeIds: ['price'], collectionId: 'offerings' }], stateUpdate: { filters: [{ attributeId: 'price', operator: 'lte', value: 50 }] } }, fresh(), authority, catalog);
  assert.equal(applyWorkspaceBatch(fresh(), batch, authority).state.objects[0].filters[0].value, 50);
  assert.throws(() => applyWorkspaceBatch(fresh(), workspaceBatch(fresh(), [{ kind: 'add', object: { instanceId: 'bad-comparison', component: 'comparison', references: [record('entity', 'harbor').reference, record('entity', 'mira').reference] } }]), authority), /shared published/);
});
test('scene context revalidates labels, child and modal references; disabled external content is rejected', () => {
  const state = add(fresh(), 'fact', 'address'), observed = scene(state);
  // Keep only the structural scene schema, never application state fields.
  observed.objects = observed.objects.map(({ instanceId, order, name, references, open, mounted, visibility, position, rect, selected, expanded, controls, scroll }) => ({ instanceId, order, name, references, open, mounted, visibility, position, rect, selected, expanded, controls, scroll }));
  observed.objects[0].name = 'Untrusted invented label';
  const result = validateVisitorContext({ workspace: { ...state, receipts: [] }, scene: observed }, content, catalog, media);
  assert.equal(result.scene!.objects[0].name, 'Address · Harbor Studio');
  assert.throws(() => validateVisitorContext({ workspace: state, scene: { ...observed, workspaceRevision: 400 } }, content, catalog, media));
  assert.throws(() => validateVisitorContext({ workspace: state, scene: { ...observed, modal: { kind: 'photo', reference: { kind: 'photo', id: 'private', revisionId: media.id }, selectedId: 'private' } } }, content, catalog, media));
  assert.throws(() => validateVisitorContext({ workspace: state, externalResults: [{ resultId: 'external-one', kind: 'images', images: [], selectedImageId: null, map: null }] }, content, catalog, media));
  assert.throws(() => parseWorkspaceReply({ batch: { ...workspaceBatch(state, [{ kind: 'return' }]), publicationId: 'old' }, clarification: '' }, state, authority));
  const grouped = applyWorkspaceBatch(fresh(), workspaceBatch(fresh(), [{ kind: 'add', object: { instanceId: 'grouped', component: 'collection', references: [record('entity', 'blue').reference, record('entity', 'white').reference] } }]), authority).state;
  const groupScene = scene(grouped);
  groupScene.objects[0].items = [{ reference: record('entity', 'blue').reference, order: 1, visible: true }];
  assert.ok(validateVisitorContext({ workspace: grouped, scene: groupScene }, content, catalog, media));
  const detail = add(fresh(), 'entity', 'blue'), detailScene = scene(detail);
  detailScene.objects[0].items = [{ reference: record('photo', 'blue-photo').reference, order: 1, visible: true }];
  assert.ok(validateVisitorContext({ workspace: detail, scene: detailScene }, content, catalog, media));
  detailScene.objects[0].items[0].reference = record('fact', 'address').reference;
  assert.throws(() => validateVisitorContext({ workspace: detail, scene: detailScene }, content, catalog, media));
});
test('three optional spoken points preserve legacy greeting, prune missing refs and validate approved text', () => {
  assert.equal(getWelcomeMessage({ ...content, welcomeMessage: 'Existing custom welcome.' }), 'Existing custom welcome.');
  const points = { ...content, greetingPoints: [{ kind: 'fact' as const, id: 'address' }, null, { kind: 'custom' as const, text: 'Explore at your own pace' }] };
  validateGreeting(points, catalog); assert.match(getWelcomeMessage(points, catalog), /12 Example Lane.*Explore at your own pace/);
  assert.equal(pruneGreeting(points, { ...catalog, facts: [] }).greetingPoints?.[0], null);
  assert.throws(() => validateGreeting(points, null), /no longer available/);
  assert.equal(siteContentSchema.parse(points).greetingPoints?.length, 3);
});
test('three fixed palettes and three layouts retain readable primary and muted text', () => {
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  for (const [palette, value] of Object.entries(SITE_PALETTES)) for (const text of [value.text, value.muted, value.accent]) for (const background of [value.background, value.surface]) {
    const levels = [luminance(text), luminance(background)].sort((a, b) => b - a);
    assert.ok((levels[0] + .05) / (levels[1] + .05) >= 4.5, `${palette} ${text}`);
  }
  for (const layout of ['balanced', 'editorial', 'compact']) for (const palette of Object.keys(SITE_PALETTES)) assert.ok(siteContentSchema.parse({ ...content, style: { layout, palette } }));
  assert.throws(() => siteContentSchema.parse({ ...content, style: { layout: 'freeform', palette: 'custom' } }));
});

test('spoken selections and presets persist through Save/Publish and source pruning is reversible by Undo', () => {
  const site = initialSite('photographer');
  const chosen = { ...site.draft, greetingPoints: [{ kind: 'source' as const, id: 'section:weddings' }, null, { kind: 'custom' as const, text: 'Publisher-approved phrase.' }], style: { layout: 'editorial' as const, palette: 'forest' as const }, visitorSpeaksFirst: true };
  applyCommand(site, { action: 'save', revision: site.revision, content: chosen });
  applyCommand(site, { action: 'publish', revision: site.revision });
  assert.deepEqual(site.published!.greetingPoints, chosen.greetingPoints); assert.deepEqual(site.published!.style, chosen.style);
  assert.equal(site.published!.visitorSpeaksFirst, true);
  applyCommand(site, { action: 'save', revision: site.revision, content: { ...site.draft, sections: [] } });
  assert.equal(site.draft.greetingPoints![0], null); assert.deepEqual(site.published!.greetingPoints, chosen.greetingPoints);
  applyCommand(site, { action: 'undo', revision: site.revision });
  assert.deepEqual(site.draft.greetingPoints, chosen.greetingPoints);
  assert.deepEqual(site.draft.style, chosen.style);
});
