import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { diagnosticError, sanitizeVisitorDiagnostic, visitorDiagnostic, visitorDiagnostics, subscribeVisitorDiagnostics, clearVisitorDiagnostics } from '../lib/visitor-diagnostics';
import { parseWorkspaceReply, publishedWorkspace, workspaceJsonSchema } from '../lib/visitor-workspace';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { sampleContent } from '../lib/site-model';
const event = { traceId: '00000000-0000-4000-8000-000000000001', channel: 'server' as const, stage: 'backend' as const, status: 'failed' as const };
test('diagnostics retain only allowlisted metadata, reject unsafe IDs and bound memory', () => {
  const unsafe = { ...event, prompt: 'private text', token: 'secret', error: 'provider payload', url: 'https://private.example', durationMs: 2.7 };
  assert.deepEqual(sanitizeVisitorDiagnostic(unsafe, 123), { ...event, at: 123, durationMs: 3 });
  assert.equal(sanitizeVisitorDiagnostic({ ...event, traceId: 'private-text' }), null);
  clearVisitorDiagnostics(); let notified = 0; const unsubscribe = subscribeVisitorDiagnostics(() => notified++);
  for (let revision = 0; revision < 405; revision++) visitorDiagnostic({ ...event, revision });
  assert.equal(visitorDiagnostics().length, 400); assert.equal(visitorDiagnostics()[0].revision, 5); assert.equal(notified, 405);
  unsubscribe(); clearVisitorDiagnostics(); assert.equal(notified, 405);
});
test('request failures expose safe classifications and schema fields, never values or arbitrary keys', () => {
  const parsed = z.object({ input: z.object({ collectionId: z.string() }) }).safeParse({ input: { collectionId: { token: 'private-value' } } });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(diagnosticError(parsed.error), { reason: 'schema', schemaPath: 'input.collectionId' });
  const dynamic = z.record(z.string(), z.string()).safeParse({ 'private-key': false });
  if (!dynamic.success) assert.deepEqual(diagnosticError(dynamic.error), { reason: 'schema', schemaPath: '*' });
  assert.deepEqual(diagnosticError(Object.assign(new Error('The conversation backend rejected the request.'), { status: 400 })), { httpStatus: 400, reason: 'provider' });
  assert.deepEqual(sanitizeVisitorDiagnostic({ ...event, schemaPath: 'input.private-key.0.collectionId' }, 123), { ...event, at: 123, schemaPath: 'input.*.0.collectionId' });
});
test('unacknowledged task and final-answer displays retain a bounded failure category', () => {
  for (const message of ['Task display was not acknowledged.', 'The answer card was not acknowledged.']) {
    const classified = diagnosticError(new Error(message));
    assert.deepEqual(classified, { reason: 'display' });
    assert.deepEqual(sanitizeVisitorDiagnostic({ ...event, ...classified }, 123), { ...event, at: 123, reason: 'display' });
  }
  assert.deepEqual(diagnosticError(new Error('An arbitrary private display detail')), {});
});
test('chat can explain without changing state, while voice tools reject answer fields', () => {
  const authority = publishedWorkspace(sampleContent('general')), state = emptyWorkspace(authority.publicationId);
  const reply = { batch: null, clarification: '', answer: 'General historical background.' };
  assert.deepEqual(parseWorkspaceReply(reply, state, authority, undefined, true), { message: reply.answer });
  assert.throws(() => parseWorkspaceReply(reply, state, authority));
  assert.equal(state.objects.length, 0);
  assert.throws(() => parseWorkspaceReply({ ...reply, answer: 'x'.repeat(2001) }, state, authority, undefined, true));
});

test('provider workspace contracts use supported unions and require every object property', () => {
  for (const chat of [false, true]) {
    const schema = workspaceJsonSchema(chat);
    let unions = 0;
    function inspect(value: unknown) {
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      assert.equal('oneOf' in node, false);
      if (node.anyOf) unions++;
      if (node.type === 'object') {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual(new Set(node.required as string[]), new Set(Object.keys(node.properties as object)));
      }
      Object.values(node).forEach(inspect);
    }
    inspect(schema); assert.ok(unions > 0);
  }
});


test('recoverable failures remain recorded without triggering a console error overlay', t => {
  const previous = process.env.NODE_ENV;
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  try {
    Object.assign(process.env, { NODE_ENV: 'development' });
    clearVisitorDiagnostics();
    visitorDiagnostic({ ...event, channel: 'browser', sessionElapsedMs: 111766 });
    assert.equal(error.mock.callCount(), 0);
    assert.equal(warn.mock.callCount(), 1);
    const recorded = visitorDiagnostics()[0];
    assert.equal(recorded.status, 'failed');
    assert.equal(recorded.sessionElapsedMs, 111766);
    assert.equal(recorded.durationMs, undefined);
    assert.deepEqual(JSON.parse(warn.mock.calls[0].arguments[1]), recorded);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.assign(process.env, { NODE_ENV: previous });
    clearVisitorDiagnostics();
  }
});
