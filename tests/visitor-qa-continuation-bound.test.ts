import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorQaRequestBound, visitorQaContinuationRequestBound, visitorQaReasoningOutputBounds } from '../lib/visitor-qa-budget';

const item = { type: 'reasoning', id: 'synthetic-reasoning', encrypted_content: 'synthetic-opaque-content', summary: [] };
const request = { model: 'gpt-6-astra', reasoning: { effort: 'high' }, service_tier: 'default', store: false, max_output_tokens: 8192,
  instructions: 'Synthetic published content.', input: [item], tools: [] };
const response = { model: 'gpt-6-astra', status: 'completed', output: [item], usage: { output_tokens: 100 } };

test('pure continuation helpers preserve original output bound per exact item occurrence', () => {
  const known = visitorQaReasoningOutputBounds(response, request.model, request.max_output_tokens);
  assert.equal(known.length, 1);
  assert.match(known[0].digest, /^[a-f0-9]{64}$/);
  assert.equal(known[0].tokenBound, 8192, 'actual output usage must not shrink the original ceiling');
  assert.doesNotMatch(JSON.stringify(known), /synthetic-opaque/);
  const before = JSON.stringify(request);
  const bound = visitorQaContinuationRequestBound(request, known);
  assert.equal(bound.inputBound, Buffer.byteLength(before) + 20000 + 8192);
  assert.equal(bound.reservedMicros, Math.ceil(bound.inputBound * 12.5) + 8192 * 50);
  assert.equal(JSON.stringify(request), before);
  const duplicated = { ...request, input: [item, item] };
  assert.equal(visitorQaContinuationRequestBound(duplicated, [...known, { ...known[0], tokenBound: 512 }]).inputBound,
    Buffer.byteLength(JSON.stringify(duplicated)) + 20000 + 2 * 8192);
});

test('unknown or modified reasoning remains blocked and existing stateless preflight is unchanged', () => {
  const known = visitorQaReasoningOutputBounds(response, request.model, request.max_output_tokens);
  assert.throws(() => visitorQaRequestBound(request), /opaque reasoning/);
  assert.throws(() => visitorQaContinuationRequestBound(request, []), /opaque reasoning/);
  assert.throws(() => visitorQaContinuationRequestBound({ ...request, input: [{ ...item, encrypted_content: 'changed' }] }, known), /opaque reasoning/);
  assert.throws(() => visitorQaContinuationRequestBound(request, [{ ...known[0], tokenBound: 16384 }]), /supported output bound/);
  assert.throws(() => visitorQaReasoningOutputBounds(response, request.model, 16384), /original bound/);
  assert.deepEqual(visitorQaReasoningOutputBounds({ ...response, model: 'other-model' }, request.model, 8192), []);
  assert.deepEqual(visitorQaReasoningOutputBounds({ ...response, usage: { output_tokens: 8193 } }, request.model, 8192), []);
});
