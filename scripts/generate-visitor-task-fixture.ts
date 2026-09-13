import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { taskFixture, publisherVocabularies } from '../fixtures/visitor-tasks';

const { values } = parseArgs({ options: { records: { type: 'string', default: '10000' }, vocabulary: { type: 'string', default: '0' }, output: { type: 'string', default: '/private/tmp/flowpath-visitor-10000.jsonl' } } });
const count = Number(values.records), vocabulary = Number(values.vocabulary);
if (!Number.isInteger(count) || count < 3 || count > 10000 || !Number.isInteger(vocabulary) || !publisherVocabularies[vocabulary]) throw new Error('Use 3–10000 records and vocabulary 0–6.');
const space = taskFixture(publisherVocabularies[vocabulary], count);
const metadata = { version: space.version, name: space.name, rootId: space.rootId, fields: space.fields, relationshipTypes: space.relationshipTypes, collections: space.collections, edges: space.edges };
const lines = [JSON.stringify(metadata)];
for (let offset = 0; offset < count; offset += 100) {
  const records = space.records.slice(offset, offset + 100), ids = new Set(records.map(record => record.id));
  lines.push(JSON.stringify({ records, memberships: space.memberships.filter(member => ids.has(member.recordId)), relationships: offset === 0 ? space.relationships : [] }));
}
const output = resolve(values.output); await writeFile(output, `${lines.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
console.log(`Created ${count} synthetic records for ${space.name}: ${output}`);
