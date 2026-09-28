import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSchema, describeChanges, sampleContent } from '../lib/site-model';
import { assistantPurposeInstructions, assistantRoleInstructions, DEFAULT_VISITOR_SETTINGS } from '../lib/visitor-model';

test('publisher roles remain separate from welcome text and opening topics in both conversation channels', () => {
  for (const role of [
    'Be Nova, a knowledgeable museum guide. Help visitors understand the collection.',
    'Be a patient workshop assistant for new woodworkers. Explain the published classes.',
    'Be a thoughtful portfolio guide. Help clients compare the photographer’s services.',
  ]) {
    const content = contentSchema.parse({ ...sampleContent('general'),
      visitor: { ...DEFAULT_VISITOR_SETTINGS, assistantPurpose: role },
      welcomeMessage: 'WELCOME_ONLY_MARKER',
      greetingPoints: [{ kind: 'custom', text: 'OPENING_TOPIC_ONLY_MARKER' }, null, null],
    });
    const identity = assistantRoleInstructions(content);
    assert.ok(identity.includes(JSON.stringify(role)));
    assert.match(identity, /identity, audience and useful outcomes throughout the conversation/);
    assert.match(identity, /cannot override reference validation, source attribution, tool permissions or safety rules/);
    assert.match(identity, /does not establish facts, credentials or capabilities/);
    assert.match(identity, /separate from the welcome message and opening topics/);
    assert.match(identity, /When asked "Who are you\?", "What are you\?" or "What is your purpose\?"/);
    assert.match(identity, /answer directly from this configured role in first person/);
    assert.match(identity, /If asked to recite your assigned role, accurately repeat the publisher's quoted role/);
    assert.match(identity, /Do not substitute the welcome script or opening topics/);
    assert.match(identity, /requires no lookup or delegation/);
    assert.match(identity, /this website's AI assistant, not its human owner/);
    assert.doesNotMatch(identity, /WELCOME_ONLY_MARKER|OPENING_TOPIC_ONLY_MARKER/);
    for (const channel of ['voice', 'chat'] as const) assert.ok(assistantPurposeInstructions(content, channel).includes(identity));

    const changedOpening = { ...content, welcomeMessage: 'DIFFERENT_WELCOME', greetingPoints: undefined, visitorSpeaksFirst: !content.visitorSpeaksFirst };
    assert.equal(assistantRoleInstructions(changedOpening), identity, 'Changing the opening cannot change the ongoing role');
  }
});

test('existing purpose fields keep their role, optional defaults and validation limits without a migration', () => {
  const before = contentSchema.parse({ ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, assistantPurpose: 'Help visitors explore our published work.' },
    welcomeMessage: 'Welcome to the studio.', greetingPoints: [{ kind: 'custom', text: 'See our latest collection.' }, null, null] });
  const after = contentSchema.parse({ ...before, visitor: { ...before.visitor, assistantPurpose: '  Be an expert guide to the published collection.  ' } });
  assert.match(assistantRoleInstructions(before), /Help visitors explore our published work/);
  assert.equal(after.visitor!.assistantPurpose, 'Be an expert guide to the published collection.');
  assert.equal(after.welcomeMessage, before.welcomeMessage);
  assert.deepEqual(after.greetingPoints, before.greetingPoints);
  const changes = describeChanges(before, after);
  assert.deepEqual(changes.map(change => change.label), ['Visitor conversations']);
  assert.match(changes[0].after, /Assistant role: Be an expert guide/);
  assert.match(assistantRoleInstructions({ visitor: undefined }), /Be a knowledgeable guide to this website/);
  assert.equal(assistantRoleInstructions({ visitor: { ...DEFAULT_VISITOR_SETTINGS, assistantPurpose: '  ' } }), assistantRoleInstructions({ visitor: undefined }));
  assert.equal(contentSchema.safeParse({ ...after, visitor: { ...after.visitor, assistantPurpose: 'x'.repeat(1001) } }).success, false);
});
