import assert from 'node:assert/strict';

type PromptEnvelope = { promptData: unknown; promptDataReferences: { at: string; from: string }[] };
const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
/** Independent reader: only application-manifest paths expand, never literal
 * publisher fields that happen to resemble a reference. */
export function expandPromptData(envelope: PromptEnvelope) {
  const aliases = new Map(envelope.promptDataReferences.map(value => [value.at, value.from]));
  const get = (path: string): unknown => path.split('/').slice(1).reduce((value: unknown, key) => (value as Record<string, unknown>)[key.replaceAll('~1', '/').replaceAll('~0', '~')], envelope);
  const valueAt = (value: unknown, path: string): unknown => {
    const from = aliases.get(path);
    if (from) { assert.deepEqual(value, { $promptDataRef: from }); return valueAt(get(from), from); }
    if (Array.isArray(value)) return value.map((entry, index) => valueAt(entry, `${path}/${index}`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, valueAt(entry, `${path}/${pointer(key)}`)]));
    return value;
  };
  return valueAt(envelope.promptData, '/promptData');
}

export function taskPromptData(body: { instructions: string; input: { role?: string; content?: string | { text?: string }[] }[] }) {
  const user = body.input.find(item => item.role === 'user');
  const text = typeof user?.content === 'string' ? user.content : user?.content?.find(part => part.text)?.text;
  if (text) {
    const input = JSON.parse(text);
    if (input.promptData?.task) return (expandPromptData(input) as { task: unknown }).task;
  }
  const instructions = [body.instructions, ...body.input.filter(item => item.role === 'developer').map(item => typeof item.content === 'string' ? item.content : item.content?.map(part => part.text ?? '').join('\n') ?? '')].join('\n');
  return JSON.parse(instructions.split('\n').filter(line => line.startsWith('{')).findLast(line => Object.hasOwn(JSON.parse(line), 'activeRecords'))!);
}
