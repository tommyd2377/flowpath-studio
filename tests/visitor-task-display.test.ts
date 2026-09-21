import assert from 'node:assert/strict';
import test from 'node:test';
import { runVisitorTask, type ToolResult } from '../lib/visitor-task-runner';

const tool = { type: 'function', name: 'fixture', description: 'Synthetic display or retrieval', parameters: {} };
const call = { type: 'function_call', call_id: 'fixture-call', name: tool.name, arguments: '{}' };

test('acknowledged display state survives subsequent read-only tools for both channels without inventing a receipt from tool data', async () => {
  for (const channel of ['chat', 'voice'] as const) for (const confirmed of [false, true]) for (const direct of [false, true]) {
    let requests = 0, executions = 0;
    const results: ToolResult[] = [{ data: { status: 'applied', outputType: 'query' }, ...(confirmed ? { displaySatisfied: true } : {}) },
      { data: { status: 'retrieved', outputType: 'external' }, ...(direct ? { directText: 'A qualified follow-up.' } : {}) }];
    const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
      instructions: 'Synthetic evidence fixture', context: {}, tools: [tool],
      fetch: async () => Response.json({ status: 'completed', output: ++requests <= 2 ? [call] : [{ type: 'message', content: [{ type: 'output_text', text: 'A qualified follow-up.' }] }] }),
      execute: async () => { executions++; return results.shift()!; },
    });
    assert.equal(result.text, 'A qualified follow-up.'); assert.equal(result.displaySatisfied, confirmed ? true : undefined);
    assert.equal(result.answerPlacement, confirmed && !direct ? 'supporting' : undefined, 'Completed model text stays visible without duplicating direct tool answers');
    assert.equal(requests, direct ? 2 : 3); assert.equal(executions, 2);
  }
});

test('an implicit calculation remains visible after query and detail tools even when present_answer is ignored', async () => {
  for (const channel of ['chat', 'voice'] as const) {
    let requests = 0;
    const calculation = 'Three published $9 items cost $27. Your hypothetical 12% surcharge adds $3.24, for $30.24 total; this is not a published charge.';
    const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
      instructions: 'Use the published item price and user-supplied hypothetical allowance.', context: {}, tools: [tool, { ...tool, name: 'present_answer' }],
      fetch: async () => Response.json({ status: 'completed', output: ++requests <= 2 ? [call] : [{ type: 'message', content: [{ type: 'output_text', text: calculation }] }] }),
      execute: async () => ({ data: { status: 'applied', price: 9 }, displaySatisfied: true }),
    });
    assert.equal(result.text, calculation); assert.equal(result.answerPlacement, 'supporting'); assert.equal(requests, 3, 'No extra generation or tool step repairs presentation');
  }
});
