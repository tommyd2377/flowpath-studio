import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseSemanticProviderReply, semanticReplyJsonSchema } from '../lib/ingestion';
import type { SourceProvenance } from '../lib/source-provenance';
import { AppError } from '../lib/errors';

const source: SourceProvenance = { anchors: [
  { id: 'page-1', format: 'pdf', label: 'Page 1', excerpt: 'Harbor Studio offers classes.', pageStart: 1, pageEnd: 1 },
  { id: 'page-2', format: 'pdf', label: 'Page 2', excerpt: 'Clay Basics is taught at Harbor Studio.', pageStart: 2, pageEnd: 2 },
], fields: [] };
function reply() {
  return { complete: true, issues: [] as string[], name: 'Example', description: '', attributes: [],
    entities: [{ id: 'harbor', kind: 'business', name: 'Harbor Studio', summary: 'Offers classes.', attributes: [] },
      { id: 'clay', kind: 'class', name: 'Clay Basics', summary: '', attributes: [] }],
    collections: [], relationships: [], facts: [], evidence: [], jobs: [] };
}
const parse = (value: unknown, provenance = source) => parseSemanticProviderReply(JSON.stringify(value), provenance);

test('provider schema constrains IDs, labels and kinds before generation to the accepted catalog bounds', () => {
  const schema = semanticReplyJsonSchema() as { properties: Record<string, Record<string, unknown>> };
  const entities = schema.properties.entities.items as { properties: Record<string, Record<string, unknown>> };
  assert.equal(entities.properties.id.pattern, '^[A-Za-z0-9][A-Za-z0-9_-]*$');
  assert.equal(entities.properties.kind.maxLength, 64, 'the earlier wire contract incorrectly allowed 80');
  assert.equal(entities.properties.name.minLength, 1);
  assert.equal(schema.properties.name.minLength, 1);
  assert.throws(() => parse({ ...reply(), entities: [{ ...reply().entities[0], id: 'not a valid id' }] }), /unsupported format/);
});

test('the generated JSON Schema itself permits exactly one complete citation target', () => {
  const schema = semanticReplyJsonSchema() as { properties: Record<string, Record<string, unknown>> };
  // Reconstruct solely from the JSON sent to the provider: local superRefine
  // checks are absent here, which is the gap the live PDF attempt exposed.
  const wireEvidence = z.fromJSONSchema(schema.properties.evidence);
  const values = { entityId: 'harbor', field: 'summary', factId: 'summary-fact', relationshipId: 'taught-at' };
  const base = { ...reply(), facts: [{ id: 'summary-fact', entityId: 'harbor', target: { field: 'summary', value: 'Offers classes.' } }],
    relationships: [{ id: 'taught-at', fromEntityId: 'clay', toEntityId: 'harbor', label: 'Taught at' }] };
  for (let combination = 80; combination >= 0; combination--) {
    let remaining = combination;
    const target: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(values)) {
      const presence = remaining % 3; remaining = Math.floor(remaining / 3);
      if (presence) target[key] = presence === 1 ? null : value;
    }
    const keys = Object.keys(target).sort().join(',');
    const valid = Object.values(target).every(value => value !== null)
      && ['entityId,field', 'factId', 'relationshipId'].includes(keys);
    const evidence = [{ ...target, anchorIds: ['page-1'] }];
    assert.equal(wireEvidence.safeParse(evidence).success, valid, JSON.stringify(target));
    if (valid) assert.doesNotThrow(() => parse({ ...base, evidence }));
    else assert.throws(() => parse({ ...base, evidence }), /exactly one/, JSON.stringify(target));
  }
  assert.equal(wireEvidence.safeParse([{ entityId: 'harbor', field: 'summary', anchorIds: ['page-1'], extra: 'not allowed' }]).success, false);
});

test('generated fact targets bind their definition and value type without a second field identifier', () => {
  const wire = z.fromJSONSchema(semanticReplyJsonSchema() as Parameters<typeof z.fromJSONSchema>[0]);
  const common = { id: 'fact', entityId: 'harbor', confidence: null, validFrom: null, validTo: null, observedAt: null, polarity: null, qualifiers: null, expression: null };
  const envelope = (target: unknown) => ({ ...reply(), entities: reply().entities.map(entity => ({ ...entity, aliases: null, identifiers: null, blocks: null })), facts: [{ ...common, target }] });
  const cases = [
    { type: 'text', value: 'hello@example.test', wrong: false, currency: null },
    { type: 'number', value: 4.5, wrong: '4.5', currency: null },
    { type: 'money', value: 12, wrong: 'USD 12', currency: 'USD' },
    { type: 'date', value: '2026-09-12', wrong: 'Saturday', currency: null },
    { type: 'boolean', value: false, wrong: 'false', currency: null },
  ];
  for (const sample of cases) for (const scope of ['property', 'attribute']) {
    const definition = { id: 'arbitrary-field', label: 'Publisher field', type: sample.type, unit: null, currency: sample.currency };
    const target = { scope, definition, value: sample.value };
    for (const value of [sample.value, null]) {
      assert.ok(wire.safeParse(envelope({ ...target, value })).success, `${scope}/${sample.type}`);
      const result = parse(envelope({ ...target, value })).catalog;
      assert.equal(result.facts?.[0].field, `${scope === 'property' ? 'properties' : 'attributes'}.arbitrary-field`);
      assert.equal(result.facts?.[0].value, value);
      assert.equal(result.facts?.[0].definition?.id, scope === 'property' ? 'arbitrary-field' : undefined);
    }
    for (const invalid of [{ ...target, definition: null }, { ...target, value: sample.wrong }, { ...target, field: 'properties.a-different-id' }]) {
      assert.equal(wire.safeParse(envelope(invalid)).success, false, JSON.stringify(invalid));
      assert.throws(() => parse(envelope(invalid)), /matching field definition|declared type|unsupported format/);
    }
  }
  for (const field of ['name', 'kind', 'summary']) {
    assert.ok(wire.safeParse(envelope({ field, value: 'Source text' })).success);
    for (const target of [{ field, value: 1 }, { field, value: 'Text', definition: null }, { scope: 'property', field, value: 'Text' }]) assert.equal(wire.safeParse(envelope(target)).success, false);
  }
});

test('definition typing rejects missing currencies and incompatible metadata before generation', () => {
  const schema = semanticReplyJsonSchema() as { properties: Record<string, Record<string, unknown>> };
  const wire = z.fromJSONSchema(schema.properties.attributes);
  for (const invalid of [
    { type: 'money', unit: null, currency: null }, { type: 'money', unit: null, currency: 'usd' },
    { type: 'number', unit: null, currency: 'USD' }, { type: 'text', unit: 'km', currency: null },
    { type: 'boolean', unit: null, currency: 'USD' }, { type: 'date', unit: 'hours', currency: null },
  ]) assert.equal(wire.safeParse([{ id: 'field', label: 'Field', ...invalid }]).success, false);
});

test('shared definitions register once, preserve assertions and reject conflicts or overflow', () => {
  const definition = { id: 'length', label: 'Length', type: 'number', unit: 'km', currency: null };
  const facts = reply().entities.map((entity, index) => ({ id: `fact-${index}`, entityId: entity.id, target: { scope: 'attribute', definition, value: index + 1 } }));
  const result = parse({ ...reply(), facts }).catalog;
  assert.deepEqual(result.attributes, [{ id: 'length', label: 'Length', type: 'number', unit: 'km' }]);
  assert.ok(result.entities.every(entity => entity.attributes.length === null));
  assert.deepEqual(result.facts?.map(fact => fact.value), [1, 2]);
  for (const changed of [{ ...definition, type: 'text', unit: null }, { ...definition, unit: 'miles' }, { ...definition, type: 'money', currency: 'USD' }]) {
    assert.throws(() => parse({ ...reply(), attributes: [changed], facts }), /conflicting types, units or currencies/);
  }
  const manyFacts = Array.from({ length: 25 }, (_, index) => ({ ...facts[0], id: `fact-${index}`, target: { ...facts[0].target, definition: { ...definition, id: `dimension-${index}` } } }));
  assert.equal(parse({ ...reply(), facts: manyFacts.slice(0, 24) }).catalog.attributes.length, 24);
  assert.throws(() => parse({ ...reply(), facts: manyFacts }), /supported limit/);
  assert.throws(() => parse({ ...reply(), facts: [{ ...facts[0], entityId: 'not-returned' }] }), /unavailable or invalid item/);
  assert.throws(() => parse({ ...reply(), attributes: [definition, definition] }), /repeated identifiers/);
});

test('fact compilation preserves qualifications, unknowns and time while refusing computed formulas', () => {
  const target = { scope: 'property', definition: { id: 'capacity', label: 'Capacity', type: 'number', unit: null, currency: null }, value: null };
  const fact = { id: 'unknown', entityId: 'harbor', target, expression: 'SUM(A1:A2)', observedAt: '2026-09-12', validFrom: '2026-09-01', validTo: '2026-09-30',
    confidence: .7, polarity: 'denied', qualifiers: [{ predicate: 'unless', value: 'Accompanied by staff' }] };
  const compiled = parse({ ...reply(), facts: [fact] }).catalog.facts![0];
  assert.deepEqual(compiled, { id: fact.id, entityId: fact.entityId, field: 'properties.capacity', value: null, definition: { id: 'capacity', label: 'Capacity', type: 'number' },
    expression: fact.expression, observedAt: fact.observedAt, validFrom: fact.validFrom, validTo: fact.validTo, confidence: fact.confidence, polarity: fact.polarity, qualifiers: fact.qualifiers });
  assert.throws(() => parse({ ...reply(), facts: [{ ...fact, target: { ...target, value: 3 } }] }), /formula/);
  assert.throws(() => parse({ ...reply(), facts: [{ ...fact, validTo: '2026-08-30' }] }), /date or validity range/);
});

test('redundant model aliases preserve distinct identity labels without rejecting the catalog', () => {
  const result = parse({ ...reply(), entities: [{ ...reply().entities[0], aliases: ['Harbor Studio', 'HARBOR STUDIO', 'Harbor', 'Harbor', 'Port School'] }] });
  assert.deepEqual(result.catalog.entities[0].aliases, ['Harbor', 'Port School']);
});

test('separate evidence entries coalesce by exact target without losing source anchors', () => {
  const facts = [{ id: 'class-fact', entityId: 'harbor', target: { field: 'summary', value: 'Offers classes.' } }];
  const relationships = [{ id: 'located-at', fromEntityId: 'clay', toEntityId: 'harbor', label: 'Taught at' }];
  const evidence = [
    { entityId: 'harbor', field: 'summary', anchorIds: ['page-1', 'page-1'] },
    { entityId: 'harbor', field: 'summary', anchorIds: ['page-2'] },
    { factId: 'class-fact', anchorIds: ['page-1'] }, { factId: 'class-fact', anchorIds: ['page-2', 'page-1'] },
    { relationshipId: 'located-at', anchorIds: ['page-1'] }, { relationshipId: 'located-at', anchorIds: ['page-2'] },
  ];
  const result = parse({ ...reply(), facts, relationships, evidence });
  assert.deepEqual(result.provenance?.fields, [{ entityId: 'harbor', field: 'summary', anchorIds: ['page-1', 'page-2'] }, { entityId: 'harbor', field: 'name', anchorIds: ['page-1', 'page-2'] }, { entityId: 'clay', field: 'name', anchorIds: ['page-2'] }]);
  assert.deepEqual(result.provenance?.facts, [{ targetId: 'class-fact', anchorIds: ['page-1', 'page-2'] }]);
  assert.deepEqual(result.provenance?.relationships, [{ targetId: 'located-at', anchorIds: ['page-1', 'page-2'] }]);
  assert.deepEqual(source.anchors.map(anchor => anchor.id), ['page-1', 'page-2']);
});

test('coalescing citations never bypasses missing, truncated, ambiguous or oversized evidence checks', () => {
  const base = reply();
  const entry = { entityId: 'harbor', field: 'summary', anchorIds: ['page-1'] };
  assert.throws(() => parse({ ...base, evidence: [entry, { ...entry, anchorIds: ['missing'] }] }), /source evidence.*citation/);
  assert.throws(() => parse({ ...base, evidence: [entry] }, { ...source, anchors: [{ ...source.anchors[0], truncated: true }] }), /source evidence.*citation/);
  assert.throws(() => parse({ ...base, evidence: [{ ...entry, factId: 'ambiguous' }] }), /exactly one/);
  const anchors = Array.from({ length: 9 }, (_, index) => ({ ...source.anchors[0], id: `anchor-${index}` }));
  assert.throws(() => parse({ ...base, evidence: anchors.map(anchor => ({ ...entry, anchorIds: [anchor.id] })) }, { anchors, fields: [] }), /source evidence.*limit/);
  assert.throws(() => parse({ ...base, evidence: [{ entityId: 'missing', field: 'summary', anchorIds: ['page-1'] }] }), /source evidence.*citation/);
});

test('provider failures retain actionable categories without echoing source values or unknown keys', () => {
  const secret = 'private-document-text-must-not-appear';
  assert.throws(() => parse({ ...reply(), [secret]: secret }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.match(error.message, /unsupported field/);
    assert.ok(!error.message.includes(secret));
    assert.equal(error.status, 502);
    return true;
  });
  assert.throws(() => parse({ ...reply(), facts: [{ id: 'email', entityId: 'harbor', target: { scope: 'property', value: secret, definition: null } }] }), /matching field definition/);
  assert.throws(() => parse({ ...reply(), facts: [{ id: 'number', entityId: 'harbor', target: { scope: 'property', value: secret,
    definition: { id: 'count', label: 'Count', type: 'number', unit: null, currency: null } } }] }), /declared type/);
  assert.throws(() => parse({ ...reply(), entities: [reply().entities[0], reply().entities[0]] }), /repeated identifiers/);
  assert.throws(() => parseSemanticProviderReply(`{"private":"${secret}`), /unreadable structured data/);
});

test('incomplete output keeps its explanation and cannot become a saved catalog', () => {
  assert.throws(() => parse({ ...reply(), complete: false, issues: ['Too many records for one response.'] }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.match(error.message, /incomplete.*Too many records/);
    assert.equal(error.status, 422);
    return true;
  });
  assert.throws(() => parseSemanticProviderReply(' '.repeat(300_001)), /pilot limit/);
});

test('nullable wire properties retain unknown fact values and remove only optional nulls', () => {
  const result = parse({ ...reply(), entities: [{ ...reply().entities[0], aliases: null, identifiers: null }],
    facts: [{ id: 'unknown', entityId: 'harbor', confidence: null, validFrom: null,
      target: { scope: 'property', value: null, definition: { id: 'capacity', label: 'Capacity', type: 'number', unit: null, currency: null } } }],
    evidence: [{ entityId: 'harbor', field: 'summary', anchorIds: ['page-1'] }] });
  assert.equal(result.catalog.facts?.[0].value, null);
  assert.equal(result.catalog.facts?.[0].confidence, undefined);
  assert.equal(result.catalog.facts?.[0].definition?.unit, undefined);
  assert.deepEqual(result.provenance?.fields[0].anchorIds, ['page-1']);
});


test('literal name locations do not infer types, facts, substring matches or truncated evidence', () => {
  const input = { ...reply(), entities: [{ ...reply().entities[0], name: 'Oregon' }] };
  const result = parse(input, { anchors: [{ ...source.anchors[0], excerpt: 'Oregonian coast' }, { ...source.anchors[1], excerpt: 'Oregon', truncated: true }], fields: [] });
  assert.deepEqual(result.provenance?.fields, []);
  const exact = parse(input, { anchors: [{ ...source.anchors[0], excerpt: 'Visit Oregon, then Idaho.' }], fields: [] });
  assert.deepEqual(exact.provenance?.fields, [{ entityId: 'harbor', field: 'name', anchorIds: ['page-1'] }]);
  assert.deepEqual(exact.catalog.entities[0].attributes, {});
});
