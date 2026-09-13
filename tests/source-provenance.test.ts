import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSource, interpretSourceWithProvenance, interpretStructuredSource, unlinkedSourceProvenance } from '../lib/source-extractors';
import { MAX_SOURCE_EXCERPT, sourceAnchorSchema, validateSourceProvenance } from '../lib/source-provenance';
import { textPdf } from './knowledge-fixtures';

test('CSV anchors preserve BOM, CRLF, quoted record lines and blank record positions', () => {
  const source = '\uFEFFID,Name,Summary,Price [USD]\r\none,One,"A comma, then\r\na second line",12\r\n\r\ntwo,Two,Plain,\r\n';
  const result = interpretSourceWithProvenance('items.csv', { format: 'csv', text: source })!;
  assert.equal(result.catalog.entities[0].summary, 'A comma, then\r\na second line');
  assert.deepEqual(result.provenance.anchors.map(({ row, lineStart, lineEnd, excerpt }) => ({ row, lineStart, lineEnd, excerpt })), [
    { row: 2, lineStart: 2, lineEnd: 3, excerpt: 'one,One,"A comma, then\r\na second line",12' },
    { row: 4, lineStart: 5, lineEnd: 5, excerpt: 'two,Two,Plain,' },
  ]);
  const first = result.provenance.fields.filter(reference => reference.entityId === 'one');
  assert.deepEqual(first.map(reference => reference.field), ['name', 'summary', 'attributes.price-usd']);
  assert.ok(first.every(reference => reference.anchorIds[0] === 'csv-row-2'));
  assert.ok(!result.provenance.fields.some(reference => reference.field === 'kind'));
  assert.ok(!result.provenance.fields.some(reference => reference.entityId === 'two' && reference.field === 'attributes.price-usd'));
});

test('text anchors use original physical lines across CRLF, separators and missing fields', () => {
  const text = '\uFEFF\r\nTitle: Intro class\r\nCategory: class\r\nDuration: 60\r\n\r\n---\r\n\r\nTitle: Next class\r\nDescription: Bring questions\r\nDuration: 90\r\n';
  const result = interpretSourceWithProvenance('classes.txt', { format: 'text', text })!;
  assert.deepEqual(result.provenance.anchors.map(anchor => [anchor.lineStart, anchor.lineEnd]), [[2, 4], [8, 10]]);
  for (const anchor of result.provenance.anchors) assert.ok(text.includes(anchor.excerpt));
  assert.ok(result.provenance.fields.some(reference => reference.entityId === 'next-class' && reference.field === 'summary'));
});

test('structured text attributes reference the explicit record, never generated default values', () => {
  const text = '\nName: Intro class\r\nKind: class\r\nDuration: 60\r\n\r\n---\r\n\r\nName: Next class\r\nSummary: Bring questions\r\nDuration: 90\r\n';
  const result = interpretSourceWithProvenance('classes.txt', { format: 'text', text })!;
  assert.deepEqual(result.provenance.anchors.map(anchor => [anchor.lineStart, anchor.lineEnd]), [[2, 4], [8, 10]]);
  assert.equal(result.catalog.entities[1].kind, 'item');
  assert.deepEqual(result.provenance.fields.filter(reference => reference.entityId === 'next-class').map(reference => reference.field), ['name', 'attributes.duration', 'summary']);
  assert.deepEqual(interpretStructuredSource('classes.txt', { format: 'text', text })!.entities, result.catalog.entities);
});

test('PDF extraction retains actual page text and structured references cite the right page', async () => {
  const source = await extractSource('classes.pdf', 'application/pdf', textPdf([
    ['Name: Intro class', 'Kind: class', 'Duration: 60'],
    ['Name: Next class', 'Kind: class', 'Duration: 90'],
  ]));
  assert.equal(source.pageRanges?.length, 2);
  for (const page of source.pageRanges!) assert.equal(source.text.slice(page.start, page.end), page.text);
  const result = interpretSourceWithProvenance('classes.pdf', source)!;
  assert.deepEqual(result.provenance.anchors.map(anchor => [anchor.pageStart, anchor.pageEnd]), [[1, 1], [2, 2]]);
  assert.ok(result.provenance.fields.filter(reference => reference.entityId === 'next-class').every(reference => reference.anchorIds[0] === result.provenance.anchors[1].id));
  const fallback = unlinkedSourceProvenance(source);
  assert.deepEqual(fallback.fields, []);
  assert.equal(fallback.anchors[1].excerpt, source.pageRanges![1].text);
});

test('page ranges can span an explicit record, while legacy PDFs never receive guessed field links', () => {
  const first = 'Name: Class\n'; const second = 'Duration: 60'; const text = first + second;
  const result = interpretSourceWithProvenance('class.pdf', { format: 'pdf', pages: 2, text, pageRanges: [
    { page: 1, text: first, start: 0, end: first.length }, { page: 2, text: second, start: first.length, end: text.length },
  ] })!;
  assert.deepEqual([result.provenance.anchors[0].pageStart, result.provenance.anchors[0].pageEnd], [1, 2]);
  const legacy = interpretSourceWithProvenance('old.pdf', { format: 'pdf', pages: 2, text })!;
  assert.deepEqual(legacy.provenance.fields, []);
  assert.equal(legacy.provenance.anchors[0].pageStart, undefined);
  assert.throws(() => interpretSourceWithProvenance('bad.pdf', { format: 'pdf', text, pageRanges: [{ page: 1, text: 'Invented', start: 0, end: 8 }] }), /do not match/);
});

test('free-form prose stays unlinked, with bounded direct excerpts instead of invented evidence', () => {
  const text = 'We teach a mix of beginner and advanced classes.\nAsk us which course fits.\n\nDates and prices vary.\n';
  assert.equal(interpretSourceWithProvenance('classes.txt', { format: 'text', text }), null);
  const provenance = unlinkedSourceProvenance({ format: 'text', text });
  assert.deepEqual(provenance.fields, []);
  assert.deepEqual([provenance.anchors[0].lineStart, provenance.anchors[0].lineEnd], [1, 4]);
  assert.ok(text.includes(provenance.anchors[0].excerpt));
  const long = unlinkedSourceProvenance({ format: 'text', text: 'Publisher prose. '.repeat(200) });
  assert.equal(long.anchors[0].excerpt.length, MAX_SOURCE_EXCERPT);
  assert.ok(long.anchors.every(anchor => !anchor.truncated));
  assert.equal(long.anchors.map(anchor => anchor.excerpt).join(''), 'Publisher prose. '.repeat(200));
});

test('shortened record excerpts never claim to show the supporting text for hidden fields', () => {
  const summary = 'a'.repeat(1590);
  const text = `Name,Summary,Price [USD]\nExample,"${summary}",42`;
  const result = interpretSourceWithProvenance('long.csv', { format: 'csv', text })!;
  assert.equal(result.catalog.entities[0].attributes['price-usd'], 42);
  assert.equal(result.provenance.anchors[0].truncated, true);
  assert.ok(!result.provenance.anchors[0].excerpt.includes(',42'));
  assert.deepEqual(result.provenance.fields, []);
  assert.throws(() => validateSourceProvenance({ ...result.provenance, fields: [{ entityId: 'example', field: 'attributes.price-usd', anchorIds: [result.provenance.anchors[0].id] }] }, result.catalog), /complete source excerpts/);
});

test('private validation rejects fabricated references, invalid ranges and duplicate mappings', () => {
  const result = interpretSourceWithProvenance('items.csv', { format: 'csv', text: 'Name,Color\nOne,Blue' })!;
  assert.deepEqual(validateSourceProvenance(result.provenance, result.catalog), result.provenance);
  assert.throws(() => validateSourceProvenance({ ...result.provenance, anchors: [...result.provenance.anchors, result.provenance.anchors[0]] }));
  assert.throws(() => validateSourceProvenance({ ...result.provenance, fields: [...result.provenance.fields, result.provenance.fields[0]] }));
  for (const reference of [
    { entityId: 'missing', field: 'name', anchorIds: ['csv-row-2'] },
    { entityId: 'one', field: 'attributes.missing', anchorIds: ['csv-row-2'] },
    { entityId: 'one', field: 'name', anchorIds: ['invented'] },
    { entityId: 'one', field: 'name', anchorIds: ['csv-row-2', 'csv-row-2'] },
    { entityId: 'one', field: 'capabilities.checkout', anchorIds: ['csv-row-2'] },
  ]) assert.throws(() => validateSourceProvenance({ ...result.provenance, fields: [reference] }, result.catalog));
  assert.throws(() => sourceAnchorSchema.parse({ ...result.provenance.anchors[0], lineEnd: 1 }));
  assert.throws(() => sourceAnchorSchema.parse({ ...result.provenance.anchors[0], pageStart: 1, pageEnd: 1 }));
});

test('wide catalogs reuse one anchor per record and remain below the private artifact budget', () => {
  const text = ['ID,Name,Kind,' + Array.from({ length: 24 }, (_, index) => `Attribute ${index}`).join(','),
    ...Array.from({ length: 100 }, (_, index) => `${index},Item ${index},offering,${Array(24).fill('Known').join(',')}`)].join('\n');
  const result = interpretSourceWithProvenance('wide.csv', { format: 'csv', text })!;
  assert.equal(result.provenance.anchors.length, 100);
  assert.equal(result.provenance.fields.length, 2600);
  assert.ok(Buffer.byteLength(JSON.stringify({ catalog: result.catalog, baseline: result.catalog, provenance: result.provenance })) < 700_000);
});
