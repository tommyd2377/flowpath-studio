import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sourceFileReportSchema } from '../lib/knowledge-model';
import { sourceQualityMessage, sourceQualityWarnings, sourceQualityWarningSchema } from '../lib/source-quality';
import { buildSemanticProviderRequest, interpretRelatedSources } from '../lib/ingestion';
import { extractSource, unlinkedSourceProvenance } from '../lib/source-extractors';
import { textPdf } from './knowledge-fixtures';

test('PDF coverage warnings remain optional for old reports and reject unknown claims', () => {
  const legacy = { fileId: randomUUID(), name: 'legacy.pdf', hash: 'synthetic', status: 'ready', message: 'Ready for review.' };
  assert.deepEqual(sourceFileReportSchema.parse(legacy), legacy);
  assert.deepEqual(sourceFileReportSchema.parse({ ...legacy, warnings: ['pdf-text-only'] }).warnings, ['pdf-text-only']);
  assert.equal(sourceQualityWarningSchema.safeParse('ocr-verified').success, false);
  assert.equal(sourceFileReportSchema.safeParse({ ...legacy, warnings: ['ocr-verified'] }).success, false);
  assert.equal(sourceFileReportSchema.safeParse({ ...legacy, warnings: ['pdf-text-only', 'pdf-text-only'] }).success, false);
});

test('only PDF text extraction receives the bounded coverage warning', () => {
  assert.deepEqual(sourceQualityWarnings('pdf'), ['pdf-text-only']);
  for (const format of ['text', 'csv', 'html', 'docx', 'xlsx', 'ocr', 'unknown']) assert.deepEqual(sourceQualityWarnings(format), []);
  const message = sourceQualityMessage('pdf-text-only');
  assert.match(message, /lettering in images or drawings may be missing/i);
  assert.match(message, /columns or headings may read out of order/i);
  assert.match(message, /compare names, prices and qualifications with the original/i);
  assert.match(message, /no OCR or visual coverage check was performed/i);
});

test('related provider input separates PDF limits from unchanged source text and page anchors', async () => {
  // Real local PDF extraction; the callback only captures a request and never
  // calls a provider. These synthetic lines make no restaurant-specific claims.
  const pdf = await extractSource('synthetic-menu.pdf', 'application/pdf', textPdf([
    ['North room', 'Cedar pie 12/12.36', 'Cash/card prices'],
    ['South room', 'Elm pie 14/14.42', 'Ask staff about dietary requirements.'],
  ]));
  const plain = await extractSource('synthetic.txt', 'text/plain', Buffer.from('Unrelated source text.'));
  const sources = [pdf, plain].map((source, index) => ({
    sourceId: `source-${index}`, name: index === 0 ? 'synthetic-menu.pdf' : 'synthetic.txt',
    text: source.text, provenance: unlinkedSourceProvenance(source), warnings: sourceQualityWarnings(source.format),
  }));
  const before = structuredClone(sources), stop = new Error('Offline request captured');
  let callbacks = 0;
  await assert.rejects(interpretRelatedSources(sources, async (input, schema) => {
    callbacks++;
    const request = buildSemanticProviderRequest(input, schema, { related: true });
    const sent = JSON.parse(JSON.parse(JSON.stringify(request)).input[0].content).sources;
    assert.equal(sent.length, 2);
    for (const [index, source] of sources.entries()) {
      assert.equal(sent[index].source, source.text);
      assert.deepEqual(sent[index].sourceAnchors, source.provenance.anchors);
      assert.equal(sent[index].sourceId, source.sourceId);
      assert.equal(sent[index].filename, source.name);
      assert.ok(!source.text.includes(sourceQualityMessage('pdf-text-only')));
      assert.ok(source.provenance.anchors.every(anchor => !anchor.excerpt.includes(sourceQualityMessage('pdf-text-only'))));
    }
    assert.deepEqual(sent[0].sourceLimitations, [sourceQualityMessage('pdf-text-only')]);
    assert.equal(Object.hasOwn(sent[1], 'sourceLimitations'), false);
    assert.deepEqual(sent[0].sourceAnchors.map((anchor: { pageStart: number; pageEnd: number }) => [anchor.pageStart, anchor.pageEnd]), [[1, 1], [2, 2]]);
    assert.match(sent[0].source, /Cedar pie 12\/12\.36/);
    assert.match(sent[0].source, /Elm pie 14\/14\.42/);
    throw stop;
  }), error => error === stop);
  assert.equal(callbacks, 1);
  assert.deepEqual(sources, before);
});
