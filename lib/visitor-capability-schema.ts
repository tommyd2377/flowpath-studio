type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
const object = (value: Json): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const schemaMaps = new Set(['$defs', 'definitions', 'dependentSchemas', 'dependencies', 'patternProperties', 'properties']);
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const schemaValues = new Set(['additionalProperties', 'additionalItems', 'contains', 'contentSchema', 'else', 'if', 'items', 'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties']);
const referenceKeys = new Set(['$ref', '$id', '$anchor', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor']);

/** Clone JSON without invoking accessors, toJSON, or inherited properties. Undefined object fields follow JSON.stringify. */
function safeJson(input: unknown): Json {
  const ancestors = new Set<object>(); let nodes = 0, bytes = 0;
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 50_000 || depth > 64) throw new Error('Capability schemas exceed traversal bounds.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { bytes += Buffer.byteLength(value); if (bytes > 1_000_000) throw new Error('Capability schemas exceed byte bounds.'); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('Capability schemas must contain finite, acyclic JSON.');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Capability schemas require plain JSON objects.');
    if (Array.isArray(value) && value.length > 50_000) throw new Error('Capability schemas exceed traversal bounds.');
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key === 'symbol') || Object.values(descriptors).some(descriptor => descriptor.get || descriptor.set)) throw new Error('Capability schemas cannot contain accessors or symbols.');
    const result: Json = Array.isArray(value) ? Array.from({ length: value.length }, (_, position) => visit(descriptors[String(position)]?.value ?? null, depth + 1))
      : Object.fromEntries(Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable && descriptor.value !== undefined).map(([key, descriptor]) => {
        bytes += Buffer.byteLength(key); if (bytes > 1_000_000) throw new Error('Capability schemas exceed byte bounds.');
        return [key, visit(descriptor.value, depth + 1)];
      }));
    ancestors.delete(value); return result;
  }
  return visit(input, 0);
}
function hasReference(value: Json): boolean {
  return Array.isArray(value) ? value.some(hasReference) : object(value) && Object.entries(value).some(([key, child]) => referenceKeys.has(key) || hasReference(child));
}
function schemaChildren(schema: JsonObject, visit: (schema: Json) => Json): JsonObject {
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if (schemaMaps.has(key) && object(value)) return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, Array.isArray(child) ? child : visit(child)]))];
    if (schemaArrays.has(key) && Array.isArray(value) || key === 'items' && Array.isArray(value)) return [key, value.map(visit)];
    return [key, schemaValues.has(key) ? visit(value) : value];
  }));
}

/** Lossless model-context compression only; runtime capability validators remain unchanged. */
export function compactCapabilitySchemas(descriptors: readonly object[]): { capabilities: JsonObject[]; $defs: Record<string, JsonObject>; capabilityDefaults?: JsonObject } {
  const cloned = safeJson(descriptors);
  if (!Array.isArray(cloned) || cloned.some(value => !object(value))) throw new Error('Capability descriptors must be JSON objects.');
  let capabilities = cloned as JsonObject[];
  const counts = new Map<string, number>(), names = new Map<string, string>(), definitions: Record<string, JsonObject> = {};
  const occupied = new Set<string>();
  function rememberKeys(value: Json) {
    if (Array.isArray(value)) value.forEach(rememberKeys);
    else if (object(value)) for (const [key, child] of Object.entries(value)) { occupied.add(key); if (typeof child === 'string') occupied.add(child.replace(/^#\/\$defs\//, '')); rememberKeys(child); }
  }
  rememberKeys(cloned);
  function count(schema: Json): Json {
    if (!object(schema) || hasReference(schema)) return schema;
    const key = JSON.stringify(schema);
    if (Buffer.byteLength(key) >= 40) counts.set(key, (counts.get(key) ?? 0) + 1);
    schemaChildren(schema, count); return schema;
  }
  for (const capability of capabilities) if (capability.inputSchema !== undefined) count(capability.inputSchema);
  let sequence = 0;
  function compact(schema: Json): Json {
    if (!object(schema) || hasReference(schema)) return schema;
    const key = JSON.stringify(schema);
    const occurrences = counts.get(key) ?? 0;
    if (occurrences < 2 || (occurrences - 1) * Buffer.byteLength(key) - occurrences * 28 - 8 < 0) return schemaChildren(schema, compact);
    let name = names.get(key);
    if (!name) {
      if (names.size >= 256) return schemaChildren(schema, compact);
      do { name = `s${sequence++}`; } while (occupied.has(name));
      occupied.add(name); names.set(key, name);
      definitions[name] = schemaChildren(schema, compact);
    }
    return { $ref: `#/$defs/${name}` };
  }
  capabilities = capabilities.map(capability => Object.fromEntries(Object.entries(capability).map(([key, value]) => [key, key === 'inputSchema' ? compact(value) : value])));
  // Nested repeats may become single-use after a repeated parent moves into a definition.
  function rewrite(value: Json, name: string, replacement: JsonObject): Json {
    if (Array.isArray(value)) return value.map(child => rewrite(child, name, replacement));
    if (!object(value)) return value;
    if (Object.keys(value).length === 1 && value.$ref === `#/$defs/${name}`) return replacement;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child, name, replacement)]));
  }
  let removed = true;
  while (removed) {
    removed = false;
    for (const name of Object.keys(definitions)) {
      // Earlier inlining rewrites later definitions during this pass. Read the
      // current value, not an Object.entries snapshot with already-removed refs.
      const definition = definitions[name];
      const reference = JSON.stringify({ $ref: `#/$defs/${name}` });
      const serialized = JSON.stringify({ capabilities, $defs: definitions });
      const occurrences = serialized.split(reference).length - 1;
      const saving = (occurrences - 1) * Buffer.byteLength(JSON.stringify(definition)) - occurrences * Buffer.byteLength(reference) - Buffer.byteLength(JSON.stringify(name)) - 2;
      if (occurrences > 1 && saving > 0) continue;
      capabilities = rewrite(capabilities, name, definition) as JsonObject[];
      delete definitions[name];
      for (const [key, value] of Object.entries(definitions)) definitions[key] = rewrite(value, name, definition) as JsonObject;
      removed = true;
    }
  }
  // Repeated descriptor metadata is exact shared data, not a relaxed validator.
  // Only factor present primitive values; exceptions remain explicit overrides.
  const capabilityDefaults: JsonObject = {};
  for (const key of ['authorization', 'demoOnly']) {
    const value = capabilities[0]?.[key];
    if (!['string', 'boolean'].includes(typeof value) || !capabilities.every(capability => Object.hasOwn(capability, key))) continue;
    const duplicates = capabilities.filter(capability => capability[key] === value).length;
    if (duplicates < 3) continue;
    capabilityDefaults[key] = value;
    capabilities = capabilities.map(capability => capability[key] === value ? Object.fromEntries(Object.entries(capability).filter(([property]) => property !== key)) : capability);
  }
  return { capabilities, $defs: definitions, ...(Object.keys(capabilityDefaults).length ? { capabilityDefaults } : {}) };
}
