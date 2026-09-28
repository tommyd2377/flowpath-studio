import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { researchEvidenceExcerpts } from '../lib/visitor-research-excerpts';
import { estimateVisitorTax } from '../lib/visitor-estimate-tax';
import { retainVisitorConversationResearch, type VisitorResearchMemory } from '../lib/visitor-conversation-memory';
import type { ExploreResult } from '../lib/explore-model';

const now = Date.parse('2026-09-24T14:00:00.000Z');
function markdownResearch(): ExploreResult {
  const url = 'https://revenue.gov/rates?area=example', citedUrl = `${url}&utm_source=reference#rates`;
  const marker = `[Official rate table](${citedUrl})`;
  const answer = `**The combined rate is 8⅞% (8.875%).**\n\nIt consists of:\n- **State:** 4%\n- **City:** 4½%\n- **District:** ⅜%\n\n**Example Borough** falls within that city for pickup transactions. ${marker}`;
  return { id: 'markdown-research', kind: 'web', query: 'Example Borough pickup tax', answer, demo: false, fetchedAt: new Date(now - 1000).toISOString(),
    sources: [{ url, title: 'Official rate table' }], citations: [{ url: citedUrl, title: 'Official rate table', start: answer.indexOf(marker), end: answer.length }], images: [], map: null };
}

test('copyable excerpts preserve recorded Markdown shape and include rate, bullets, jurisdiction and named citation', () => {
  const research = markdownResearch(), original = structuredClone(research), projected = researchEvidenceExcerpts(research);
  assert.equal(projected.evidenceExcerpts.length, 2);
  const [context, paragraph] = projected.evidenceExcerpts;
  assert.equal(context.excerpt, research.answer);
  assert.match(context.excerpt, /\*\*The combined.*\n\nIt consists of:\n- \*\*State:/);
  assert.match(paragraph.excerpt, /^\*\*Example Borough\*\*/);
  assert.equal(context.url, research.sources[0].url);
  assert.equal(projected.omittedEvidenceExcerpts, 0);
  for (const excerpt of projected.evidenceExcerpts) {
    assert.match(excerpt.excerptId, /^excerpt_[a-f0-9]{32}$/);
    assert.equal(excerpt.excerpt, research.answer.slice(excerpt.start, excerpt.end));
    assert.ok(excerpt.start <= research.citations[0].start && excerpt.end >= research.citations[0].end);
    assert.ok(excerpt.excerpt.length <= 1000);
  }
  assert.deepEqual(research, original);
  const publication = { siteId: 'site', revisionId: 'publication', indexRevision: 'index' };
  const session = { id: randomUUID(), publication, createdAt: now - 60_000, touchedAt: now, researchMemory: [] as VisitorResearchMemory };
  retainVisitorConversationResearch(session, research, now);
  const result = estimateVisitorTax({ now, session, estimate: { revision: 1, publication, asOf: '2026-09-24', currency: 'USD', fractionDigits: 2, subtotalMinor: 2850,
    lines: [{ recordId: 'offering', fieldId: 'price', quantity: 1, lineTotal: '28.50' }] },
    input: { mode: 'researched', jurisdiction: 'Example Borough', location: 'Example Borough store', fulfillment: 'pickup', applicabilityNotes: ['Published pickup example.'], visitorAssumption: null,
      lines: [{ recordId: 'offering', fieldId: 'price', classification: 'prepared goods', taxability: 'taxable', taxabilityNotes: 'Prepared goods for pickup.', ratePercent: '8.875',
        evidence: [{ resultId: context.resultId, excerptId: context.excerptId }] }] } });
  assert.equal(result.status, 'complete');
  assert.equal(result.estimatedTax, '2.53');
  assert.equal(result.lines[0].evidence[0].excerpt, research.answer, 'The server supplies exact multi-paragraph Markdown without model copying');
});

test('excerpt IDs bind retained result content, source and offsets rather than their projection order', () => {
  const research = markdownResearch(), original = researchEvidenceExcerpts(research);
  const ids = (value: ExploreResult) => researchEvidenceExcerpts(value).evidenceExcerpts.map(excerpt => excerpt.excerptId);
  assert.equal(new Set(ids(research)).size, original.evidenceExcerpts.length, 'Different citation windows have different IDs');
  assert.deepEqual(ids(structuredClone(research)), ids(research));
  for (const update of [
    (value: ExploreResult) => { value.id = 'different-result'; },
    (value: ExploreResult) => { value.answer += ' A new qualification.'; },
    (value: ExploreResult) => { value.fetchedAt = new Date(now).toISOString(); },
    (value: ExploreResult) => { value.sources[0].url = 'https://revenue.gov/different'; value.citations[0].url = value.sources[0].url; },
  ]) {
    const changed = structuredClone(research); update(changed);
    assert.ok(ids(changed).every(id => !ids(research).includes(id)), 'Changed retained evidence cannot satisfy an earlier excerpt ID');
  }
});

test('multiple sources retain distinct exact citations and only tracking-equivalent sources can supply excerpts', () => {
  const research = markdownResearch(), second = { title: 'Treatment', url: 'https://revenue.gov/treatment?type=prepared' };
  const extra = `Prepared goods conditions. [Treatment](${second.url})`;
  research.answer += `\n\n${extra}`; research.sources.push(second);
  research.citations.push({ ...second, start: research.answer.indexOf('[Treatment]'), end: research.answer.length });
  const projection = researchEvidenceExcerpts(research);
  for (const excerpt of projection.evidenceExcerpts) assert.ok(research.citations.some(citation => citation.url.startsWith(excerpt.url)
    && citation.start >= excerpt.start && citation.end <= excerpt.end));
  assert.deepEqual(new Set(projection.evidenceExcerpts.map(excerpt => excerpt.url)), new Set(research.sources.map(source => source.url)));
  research.citations[1].url = 'https://revenue.gov/treatment?type=other';
  const distinct = researchEvidenceExcerpts(research);
  assert.ok(distinct.evidenceExcerpts.every(excerpt => excerpt.url !== second.url));
  assert.equal(distinct.omittedEvidenceExcerpts, 1);
});

test('limits count omissions deterministically, never truncate a quote, and bound UTF-8 projection bytes', () => {
  const research = markdownResearch(); research.answer = ''; research.sources = []; research.citations = [];
  for (let i = 0; i < 20; i++) {
    const source = { title: `Source ${i}`, url: `https://revenue.gov/rate/${i}` };
    const text = `**項目 ${i}** ${'日本語'.repeat(90)} [Source](${source.url})`;
    const start = research.answer.length;
    research.answer += `${text}\n\n`; research.sources.push(source);
    research.citations.push({ ...source, start: start + text.indexOf('[Source]'), end: start + text.length });
  }
  const projection = researchEvidenceExcerpts(research);
  assert.ok(projection.evidenceExcerpts.length > 0 && projection.evidenceExcerpts.length <= 8);
  assert.ok(Buffer.byteLength(JSON.stringify(projection)) <= 8000);
  assert.ok(projection.omittedEvidenceExcerpts > 0);
  for (const excerpt of projection.evidenceExcerpts) assert.equal(excerpt.excerpt, research.answer.slice(excerpt.start, excerpt.end));
  assert.deepEqual(researchEvidenceExcerpts(research), projection);
  assert.deepEqual(researchEvidenceExcerpts({ ...research, citations: [...research.citations].reverse() }), projection);
});

test('long paragraphs keep the full citation in an exact bounded window and duplicate anchors do not duplicate quotes', () => {
  const research = markdownResearch(), marker = '[Source](https://revenue.gov/rates?area=example)';
  research.answer = `${'x'.repeat(1400)} ${marker} ${'y'.repeat(1200)}`;
  research.citations = [{ ...research.sources[0], start: research.answer.indexOf(marker), end: research.answer.indexOf(marker) + marker.length }];
  research.citations.push({ ...research.citations[0] });
  const projection = researchEvidenceExcerpts(research);
  assert.equal(projection.evidenceExcerpts.length, 1);
  assert.equal(projection.omittedEvidenceExcerpts, 0);
  const excerpt = projection.evidenceExcerpts[0];
  assert.equal(excerpt.excerpt, research.answer.slice(excerpt.start, excerpt.end));
  assert.ok(excerpt.excerpt.length <= 1000 && excerpt.excerpt.includes(marker));
  research.citations = [{ ...research.sources[0], start: 0, end: 1001 }];
  assert.deepEqual(researchEvidenceExcerpts(research), { evidenceExcerpts: [], omittedEvidenceExcerpts: 1 });
  assert.throws(() => researchEvidenceExcerpts({ ...research, citations: [{ ...research.citations[0], end: research.answer.length + 1 }] }));
});

test('citation annotations touching paragraph separators remain fully inside their copied excerpts', () => {
  const research = markdownResearch();
  research.answer = '\n\nFirst paragraph.\n\nSecond paragraph.\n\n';
  for (const [start, end] of [[0, 2], [1, 3], [17, 19], [18, 20], [20, research.answer.length]]) {
    research.citations = [{ ...research.sources[0], start, end }];
    for (const excerpt of researchEvidenceExcerpts(research).evidenceExcerpts) {
      assert.ok(excerpt.start <= start && excerpt.end >= end);
      assert.equal(excerpt.excerpt, research.answer.slice(excerpt.start, excerpt.end));
    }
  }
});
