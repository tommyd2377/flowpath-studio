/** Offline only: synthetic query CPU timings. No servers, providers or private data. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { taskFixture, fixtureQuery } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { evaluateQuery } from '../lib/catalog-query';

const baseline = process.argv[2];
const engines = [{ name: 'current', compileQueryIndex, evaluateQuery }];
if (baseline) {
  const index = await import(pathToFileURL(resolve(baseline, 'lib/catalog-query-index.ts')).href);
  const query = await import(pathToFileURL(resolve(baseline, 'lib/catalog-query.ts')).href);
  engines.unshift({ name: 'baseline', compileQueryIndex: index.compileQueryIndex, evaluateQuery: query.evaluateQuery });
}
const results = [];
for (const size of [100, 1000, 10000]) {
  const space = taskFixture(undefined, size);
  const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: [
    { kind: 'field', id: 'minimum', fieldId: 'reading-minutes', op: 'gte', value: { type: 'number', value: size / 2, unit: 'units' } },
    { kind: 'field', id: 'flag', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: true } },
  ] });
  query.order = [{ fieldId: 'reading-minutes', direction: 'desc' }];
  for (const engine of engines) {
    const index = engine.compileQueryIndex(space);
    for (const facets of [false, true]) {
      const options = facets ? { facets: ['flag', 'authors'] } : {};
      for (let n = 0; n < 5; n++) engine.evaluateQuery(index, query, options);
      const samples: number[] = [];
      for (let n = 0; n < 50; n++) { const began = performance.now(); engine.evaluateQuery(index, query, options); samples.push(performance.now() - began); }
      samples.sort((a, b) => a - b);
      results.push({ engine: engine.name, records: size, case: facets ? 'filter_sort_facets' : 'filter_sort', medianMs: samples[25], p95Ms: samples[47], compiledIndexEstimatedBytes: index.bytes });
    }
  }
}
const sourceHashes: Record<string, Record<string, string>> = {};
for (const [name, root] of [['current', process.cwd()], ...(baseline ? [['baseline', baseline]] : [])]) {
  sourceHashes[name] = {};
  for (const file of ['lib/catalog-query.ts', 'lib/catalog-query-index.ts']) sourceHashes[name][file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, warmups: 5, samples: 50, scope: 'Synthetic in-memory CPU only; excludes storage, authorization, provider, UI, audio and total RSS.', sourceHashes, results }, null, 2));
