import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { compactCapabilitySchemas } from '../lib/visitor-capability-schema';
import { visitorCapabilities } from '../lib/visitor-capabilities';

function expand(compact: ReturnType<typeof compactCapabilitySchemas>): unknown {
  function visit(value: unknown, ancestors: string[] = []): unknown {
    if (Array.isArray(value)) return value.map(child => visit(child, ancestors));
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value), reference = (value as Record<string, unknown>).$ref;
    if (entries.length === 1 && typeof reference === 'string' && reference.startsWith('#/$defs/')) {
      const name = reference.slice('#/$defs/'.length);
      if (Object.hasOwn(compact.$defs, name)) {
        assert.ok(!ancestors.includes(name), 'Shared definitions must not create cycles');
        return visit(compact.$defs[name], [...ancestors, name]);
      }
    }
    return Object.fromEntries(entries.map(([key, child]) => [key, visit(child, ancestors)]));
  }
  return visit(compact.capabilities.map(capability => ({ ...compact.capabilityDefaults, ...capability })));
}
const shared = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$', description: 'Use an exact published identifier, preserving the declared field, record and publication scope.' };
const schema = { type: 'object', properties: { first: shared, second: shared }, required: ['first', 'second'], additionalProperties: false };

test('shared schema references expand exactly and preserve descriptors, descriptions and schema-map positions', () => {
  const input = Array.from({ length: 4 }, (_, i) => ({ id: `capability-${i}`, purpose: `Purpose ${i}`, inputSchema: structuredClone(schema) }));
  const original = structuredClone(input), compact = compactCapabilitySchemas(input);
  assert.deepEqual(expand(compact), original);
  assert.deepEqual(input, original);
  assert.ok(Object.keys(compact.$defs).length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify({ capabilities: input })));
  for (const definition of Object.values(compact.$defs)) {
    if (definition.properties) assert.equal(Object.hasOwn(definition.properties as object, '$ref'), false, 'A properties map is not itself a schema reference');
  }
  assert.deepEqual(compactCapabilitySchemas(input), compact, 'Definition names are deterministic');
});

test('nested array/map schema positions deduplicate but literal defaults and examples remain unchanged', () => {
  const inputSchema = { type: 'object', properties: {
    list: { type: 'array', items: schema, default: [{ payload: shared }], examples: [{ payload: shared }] },
    choice: { anyOf: [schema, { type: 'null' }] },
    extra: { type: 'object', additionalProperties: schema },
  }, $defs: { s0: { type: 'boolean' } } };
  const input = [{ id: 'one', inputSchema }, { id: 'two', inputSchema }], compact = compactCapabilitySchemas(input);
  assert.deepEqual(expand(compact), input);
  assert.equal(Object.hasOwn(compact.$defs, 's0'), false, 'Generated definitions cannot collide with existing definition names');
  assert.ok(JSON.stringify(compact).includes('"default":[{"payload":{"type":"string"'), 'Literal example data is not rewritten as schema references');
});

test('inlining a shared parent uses its updated nested definitions rather than deleted references', () => {
  const leaf = { type: 'string', description: 'A published value that appears in more than one repeated schema.', minLength: 1, maxLength: 120 };
  const items = { anyOf: [{ type: 'object', properties: { code: leaf }, required: ['code'] }, { type: 'object', properties: { label: leaf }, required: ['label'] }] };
  const parent = { type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 24, items } }, required: ['operations'], additionalProperties: false };
  const input = [{ id: 'query.patch', inputSchema: parent }, { id: 'query.compare', inputSchema: structuredClone(parent) }];
  const compact = compactCapabilitySchemas(input);
  assert.deepEqual(expand(compact), input);
  const generatedReferences = JSON.stringify(compact).match(/#\/\$defs\/s\d+/g) ?? [];
  assert.ok(generatedReferences.every(reference => Object.hasOwn(compact.$defs, reference.slice('#/$defs/'.length))), 'Every emitted generated reference must still have a definition');
});

test('shared capability metadata restores exactly while demo-only exceptions stay explicit', () => {
  const input = Array.from({ length: 5 }, (_, i) => ({ id: `capability-${i}`, authorization: 'published', demoOnly: i === 4, inputSchema: schema }));
  const compact = compactCapabilitySchemas(input);
  assert.deepEqual(compact.capabilityDefaults, { authorization: 'published', demoOnly: false });
  assert.equal(compact.capabilities[4].demoOnly, true);
  assert.deepEqual(expand(compact), input);
  const missing = input.map((capability, i) => i ? capability : { id: capability.id, inputSchema: capability.inputSchema });
  assert.equal(compactCapabilitySchemas(missing).capabilityDefaults, undefined, 'An absent metadata field must not acquire an inherited value');
});

test('existing references and scope anchors remain opaque and keep their original resolution', () => {
  for (const keyword of ['$ref', '$id', '$anchor', '$dynamicRef', '$recursiveRef']) {
    const anchored = { ...schema, [keyword]: '#/$defs/s0', $defs: { s0: schema } };
    const input = [{ id: 'anchored', inputSchema: anchored }, { id: 'again', inputSchema: anchored }, ...Array.from({ length: 4 }, (_, i) => ({ id: `ordinary-${i}`, inputSchema: schema }))];
    const compact = compactCapabilitySchemas(input);
    assert.deepEqual(compact.capabilities[0].inputSchema, anchored);
    assert.deepEqual(expand(compact), input);
    assert.equal(Object.hasOwn(compact.$defs, 's0'), false);
  }
});

test('JSON cloning rejects executable/cyclic/oversized values without invoking accessors or prototypes', () => {
  let called = 0;
  const accessor = Object.defineProperty({}, 'inputSchema', { enumerable: true, get() { called++; return schema; } });
  assert.throws(() => compactCapabilitySchemas([accessor]), /accessors/);
  assert.equal(called, 0);
  assert.throws(() => compactCapabilitySchemas([{ inputSchema: new Date() }]), /plain JSON/);
  assert.throws(() => compactCapabilitySchemas([{ inputSchema: { toJSON() { called++; return {}; } } }]), /JSON/);
  assert.equal(called, 0);
  const cycle: Record<string, unknown> = {}; cycle.child = cycle;
  assert.throws(() => compactCapabilitySchemas([{ inputSchema: cycle }]), /acyclic/);
  let deep: unknown = {}; for (let i = 0; i < 66; i++) deep = { child: deep };
  assert.throws(() => compactCapabilitySchemas([{ inputSchema: deep }]), /traversal bounds/);
  assert.throws(() => compactCapabilitySchemas([{ inputSchema: new Array(50_001) }]), /traversal bounds/);
  assert.throws(() => compactCapabilitySchemas([{ inputSchema: { description: 'x'.repeat(1_000_001) } }]), /byte bounds/);
  const poisoned = JSON.parse('{"id":"safe","inputSchema":{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"}}},"__proto__":{"polluted":true}}');
  assert.deepEqual(expand(compactCapabilitySchemas([poisoned])), [poisoned]);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

for (const demo of [true, false]) test(`actual ${demo ? 'demo' : 'published'} capability schemas roundtrip with at least 5KB saved`, t => {
  const descriptors = [...visitorCapabilities.values()].filter(value => value.descriptor.id !== 'query.command' && (demo || !value.descriptor.demoOnly)).map(value => {
    const inputSchema = z.toJSONSchema(value.input, { unrepresentable: 'any', io: 'input' });
    if (inputSchema.properties?.records) inputSchema.properties.records = { type: 'array', maxItems: 0, description: 'Supply an empty array and bind a server-owned records handle to this input.' };
    return { id: value.descriptor.id, purpose: value.descriptor.purpose, effect: value.descriptor.effect, outputType: value.descriptor.outputType, authorization: value.descriptor.authorization, demoOnly: value.descriptor.demoOnly, inputSchema };
  });
  const originals = JSON.parse(JSON.stringify(descriptors)), compact = compactCapabilitySchemas(descriptors);
  assert.deepEqual(expand(compact), originals);
  const before = Buffer.byteLength(JSON.stringify({ capabilities: originals })), after = Buffer.byteLength(JSON.stringify(compact));
  assert.ok(before - after >= 5_000, `${before} -> ${after}`);
  t.diagnostic(`${before} -> ${after} bytes; ${before - after} saved; ${Object.keys(compact.$defs).length} shared definitions`);
});
