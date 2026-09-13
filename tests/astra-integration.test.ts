import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeFacts, retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { objectInput, planWorkspaceIntent, publishedWorkspace, workspaceBatch, workspaceFact, workspaceLocation } from '../lib/visitor-workspace';
import { interpretSourceWithProvenance } from '../lib/source-extractors';

test('integration: relationship-only questions retrieve endpoints and preserve direction and conditions', () => {
  const graph = structuredClone(semanticFixture);
  graph.relationships = [{ id: 'mentor', fromEntityId: 'mira', toEntityId: 'glaze', kind: 'mentors', label: 'Mentors', qualifiers: [{ predicate: 'during', value: 'summer' }] }];
  const result = retrieveKnowledge(graph, { revisionId: graph.id, query: 'Who mentors?', intent: 'relationships', expansion: 1 });
  assert.deepEqual(result.relationships.map(edge => [edge.fromEntityId, edge.toEntityId, edge.qualifiers]), [['mira', 'glaze', [{ predicate: 'during', value: 'summer' }]]]);
  const detail = retrieveKnowledge(graph, { revisionId: graph.id, entityIds: ['mira'], expansion: 1 });
  assert.equal(detail.relationships[0]?.qualifiers?.[0].value, 'summer', 'a detail can explain a conditional neighbor without asserting an unconditional link');
});

test('integration: an actual structured import supports independent address and email objects', () => {
  const source = interpretSourceWithProvenance('contact.csv', { format: 'csv', text: 'Name,Kind,Address,Email\nHarbor Studio,business,12 Example Lane,hello@harbor.example' })!;
  assert.ok(source.provenance.fields.some(field => field.field === 'attributes.address'));
  const authority = publishedWorkspace(sampleContent('general'), source.catalog);
  let state = emptyWorkspace(authority.publicationId);
  for (const query of ['Show me the address', 'Show me the email too']) {
    const reply = planWorkspaceIntent(query, state, authority, undefined, source.catalog);
    assert.ok(reply.batch, reply.message);
    state = applyWorkspaceBatch(state, reply.batch, authority).state;
  }
  assert.equal(state.objects.length, 2);
  assert.ok(state.objects.every(object => object.component === 'information' && object.references[0].kind === 'fact'));
  assert.deepEqual(state.objects.map(object => workspaceFact(source.catalog, object.references[0].id)?.value.value), ['12 Example Lane', 'hello@harbor.example']);
});

test('integration: a map request never picks an arbitrary publisher or a photo example as its location', () => {
  const graph = structuredClone(semanticFixture);
  graph.facts!.push({ id: 'other-address', entityId: 'white', field: 'properties.address', value: '99 Other Street', definition: { id: 'address', label: 'Address', type: 'text' } });
  const content = sampleContent('general');
  const authority = publishedWorkspace(content, graph, semanticMediaFixture);
  const state = emptyWorkspace(authority.publicationId);
  assert.equal(planWorkspaceIntent('Show a map too', state, authority, undefined, graph, semanticMediaFixture).batch, undefined, 'two locations require clarification');
  const photo = authority.records.find(record => record.reference.kind === 'photo')!;
  const object = objectInput(photo);
  const focused = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object }, { kind: 'focus', instanceId: object.instanceId }]), authority).state;
  const reply = planWorkspaceIntent('Show a map too', focused, authority, undefined, graph, semanticMediaFixture);
  assert.ok(reply.batch, reply.message);
  const next = applyWorkspaceBatch(focused, reply.batch, authority).state;
  assert.equal(next.objects.find(object => object.component === 'map')?.references[0].id, 'blue', 'map follows the reviewed depicted subject');
  const example = structuredClone(semanticMediaFixture); example.associations[0].role = 'example';
  assert.equal(planWorkspaceIntent('Show a map too', focused, authority, undefined, graph, example).batch, undefined, 'example does not establish the photo location');
});

test('integration: deictic collection requests need the acknowledged scene and matching collection', () => {
  const authority = publishedWorkspace(sampleContent('general'), semanticFixture, semanticMediaFixture);
  const state = emptyWorkspace(authority.publicationId);
  assert.equal(planWorkspaceIntent('Open the first photo from that collection', state, authority, undefined, semanticFixture, semanticMediaFixture).batch, undefined, 'no current collection must not open every album');
});

test('integration: map fields share one location and preserve conditional addresses', () => {
  const graph = structuredClone(semanticFixture);
  graph.facts!.find(fact => fact.id === 'latitude')!.value = 40;
  graph.facts!.find(fact => fact.id === 'longitude')!.value = -73;
  graph.facts!.push(
    { id: 'other-address', entityId: 'white', field: 'properties.address', value: '99 Other Street', definition: { id: 'address', label: 'Address', type: 'text' }, qualifiers: [{ predicate: 'valid-only', value: 'weekends' }] },
    { id: 'other-latitude', entityId: 'white', field: 'properties.latitude', value: 50, definition: { id: 'latitude', label: 'Latitude', type: 'number' } },
    { id: 'other-longitude', entityId: 'white', field: 'properties.longitude', value: 10, definition: { id: 'longitude', label: 'Longitude', type: 'number' } },
  );
  const other = workspaceLocation(graph, 'white');
  assert.match(other.address, /99 Other Street.*weekends/);
  assert.deepEqual([other.latitude, other.longitude], [50, 10]);
  assert.deepEqual(workspaceLocation(graph, 'blue'), { address: '12 Example Lane, Brooklyn, NY', latitude: 40, longitude: -73 });
  graph.relationships.push({ id: 'second-location', fromEntityId: 'blue', toEntityId: 'white', kind: 'displayed-at', label: 'Displayed at' });
  assert.equal(workspaceLocation(graph, 'blue').latitude, null, 'two supported locations never collapse to the first match');
});

test('integration: narrow fact retrieval survives oversized detail context and keeps every competing assertion', () => {
  const graph = structuredClone(semanticFixture);
  for (let i = 0; i < 23; i++) {
    graph.attributes.push({ id: `long-${i}`, label: `Long field ${i}`, type: 'text' });
    graph.entities.find(entity => entity.id === 'blue')!.attributes[`long-${i}`] = 'Long approved description. '.repeat(35);
  }
  assert.throws(() => retrieveKnowledge(graph, { revisionId: graph.id, entityIds: ['blue'], expansion: 0 }), /32,000/);
  const fact = knowledgeFacts(graph).find(fact => fact.entityId === 'blue' && fact.field === 'attributes.long-0')!;
  assert.equal(workspaceFact(graph, fact.id)?.value.value, 'Long approved description. '.repeat(35));
  const conflicting = structuredClone(semanticFixture);
  conflicting.facts!.push({ id: 'other-price', entityId: 'clay', field: 'attributes.price', value: 99 });
  assert.equal(workspaceFact(conflicting, 'september-price', '2026-09-12')?.value.status, 'conflict');
  const october = workspaceFact(semanticFixture, 'september-price', '2026-10-02')!;
  assert.equal(october.value.value, 50);
  assert.deepEqual(october.period, { validFrom: '2026-10-01', validTo: undefined }, 'resolved value must not be labelled with an old assertion validity period');
});
