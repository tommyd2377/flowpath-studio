/** Provider wire schemas require every property, with null for optional values.
 * Keep runtime optional fields backwards compatible and validate them with Zod. */
export function strictJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, strictJsonSchema(child)]));
  if (result.type === 'object' && result.properties) {
    const required = new Set(result.required as string[] ?? []);
    const properties = result.properties as Record<string, unknown>;
    for (const key of Object.keys(properties)) if (!required.has(key)) properties[key] = { anyOf: [properties[key], { type: 'null' }] };
    result.required = Object.keys(properties); result.additionalProperties = false;
  }
  // Zod 4 emits oneOf for discriminated unions. The provider supports anyOf;
  // the original Zod schema still enforces the exact runtime union after generation.
  if (Array.isArray(result.oneOf) && !result.anyOf) { result.anyOf = result.oneOf; delete result.oneOf; }
  delete result.$schema;
  return result;
}
export function omitOptionalNulls(value: unknown, schema: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(item => omitOptionalNulls(item, (schema.items ?? {}) as Record<string, unknown>));
  if (!value || typeof value !== 'object') return value;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return value;
  const required = new Set(schema.required as string[] ?? []);
  return Object.fromEntries(Object.entries(value).filter(([key, child]) => !(child === null && Object.hasOwn(properties, key) && !required.has(key)))
    .map(([key, child]) => [key, omitOptionalNulls(child, properties[key] ?? {})]));
}
