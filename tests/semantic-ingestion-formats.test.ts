import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { z } from 'zod';
import { projectKnowledgeCatalog, retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { parseSemanticProviderReply, semanticReplyJsonSchema } from '../lib/ingestion';
import { extractSource, unlinkedSourceProvenance } from '../lib/source-extractors';
import { mergeKnowledge } from '../lib/knowledge-model';
import { catalogForPublication, refreshAssertionReviews, resolveAssertionReviews } from '../lib/knowledge-assertions';
import { textPdf } from './knowledge-fixtures';

// Synthetic source text and hand-authored extraction oracles. These exercise
// real format readers and compilation, not a live model's extraction quality.
const corpus = [
  { title: 'Willow Loop', kind: 'trail', lines: ['Willow Loop is a walking trail.', 'Its distance is 2.4 km.', 'The trailhead is at 14 Sample Road.'],
    assertions: [
      { predicate: 'distance', label: 'Distance', type: 'number', value: 2.4, unit: 'km', scope: 'attribute', expectedField: 'attributes.distance', quote: '2.4 km' },
      { predicate: 'address', label: 'Trailhead', type: 'text', value: '14 Sample Road', scope: 'property', expectedField: 'properties.address', quote: '14 Sample Road' },
    ] },
  { title: 'Cedar Soup', kind: 'dish', lines: ['Cedar Soup is a prepared dish.', 'The listed price is USD 8.50.', 'Contains nuts: false.'],
    assertions: [
      { predicate: 'price', label: 'Price', type: 'money', value: 8.5, currency: 'USD', scope: 'attribute', expectedField: 'attributes.price', quote: 'USD 8.50' },
      { predicate: 'contains-nuts', label: 'Contains nuts', type: 'boolean', value: false, scope: 'property', expectedField: 'properties.contains-nuts', quote: 'false' },
    ] },
  { title: 'Introductory Ceramics', kind: 'course', lines: ['Introductory Ceramics is a course.', 'The course begins on 2026-10-05.', 'No previous experience is required.'],
    assertions: [
      { predicate: 'start-date', label: 'Start date', type: 'date', value: '2026-10-05', scope: 'property', expectedField: 'properties.start-date', quote: '2026-10-05' },
      { predicate: 'experience-required', label: 'Experience required', type: 'boolean', value: false, scope: 'property', expectedField: 'properties.experience-required', quote: 'No previous experience' },
    ] },
  { title: 'Evening Workshop', kind: 'event', lines: ['Evening Workshop is an event.', 'Children are not admitted unless accompanied by an adult.', 'The attendee limit has not been announced.'],
    assertions: [
      { predicate: 'children-admitted', label: 'Children admitted', type: 'boolean', value: true, scope: 'property', expectedField: 'properties.children-admitted', quote: 'unless accompanied',
        metadata: { polarity: 'denied', qualifiers: [{ predicate: 'unless', value: 'Accompanied by an adult' }] }, expectedStatus: 'qualified' },
      { predicate: 'attendee-limit', label: 'Attendee limit', type: 'number', value: null, scope: 'property', expectedField: 'properties.attendee-limit', quote: 'not been announced', expectedStatus: 'unknown' },
    ] },
  { title: 'Bench Instrument', kind: 'instrument', lines: ['Bench Instrument is a measuring instrument.', 'Operating power is 12 W, valid from 2026-09-01 to 2026-09-30, observed 2026-09-10.', 'Estimated output uses the unevaluated formula SUM(A1:A2).'],
    assertions: [
      { predicate: 'power', label: 'Operating power', type: 'number', value: 12, unit: 'W', scope: 'attribute', expectedField: 'attributes.power', quote: '12 W',
        metadata: { validFrom: '2026-09-01', validTo: '2026-09-30', observedAt: '2026-09-10' } },
      { predicate: 'estimated-output', label: 'Estimated output', type: 'number', value: null, scope: 'property', expectedField: 'properties.estimated-output', quote: 'SUM(A1:A2)', metadata: { expression: 'SUM(A1:A2)' }, expectedStatus: 'unknown' },
    ] },
];

function zip(files: Record<string, string>): Uint8Array {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(text); const checksum = crc32(data);
    const header = Buffer.alloc(30 + nameBytes.length); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(header, 30);
    const record = Buffer.alloc(46 + nameBytes.length); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42); nameBytes.copy(record, 46);
    local.push(header, data); central.push(record); offset += header.length + data.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function document(format: string, lines: string[]): { mime: string; bytes: Uint8Array } {
  if (format === 'pdf') return { mime: 'application/pdf', bytes: textPdf([[lines[0], lines[1]], lines.slice(2)]) };
  if (format === 'txt') return { mime: 'text/plain', bytes: Buffer.from(lines.join('\n')) };
  if (format === 'html') return { mime: 'text/html', bytes: Buffer.from(`<html><body>${lines.map(line => `<p>${escape(line)}</p>`).join('')}</body></html>`) };
  if (format === 'docx') return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: zip({
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(line => `<w:p><w:r><w:t>${escape(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  }) };
  return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: zip({
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Source" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${lines.map((line, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${escape(line)}</t></is></c></row>`).join('')}</sheetData></worksheet>`,
  }) };
}

const wireSchema = z.fromJSONSchema(semanticReplyJsonSchema() as Parameters<typeof z.fromJSONSchema>[0]);
for (const [index, entry] of corpus.entries()) for (const format of ['pdf', 'txt', 'html', 'docx', 'xlsx']) {
  test(`${format}: ${entry.kind} source compiles into reviewed graph facts and existing displays`, async () => {
    // Filename deliberately carries no topic or entity identity.
    const filename = `upload-${index}.${format}`; const file = document(format, entry.lines);
    const source = await extractSource(filename, file.mime, file.bytes);
    const provenance = unlinkedSourceProvenance(source);
    assert.equal(source.format, format === 'txt' ? 'text' : format);
    for (const line of entry.lines) assert.ok(source.text.includes(line), `${format}: ${line}`);
    if (format === 'pdf') assert.equal(source.pages, 2);
    const facts = entry.assertions.map((assertion, factIndex) => ({ id: `fact-${factIndex}`, entityId: 'item',
      confidence: null, validFrom: null, validTo: null, observedAt: null, polarity: null, qualifiers: null, expression: null,
      ...('metadata' in assertion ? assertion.metadata : {}), target: { scope: assertion.scope, value: assertion.value, definition: {
        id: assertion.predicate, label: assertion.label, type: assertion.type, unit: 'unit' in assertion ? assertion.unit : null, currency: 'currency' in assertion ? assertion.currency : null,
      } } }));
    const evidence = entry.assertions.map((assertion, factIndex) => {
      const anchor = provenance.anchors.find(anchor => !anchor.truncated && anchor.excerpt.includes(assertion.quote));
      assert.ok(anchor, `No exact source anchor for ${assertion.quote}`);
      return { factId: `fact-${factIndex}`, anchorIds: [anchor.id] };
    });
    const envelope = { complete: true, issues: [], name: entry.title, description: '', attributes: [],
      entities: [{ id: 'item', name: entry.title, kind: entry.kind, summary: entry.lines[0], aliases: null, identifiers: null, blocks: null, attributes: [] }],
      collections: [], relationships: [], jobs: [], facts, evidence };
    assert.ok(wireSchema.safeParse(envelope).success, 'the full generated wire contract accepts the fixture');
    const parsed = parseSemanticProviderReply(JSON.stringify(envelope), provenance);
    let artifact = mergeKnowledge(null, parsed.catalog, { fileId: randomUUID(), name: filename, hash: 'synthetic', provenance: parsed.provenance, modelInterpreted: true });
    artifact.assertionReviews = refreshAssertionReviews(artifact, 'model');
    assert.equal(artifact.catalog.schemaVersion, 1);
    assert.equal(artifact.assertionReviews.filter(review => review.targetType === 'fact' && review.support === 'anchored').length, facts.length);
    assert.throws(() => catalogForPublication(artifact), /Review unsupported assertions/, 'unreviewed identity fields must still be reviewed');
    // Simulate the publisher's review only against these synthetic artifacts.
    artifact = resolveAssertionReviews(artifact, artifact.assertionReviews.map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: 'approve' })));
    const published = catalogForPublication(artifact);
    const result = retrieveKnowledge(published, { revisionId: published.id, entityIds: [published.entities[0].id], asOf: '2026-09-12', expansion: 0 });
    const display = projectKnowledgeCatalog(published, '2026-09-12');
    for (const assertion of entry.assertions) {
      const fact = published.facts!.find(fact => fact.field === assertion.expectedField)!;
      assert.ok(fact); assert.equal(fact.value, assertion.value);
      const selected = result.values.find(value => value.field === assertion.expectedField)!;
      const expectedStatus = 'expectedStatus' in assertion ? assertion.expectedStatus : 'known';
      assert.equal(selected.status, expectedStatus);
      if (expectedStatus === 'known') assert.equal(selected.value, assertion.value);
      if (assertion.scope === 'attribute') assert.equal(display.entities[0].attributes[assertion.predicate], assertion.value);
      if ('metadata' in assertion) for (const [key, value] of Object.entries(assertion.metadata!)) assert.deepEqual(fact[key as keyof typeof fact], value);
    }
    assert.deepEqual(published.capabilities, []);
    assert.ok(!JSON.stringify(result).includes('anchorIds'));
    assert.ok(!JSON.stringify(result).includes(filename));
  });
}
