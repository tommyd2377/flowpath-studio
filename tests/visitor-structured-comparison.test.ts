import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { VisitorTaskStore, confirmVisitorView } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { acknowledgeTaskDisplay, buildVisitorTaskView, executeVisitorCapability } from '../lib/visitor-capabilities';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { answerCompositionSchema, answerCompositionTool } from '../lib/visitor-answer-composition';
import { comparisonProse, comparisonTable } from './helpers/structured-comparison.fixture';

const readTool = { type: 'function', name: 'read_published_content', description: 'Read synthetic retained evidence.', parameters: {} };
const request = 'Compare residential care, detox support and outpatient care with insurance, accommodation and availability qualifications, and show the options.';
const answer = (text: string) => ({ type: 'message', content: [{ type: 'output_text', text }] });
const call = (name: string, args: unknown, round: number) => ({ type: 'function_call', call_id: `fixture-${round}`, name, arguments: JSON.stringify(args) });

test('two source reads followed by prose preserve an unmet display outcome without a repair call', async () => {
  let requests = 0, reads = 0;
  const result = await runVisitorTask({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
    latestRequest: request, instructions: 'Use only the synthetic retained evidence.', context: {}, tools: [readTool, answerCompositionTool],
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (requests === 2) assert.equal(body.tool_choice, 'auto', 'The display step is still available after two source reads.');
      return Response.json({ status: 'completed', output: ++requests <= 2 ? [call(readTool.name, { query: requests === 1 ? 'programs insurance' : 'accommodations' }, requests)] : [answer(comparisonProse)] });
    }, execute: async name => {
      assert.equal(name, readTool.name); reads++;
      // Even an applied-looking data field is not an acknowledged visual receipt.
      return { data: { status: 'applied', passages: ['Synthetic retained evidence.'] } };
    },
  });
  assert.equal(requests, 3); assert.equal(reads, 2); assert.equal(result.text, comparisonProse);
  assert.notEqual(result.displaySatisfied, true, 'A source read or final prose cannot manufacture a display receipt.');
  assert.equal(result.answerPlacement, undefined);
});

test('two source reads can end in an acknowledged rich comparison table within the existing tool budget', async () => {
  for (const confirmed of [false, true]) {
    let requests = 0, displays = 0;
    const result = await runVisitorTask({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
      latestRequest: request, instructions: 'Use only the synthetic retained evidence.', context: {}, tools: [readTool, answerCompositionTool],
      fetch: async () => Response.json({ status: 'completed', output: [++requests <= 2
        ? call(readTool.name, { query: 'published qualifications' }, requests)
        : call('present_answer', { text: comparisonTable, relationship: 'related' }, requests)] }),
      execute: async (name, args) => {
        if (name === readTool.name) return { data: { passages: ['Synthetic retained evidence.'] } };
        const parsed = answerCompositionSchema.parse(JSON.parse(args)); displays++;
        return { data: { status: 'applied' }, directText: parsed.text, ...(confirmed ? { displaySatisfied: true } : {}) };
      },
    });
    assert.equal(requests, 3); assert.equal(displays, 1); assert.equal(result.text, comparisonTable);
    assert.equal(result.displaySatisfied, confirmed ? true : undefined, 'Only the acknowledged tool result sets display metadata.');
  }
});

test('comparison background, explanation-only requests and explicit prose remain valid without display tools', async () => {
  for (const latestRequest of ['Explain how residential and outpatient care differ.', 'Do not show a table or cards; explain the differences in prose.', 'We compared these yesterday. What does benefits verification mean?']) {
    let requests = 0;
    const text = 'These are published descriptions. Individual benefits still require verification.';
    const result = await runVisitorTask({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
      latestRequest, instructions: 'Use only synthetic retained evidence.', context: {}, tools: [readTool, answerCompositionTool],
      fetch: async () => { requests++; return Response.json({ status: 'completed', output: [answer(text)] }); },
      execute: async () => { assert.fail('No display is required for this answer.'); },
    });
    assert.equal(result.text, text); assert.equal(requests, 1); assert.notEqual(result.displaySatisfied, true);
  }
});

test('rich comparison composition does not accept fabricated schema fields or executable actions', () => {
  for (const extra of [{ availability: true }, { bookingUrl: 'https://example.com/book' }, { fields: [{ id: 'invented', value: 10 }] }]) {
    assert.equal(answerCompositionSchema.safeParse({ text: comparisonTable, relationship: 'related', ...extra }).success, false);
  }
});

test('three known records produce a canonical comparison confirmed only by an exact display receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'structured-comparison-'));
  try {
    const space = websiteTaskFixture('services', 4), index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
    let session = await store.create(space.publication);
    const signal = new AbortController().signal;
    buildVisitorTaskView({ index, session, signal }); confirmVisitorView(session); session = await store.save(session, session.revision);
    const recordIds = ['record-00003', 'record-00001', 'record-00002'];
    const compared = await executeVisitorCapability({ index, store, sessionId: session.id, signal, assertCurrent: async () => {},
      call: { capabilityId: 'selection.compare', input: { recordIds }, operationId: randomUUID(), expectedRevision: session.revision },
    });
    assert.equal(compared.outputType, 'comparison'); assert.equal(compared.view.focus, 'comparison');
    assert.deepEqual(compared.view.comparison?.rows.map(row => row.id), recordIds);
    const pending = await store.read(session.id, space.publication);
    assert.equal(pending.receipts.filter(receipt => receipt.kind === 'display').length, 0);
    const view = compared.view;
    const confirmed = await acknowledgeTaskDisplay(store, session.id, space.publication, { operationId: view.operationId!, queryId: view.query.queryId,
      queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds });
    assert.equal(confirmed.presentation?.type, 'comparison');
    assert.equal(confirmed.receipts.filter(receipt => receipt.kind === 'display' && receipt.status === 'confirmed').length, 1);
    assert.deepEqual(compared.view.comparison?.rows.map(row => row.values.find(value => value.fieldId === 'price')?.text), ['23 USD / session', '21 USD / session', '22 USD / session']);
    assert.equal(compared.view.comparison?.fields.some(field => field.id === 'availability'), false, 'Unknown availability is never synthesized into a comparison field.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
