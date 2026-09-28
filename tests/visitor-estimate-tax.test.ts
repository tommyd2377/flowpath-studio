import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { estimateTaxBasisHash, estimateVisitorTax, TaxEstimateInputError, visitorEstimateTaxInputSchema } from '../lib/visitor-estimate-tax';
import { retainVisitorConversationResearch, type VisitorResearchMemory } from '../lib/visitor-conversation-memory';
import type { ExploreResult } from '../lib/explore-model';
import type { VisitorEstimateTaxInput } from '@thevoice/platform-ui/estimate-tax';
import { researchEvidenceExcerpts } from '../lib/visitor-research-excerpts';

type LegacyTaxInput = Omit<VisitorEstimateTaxInput, 'lines'> & { lines: (Omit<VisitorEstimateTaxInput['lines'][number], 'evidence'> & {
  evidence: Extract<VisitorEstimateTaxInput['lines'][number]['evidence'][number], { excerpt: string }>[];
})[] };

const now = Date.parse('2026-09-24T14:00:00.000Z');
const publication = { siteId: 'site', revisionId: 'publication-1', indexRevision: 'index-1' };
const source = { title: 'Synthetic public rate evidence', url: 'https://revenue.gov/rate' };
const answer = 'Example County applies 8.875% tax to prepared goods for pickup. Books are exempt.';
function fixture() {
  const session = { id: randomUUID(), publication, createdAt: now - 60_000, touchedAt: now, researchMemory: [] as VisitorResearchMemory };
  const research: ExploreResult = { id: 'retained-tax', kind: 'web', query: 'Example County prepared goods tax rate', answer,
    fetchedAt: new Date(now - 60_000).toISOString(), demo: false, sources: [source], citations: [{ ...source, start: 0, end: answer.length }], images: [], map: null };
  retainVisitorConversationResearch(session, research, now);
  const estimate = { revision: 1, publication, asOf: '2026-09-24', currency: 'USD', fractionDigits: 2, subtotalMinor: 2850,
    lines: [{ recordId: 'food', fieldId: 'price', quantity: 2, lineTotal: '25.00' }, { recordId: 'book', fieldId: 'price', quantity: 1, lineTotal: '3.50' }] };
  const input: LegacyTaxInput = { mode: 'researched', jurisdiction: 'Example County', location: 'Example County store', fulfillment: 'pickup', applicabilityNotes: ['Prepared goods, no exemption claimed; books exempt.'], visitorAssumption: null,
    lines: [{ recordId: 'food', fieldId: 'price', classification: 'prepared goods', taxability: 'taxable', taxabilityNotes: 'Prepared goods rate applies to this pickup.', ratePercent: '8.875', evidence: [{ resultId: research.id, url: source.url, excerpt: answer }] },
      { recordId: 'book', fieldId: 'price', classification: 'books', taxability: 'exempt', taxabilityNotes: 'Books are exempt.', ratePercent: null, evidence: [{ resultId: research.id, url: source.url, excerpt: answer }] }] };
  return { session, research, estimate, input, now };
}

test('researched tax uses retained citations and exact rounded line totals without modifying the session', () => {
  const data = fixture(), original = structuredClone(data.session), result = estimateVisitorTax(data);
  assert.equal(result.status, 'complete');
  assert.equal(result.label, 'Researched tax estimate');
  assert.deepEqual(result.lines.map(line => line.tax), ['2.22', '0.00']);
  assert.equal(result.estimatedTaxMinor, 222);
  assert.equal(result.estimatedTotal, '30.72');
  assert.equal(result.lines[0].evidence[0].title, source.title);
  assert.equal(result.lines[0].evidence[0].fetchedAt, data.research.fetchedAt);
  assert.match(result.notes[0], /not verified tax authority/);
  assert.deepEqual(data.session, original);
});

test('selected excerpt IDs resolve server-owned evidence and preserve legacy tax results across quantity changes', () => {
  const data = fixture(), excerpt = researchEvidenceExcerpts(data.research).evidenceExcerpts[0];
  const input: VisitorEstimateTaxInput = { ...data.input, lines: data.input.lines.map(line => ({ ...line, evidence: [{ resultId: data.research.id, excerptId: excerpt.excerptId }] })) };
  const original = structuredClone(data.session);
  assert.deepEqual(estimateVisitorTax({ ...data, input }), estimateVisitorTax(data));
  data.estimate.revision++;
  data.estimate.lines[0].quantity = 3; data.estimate.lines[0].lineTotal = '37.50'; data.estimate.subtotalMinor = 4100;
  const changed = estimateVisitorTax({ ...data, input });
  assert.equal(changed.estimatedTotal, '44.33');
  assert.equal(changed.lines[0].evidence[0].excerpt, data.research.answer);
  assert.equal(changed.lines[0].evidence[0].url, source.url);
  assert.equal(changed.lines[0].evidence[0].start, excerpt.start);
  assert.equal(changed.lines[0].evidence[0].end, excerpt.end);
  assert.equal('excerptId' in changed.lines[0].evidence[0], false, 'Resolved output remains compatible with existing displays and saved evidence');
  assert.deepEqual(data.session, original, 'Selecting or reusing an excerpt does not acquire or refresh research');
});

test('unknown, changed, expired and foreign excerpt references are correctable errors rather than invented evidence', () => {
  for (const change of [
    (data: ReturnType<typeof fixture>, input: VisitorEstimateTaxInput) => { input.lines[0].evidence = [{ resultId: data.research.id, excerptId: `excerpt_${'0'.repeat(32)}` }]; },
    (_data: ReturnType<typeof fixture>, input: VisitorEstimateTaxInput) => { input.lines[0].evidence[0].resultId = 'unknown-result'; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].result!.answer += ' Changed source content.'; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].sessionId = randomUUID(); },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].publication.revisionId = 'foreign-publication'; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].expiresAt = new Date(now - 1).toISOString(); },
  ]) {
    const data = fixture(), excerpt = researchEvidenceExcerpts(data.research).evidenceExcerpts[0];
    const input: VisitorEstimateTaxInput = { ...data.input, lines: data.input.lines.map(line => ({ ...line, evidence: [{ resultId: data.research.id, excerptId: excerpt.excerptId }] })) };
    change(data, input);
    const original = structuredClone(data.session);
    assert.throws(() => estimateVisitorTax({ ...data, input }), TaxEstimateInputError);
    assert.deepEqual(data.session, original);
  }
});

test('an excerpt ID preserves classification, rate and hypothetical authority checks', () => {
  const data = fixture(), excerpt = researchEvidenceExcerpts(data.research).evidenceExcerpts[0];
  const input: VisitorEstimateTaxInput = { ...data.input, lines: data.input.lines.map(line => ({ ...line, evidence: [{ resultId: data.research.id, excerptId: excerpt.excerptId }] })) };
  input.lines[0].classification = null;
  assert.equal(estimateVisitorTax({ ...data, input }).status, 'incomplete');
  input.lines[0].classification = 'prepared goods'; input.lines[0].ratePercent = '9';
  assert.equal(estimateVisitorTax({ ...data, input }).estimatedTotal, null);
  input.mode = 'hypothetical'; input.visitorAssumption = 'Assume nine percent for this example.';
  assert.throws(() => estimateVisitorTax({ ...data, input }), /hypothetical rate/);
});

test('tax evidence accepts strict ID or legacy quote references without accepting mixed client evidence', () => {
  const data = fixture(), excerpt = researchEvidenceExcerpts(data.research).evidenceExcerpts[0];
  const input: VisitorEstimateTaxInput = { ...data.input, lines: data.input.lines.map(line => ({ ...line, evidence: [{ resultId: data.research.id, excerptId: excerpt.excerptId }] })) };
  assert.equal(visitorEstimateTaxInputSchema.safeParse(input).success, true);
  assert.equal(visitorEstimateTaxInputSchema.safeParse(data.input).success, true);
  for (const invalid of [{ ...input.lines[0].evidence[0], url: 'https://other.gov' }, { ...input.lines[0].evidence[0], excerpt: 'Invented quote' }, { resultId: data.research.id, excerptId: 'invented' }]) {
    assert.equal(visitorEstimateTaxInputSchema.safeParse({ ...input, lines: [{ ...input.lines[0], evidence: [invalid] }] }).success, false);
  }
});

test('cited Unicode and ASCII fractional percentages equal their exact decimal rates', () => {
  for (const [notation, rate, tax] of [['8⅞%', '8.875', '2.22'], ['4½%', '4.5', '1.13'], ['⅜%', '0.375', '0.09'],
    ['8 ⅞ percent', '8.875', '2.22'], ['8\u202f⅞\u00a0%', '8.875', '2.22'], ['8 7/8%', '8.875', '2.22'], ['4 1/2 percent', '4.5', '1.13'], ['3/8%', '0.375', '0.09'], ['3⁄8%', '0.375', '0.09']] as const) {
    const data = fixture(), passage = `Example County applies ${notation} tax to prepared goods for pickup. Books are exempt.`;
    const retained = data.session.researchMemory[0].result!;
    retained.answer = passage; retained.citations[0].end = passage.length;
    data.input.lines.forEach(line => { line.evidence[0].excerpt = passage; });
    data.input.lines[0].ratePercent = rate;
    const result = estimateVisitorTax(data);
    assert.equal(result.status, 'complete', notation);
    assert.equal(result.estimatedTax, tax, notation);
    assert.equal(result.lines[0].evidence[0].excerpt, passage, 'Source evidence stays verbatim');
    assert.equal(result.lines[0].evidence[0].end, passage.length);
  }
});

test('fractional rate evidence rejects mismatches, suffix matches and rounded repeating fractions', () => {
  for (const [notation, declared] of [['8⅞%', '8'], ['4½%', '0.5'], ['⅜%', '3'], ['8 7/8%', '0.875'], ['⅓%', '0.333333'],
    ['18⅞%', '8.875'], ['-8⅞%', '8.875'], ['8.5⅞%', '8.875'], ['7/0%', '7'], ['4 1/2%', '0.5']] as const) {
    const data = fixture(), passage = `Example County applies ${notation} tax to prepared goods for pickup. Books are exempt.`;
    const retained = data.session.researchMemory[0].result!;
    retained.answer = passage; retained.citations[0].end = passage.length;
    data.input.lines.forEach(line => { line.evidence[0].excerpt = passage; });
    data.input.lines[0].ratePercent = declared;
    const result = estimateVisitorTax(data);
    assert.equal(result.status, 'incomplete', `${notation} cannot establish ${declared}`);
    assert.equal(result.estimatedTax, null);
    assert.equal(result.estimatedTotal, null);
    assert.match(result.missing.join(' '), /percentage is not supported/);
  }
  const data = fixture();
  data.input.lines[0].evidence[0].excerpt = answer.replace('8.875%', '8⅞%');
  assert.throws(() => estimateVisitorTax(data), /exact retained research/, 'Equivalent rate notation does not permit rewriting the cited source');
});

test('retained scoped evidence can be reused for new quantities without a new search', () => {
  const data = fixture(), first = estimateVisitorTax(data);
  data.estimate.revision++;
  data.estimate.lines[0].quantity = 3;
  data.estimate.lines[0].lineTotal = '37.50';
  data.estimate.subtotalMinor = 4100;
  const second = estimateVisitorTax(data);
  assert.equal(second.estimatedTax, '3.33');
  assert.equal(second.estimatedTotal, '44.33');
  assert.notEqual(second.basisHash, first.basisHash);
  assert.equal(second.basisHash, estimateTaxBasisHash(data.estimate));
  assert.equal(second.lines[0].evidence[0].fetchedAt, first.lines[0].evidence[0].fetchedAt);
  assert.equal(data.session.researchMemory.length, 1);
});

test('compound jurisdiction names match whole phrases in one cited passage with normalized case and whitespace', () => {
  for (const jurisdiction of ['New York City, New York', 'New York City / Brooklyn (Kings County)', '  NEW\u00a0YORK CITY / brooklyn ( kings\ncounty ) ']) {
    const data = fixture(), passage = 'New York State and New York City include Brooklyn (Kings County). The rate is 8.875%; books are exempt.';
    const retained = data.session.researchMemory[0].result!;
    retained.answer = passage; retained.citations[0].end = passage.length;
    data.input.jurisdiction = jurisdiction;
    data.input.lines.forEach(line => { line.evidence[0].excerpt = passage; });
    const result = estimateVisitorTax(data);
    assert.equal(result.status, 'complete', jurisdiction);
    assert.equal(result.estimatedTax, '2.22');
    assert.equal(result.lines[0].evidence[0].excerpt, passage, 'Matching does not rewrite evidence');
  }
});

test('jurisdiction matching rejects unrelated names, word fragments, punctuation substitutions and empty name lists', () => {
  for (const [jurisdiction, passage] of [
    ['New York City / Albany', 'New York City and Brooklyn'],
    ['New York City / Brooklyn', 'New York City and Brooklynton'],
    ['York', 'Yorkshire'],
    ['St. Example', 'Stx Example'],
    ['Brooklyn', 'Brooklynshire'],
    ['New York City / Kings County', 'New York City and Kings Countyshire'],
    [' / ( , ) ', 'New York City'],
  ]) {
    const data = fixture(), quote = `${passage} applies 8.875%; books are exempt.`;
    const retained = data.session.researchMemory[0].result!;
    retained.answer = quote; retained.citations[0].end = quote.length;
    data.input.jurisdiction = jurisdiction;
    data.input.lines.forEach(line => { line.evidence[0].excerpt = quote; });
    const result = estimateVisitorTax(data);
    assert.equal(result.status, 'incomplete', `${jurisdiction}: ${passage}`);
    assert.equal(result.estimatedTax, null);
    assert.equal(result.estimatedTotal, null);
    assert.match(result.missing.join(' '), /identify the declared jurisdiction/);
  }
});

test('compound jurisdiction names cannot be assembled across separate accepted excerpts', () => {
  const data = fixture(), passages = ['New York City applies 8.875%; books are exempt.', 'Brooklyn is named separately.'];
  const retained = data.session.researchMemory[0].result!;
  retained.answer = passages.join('\n\n');
  retained.citations = [{ ...source, start: 0, end: passages[0].length }, { ...source, start: passages[0].length + 2, end: retained.answer.length }];
  data.input.jurisdiction = 'New York City / Brooklyn';
  data.input.lines.forEach(line => { line.evidence = passages.map(excerpt => ({ resultId: retained.id, url: source.url, excerpt })); });
  const result = estimateVisitorTax(data);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.estimatedTotal, null);
  assert.match(result.missing.join(' '), /identify the declared jurisdiction/);
});

test('forged result IDs, sources, excerpts, uncited passages and foreign session/publication evidence fail closed', () => {
  for (const change of [
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].evidence[0].resultId = 'invented'; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].evidence[0].url = 'https://elsewhere.gov/rate'; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].evidence[0].url = 'https://127.0.0.1/rate'; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].evidence[0].excerpt = 'Invented 8.875% rate.'; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].result!.citations = []; },
    (data: ReturnType<typeof fixture>) => {
      const result = data.session.researchMemory[0].result!;
      result.answer += '\n\nUnrelated source citation.';
      result.citations = [{ ...source, start: answer.length + 2, end: result.answer.length }];
      data.input.lines[0].evidence[0].excerpt = answer;
    },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].sessionId = randomUUID(); },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].publication = { ...publication, revisionId: 'another' }; },
    (data: ReturnType<typeof fixture>) => { data.estimate.publication = { ...publication, revisionId: 'another' }; },
  ]) {
    const data = fixture(); change(data);
    assert.throws(() => estimateVisitorTax(data));
  }
});

test('tax evidence matches tracking-only URL variants while preserving meaningful parameters', () => {
  const data = fixture(), retained = data.session.researchMemory[0].result!;
  retained.sources[0].url = 'https://revenue.gov/rate?year=2026&region=county';
  retained.citations[0].url = 'https://revenue.gov/rate?utm_source=reference&region=county&year=2026#rates';
  data.input.lines.forEach(line => { line.evidence[0].url = 'https://revenue.gov/rate?fbclid=example&year=2026&region=county&gclid=example'; });
  assert.equal(estimateVisitorTax(data).status, 'complete');
  retained.answer = `${answer} [Rate]`;
  retained.citations[0].start = answer.length + 1; retained.citations[0].end = retained.answer.length;
  assert.equal(estimateVisitorTax(data).status, 'complete', 'A named citation after a quote in the same paragraph remains supported');
  for (const url of ['https://revenue.gov/rate?region=other&year=2026', 'https://revenue.gov/rate?region=county&year=2025',
    'https://revenue.gov/rate?region=county&year=2026&ref=other', 'https://revenue.gov/other?region=county&year=2026']) {
    data.input.lines[0].evidence[0].url = url;
    assert.throws(() => estimateVisitorTax(data), TaxEstimateInputError, 'Nontracking query and path differences are distinct evidence');
  }
});

test('a bounded exact multiblock excerpt contains its named citation, including component-rate lists', () => {
  const data = fixture(), retained = data.session.researchMemory[0].result!;
  const rateUrl = 'https://revenue.gov/rate?utm_source=reference#county';
  const marker = `[County rate](${rateUrl})`;
  const quoted = `The combined rate is 8⅞%.\n\nComponents:\n- State: 4%\n- County: 4½%\n- District: ⅜%.\n\nExample County uses this combined rate. ${marker}`;
  const other = { title: 'Prepared goods and books', url: 'https://revenue.gov/treatment' };
  const treatment = `Prepared goods are taxable for pickup; books are exempt. [Treatment](${other.url})`;
  retained.answer = `${quoted}\n\n${treatment}`;
  retained.sources = [source, other];
  retained.citations = [{ ...source, url: rateUrl, start: quoted.indexOf(marker), end: quoted.length },
    { ...other, start: retained.answer.indexOf('[Treatment]'), end: retained.answer.length }];
  data.input.lines.forEach(line => { line.evidence[0].excerpt = quoted; });
  const result = estimateVisitorTax(data);
  assert.equal(result.status, 'complete');
  assert.equal(result.estimatedTax, '2.22');
  assert.equal(result.lines[0].evidence[0].excerpt, quoted);
  assert.equal(result.lines[0].evidence[0].end, quoted.length);
  data.input.lines[0].evidence[0].url = other.url;
  assert.throws(() => estimateVisitorTax(data), TaxEstimateInputError, 'Another source in the retained answer cannot support this excerpt');
  data.input.lines[0].evidence[0].url = source.url;
  data.input.lines[0].evidence[0].excerpt = quoted.slice(0, quoted.indexOf('\n\nExample County'));
  assert.throws(() => estimateVisitorTax(data), TaxEstimateInputError, 'A multiblock quote must actually include its citation, not just refer to a distant source');
  data.input.lines[0].evidence[0].excerpt = quoted.replace('8⅞%', '8.875%');
  assert.throws(() => estimateVisitorTax(data), TaxEstimateInputError, 'Equivalent meaning does not permit fabricating the retained excerpt');
  const long = `A long contextual note. ${'x'.repeat(1000)}\n\n${quoted}`;
  retained.answer = long;
  retained.citations = [{ ...source, url: rateUrl, start: long.indexOf(marker), end: long.length }];
  data.input.lines.forEach(line => { line.evidence[0].excerpt = long; });
  assert.throws(() => estimateVisitorTax(data), TaxEstimateInputError, 'The new multiblock allowance stays bounded to 1000 characters');
});

test('unknown context or line classification never produces a falsely complete tax total', () => {
  for (const change of [
    (data: ReturnType<typeof fixture>) => { data.input.location = null; },
    (data: ReturnType<typeof fixture>) => { data.input.jurisdiction = null; },
    (data: ReturnType<typeof fixture>) => { data.input.fulfillment = null; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].classification = null; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].taxability = 'unknown'; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].ratePercent = null; },
    (data: ReturnType<typeof fixture>) => { data.input.lines.shift(); },
    (data: ReturnType<typeof fixture>) => { data.input.applicabilityNotes = []; },
    (data: ReturnType<typeof fixture>) => { data.input.jurisdiction = 'Other County'; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].ratePercent = '8'; },
    (data: ReturnType<typeof fixture>) => { data.input.lines[0].evidence = []; },
    (data: ReturnType<typeof fixture>) => { data.estimate.asOf = '2026-09-23'; },
  ]) {
    const data = fixture(); change(data);
    const result = estimateVisitorTax(data);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.estimatedTaxMinor, null);
    assert.equal(result.estimatedTotal, null);
    assert.ok(result.missing.length);
  }
});

test('freshness does not refresh on recall and synthetic research cannot establish an actual rate', () => {
  for (const change of [
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].result!.fetchedAt = '2026-09-22T14:00:00.000Z'; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].result!.fetchedAt = '2026-09-25T14:00:00.000Z'; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].result!.demo = true; },
    (data: ReturnType<typeof fixture>) => { data.session.researchMemory[0].result!.kind = 'images'; },
  ]) {
    const data = fixture(); change(data);
    assert.equal(estimateVisitorTax(data).status, 'incomplete');
  }
});

test('hypothetical rates remain separate and need explicit visitor assumptions', () => {
  const data = fixture();
  data.input.mode = 'hypothetical';
  data.input.visitorAssumption = 'Assume an 8.875% rate for this planning example, with books exempt.';
  data.input.lines.forEach(line => { line.evidence = []; });
  data.session.researchMemory = [];
  const result = estimateVisitorTax(data);
  assert.equal(result.status, 'complete');
  assert.equal(result.label, 'Hypothetical tax estimate');
  assert.match(result.notes[0], /no applicable tax rule has been verified/);
  data.input.visitorAssumption = null;
  assert.equal(estimateVisitorTax(data).status, 'incomplete');
  data.input.lines[0].evidence = fixture().input.lines[0].evidence;
  assert.throws(() => estimateVisitorTax(data), /hypothetical rate/);
});

test('tax arithmetic rounds individual lines half up and supports currency minor units', () => {
  for (const [digits, lineTotal, subtotalMinor, tax, total] of [[2, '0.05', 10, '0.02', '0.12'], [0, '5', 10, '2', '12'], [3, '0.005', 10, '0.002', '0.012']] as const) {
    const data = fixture();
    data.input.mode = 'hypothetical'; data.input.visitorAssumption = 'Assume 10% tax on each line.';
    data.input.lines.forEach(line => { line.evidence = []; line.taxability = 'taxable'; line.ratePercent = '10'; });
    data.estimate.fractionDigits = digits; data.estimate.subtotalMinor = subtotalMinor;
    data.estimate.lines.forEach(line => { line.lineTotal = lineTotal; });
    const result = estimateVisitorTax(data);
    assert.equal(result.estimatedTax, tax);
    assert.equal(result.estimatedTotal, total);
  }
});

test('empty estimates remain incomplete and stale or duplicate line rules cannot silently apply', () => {
  const data = fixture(); data.estimate.lines = []; data.estimate.subtotalMinor = 0; data.input.lines = [];
  assert.equal(estimateVisitorTax(data).status, 'incomplete');
  assert.equal(estimateVisitorTax(data).estimatedTax, null);
  for (const change of [
    (value: ReturnType<typeof fixture>) => { value.input.lines[0].recordId = 'other'; },
    (value: ReturnType<typeof fixture>) => { value.input.lines.push(value.input.lines[0]); },
    (value: ReturnType<typeof fixture>) => { value.estimate.subtotalMinor++; },
    (value: ReturnType<typeof fixture>) => { value.input.lines[1].ratePercent = '5'; },
  ]) { const data = fixture(); change(data); assert.throws(() => estimateVisitorTax(data)); }
  for (const ratePercent of ['-1', '101', '1.0000001', '1e2', 'NaN']) {
    const input = fixture().input; input.lines[0].ratePercent = ratePercent;
    assert.equal(visitorEstimateTaxInputSchema.safeParse(input).success, false);
  }
});
