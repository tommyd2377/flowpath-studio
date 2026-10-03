import test from 'node:test';
import assert from 'node:assert/strict';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { pdfTextFromItems } from '../lib/pdf-text';
import { extractSource, interpretSourceWithProvenance, unlinkedSourceProvenance } from '../lib/source-extractors';
import { buildSemanticProviderRequest, interpretRelatedSources } from '../lib/ingestion';

const item = (str: string, x: number, y = 100, extra: Partial<TextItem> = {}): TextItem =>
  ({ str, transform: [12, 0, 0, 12, x, y], width: 24, height: 12, dir: 'ltr', hasEOL: false, fontName: 'fixture', ...extra });
const baseline = (items: (TextItem | TextMarkedContent)[]) => items.map(i => 'str' in i ? `${i.str}${i.hasEOL ? '\n' : ' '}` : '').join('');

test('wide horizontal gaps retain every original string, numeric pair and line break', () => {
  const items = [item('Cake 8/8.24', 0), item(' ', 24, 100, { width: 0, height: 0 }), item('Tiramisu 16/16.48', 90), item('', 0, 80, { hasEOL: true })];
  const before = structuredClone(items), text = pdfTextFromItems(items);
  assert.equal(text, 'Cake 8/8.24\t  Tiramisu 16/16.48 \n');
  assert.equal(text.replace(/\t/g, ' '), baseline(items));
  assert.equal(text.length, baseline(items).length);
  assert.deepEqual(items, before);
});

test('wide price columns remain on the same row and no column relationship is inferred', () => {
  assert.equal(pdfTextFromItems([item('Item', 0), item('23/23.69', 110)]), 'Item\t23/23.69 ');
  assert.equal(pdfTextFromItems([item('Incomplete name', 0), item('21', 110)]), 'Incomplete name\t21 ');
});

const unchanged: [string, TextItem[]][] = [
  ['normal word spacing', [item('BEE', 0), item('STING', 28)]],
  ['touching name and price', [item('SWEET PEPPERS', 0), item('16', 24.058)]],
  ['gap just below threshold', [item('A', 0), item('B', 71.99)]],
  ['explicit line break', [item('A', 0, 100, { hasEOL: true }), item('B', 90)]],
  ['empty explicit line break', [item('A', 0), item('', 0, 80, { hasEOL: true }), item('B', 90)]],
  ['embedded newline', [item('A', 0), item('\n', 24), item('B', 90)]],
  ['existing tab', [item('A', 0), item('\t', 24), item('B', 90)]],
  ['different baselines', [item('A', 0), item('B', 90, 95)]],
  ['backward stream movement', [item('A', 90), item('B', 0)]],
  ['right-to-left text', [item('A', 0, 100, { dir: 'rtl' }), item('B', 90)]],
  ['rotated text', [item('A', 0, 100, { transform: [0, 12, -12, 0, 0, 100] }), item('B', 90)]],
  ['slightly skewed text', [item('A', 0, 100, { transform: [12, 0.00001, 0, 12, 0, 100] }), item('B', 90)]],
  ['nonfinite geometry', [item('A', 0, 100, { width: NaN }), item('B', 90)]],
  ['incomplete geometry', [item('A', 0, 100, { transform: [] }), item('B', 90)]],
  ['zero font height', [item('A', 0, 100, { height: 0 }), item('B', 90)]],
  ['superscript currency marker', [item('$', 0, 104, { height: 7 }), item('3', 90)]],
];
for (const [name, items] of unchanged) test(`PDF spacing leaves ${name} unchanged`, () => assert.equal(pdfTextFromItems(items), baseline(items)));

test('gap threshold scales with text size and ignores non-text content markers', () => {
  for (const scale of [0.25, 1, 2, 10]) {
    const items = [item('A', 0), item('B', 72)].map(i => ({ ...i, transform: i.transform.map((v: number) => v * scale), width: i.width * scale, height: i.height * scale }));
    assert.equal(pdfTextFromItems([{ type: 'beginMarkedContent', id: 'fixture' }, ...items, { type: 'endMarkedContent', id: 'fixture' }]), 'A\tB ');
  }
});

function spacedPdf() {
  const stream = 'BT /F1 12 Tf 1 0 0 1 50 720 Tm (Cake 8/8.24) Tj 1 0 0 1 260 720 Tm (Tiramisu 16/16.48) Tj 1 0 0 1 50 700 Tm (Prices differ by payment method.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

test('actual PDF extraction retains a wide gap through page provenance and the related provider request', async () => {
  const source = await extractSource('synthetic-menu.pdf', 'application/pdf', spacedPdf());
  assert.match(source.text, /Cake 8\/8\.24\t\s*Tiramisu 16\/16\.48[^\n]*\nPrices differ by payment method\./);
  assert.equal((source.text.match(/\t/g) ?? []).length, 1);
  assert.deepEqual(source.pageRanges, [{ page: 1, text: source.text, start: 0, end: source.text.length }]);
  assert.equal(interpretSourceWithProvenance('synthetic-menu.pdf', source), null);
  const provenance = unlinkedSourceProvenance(source), stop = new Error('Offline request captured');
  let callbacks = 0;
  await assert.rejects(interpretRelatedSources([{ sourceId: 'synthetic-menu', name: 'synthetic-menu.pdf', text: source.text, provenance }], async (input, schema) => {
    callbacks++;
    const request = buildSemanticProviderRequest(input, schema, { related: true });
    const sent = JSON.parse(JSON.parse(JSON.stringify(request)).input[0].content).sources[0];
    assert.equal(sent.source, source.text);
    assert.deepEqual(sent.sourceAnchors, provenance.anchors);
    assert.equal(sent.sourceAnchors.map((anchor: { excerpt: string }) => anchor.excerpt).join(''), source.text);
    assert.equal(sent.sourceAnchors[0].pageStart, 1); assert.equal(sent.sourceAnchors[0].pageEnd, 1);
    throw stop;
  }), error => error === stop);
  assert.equal(callbacks, 1);
});
