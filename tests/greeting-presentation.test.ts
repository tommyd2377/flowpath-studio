import assert from 'node:assert/strict';
import test from 'node:test';
import { greetingCue, greetingVisuals, followGreeting } from '../lib/greeting-presentation';
import { sampleContent, type SiteContent } from '../lib/site-model';
import { openingWorkspace, publishedWorkspace } from '../lib/visitor-workspace';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';

const content: SiteContent = { ...sampleContent('photographer'), opening: { visibility: 'intro-only', tone: 'warm', highlights: [], featuredEntityIds: [], capabilityIds: [] },
  greetingPoints: [{ kind: 'source', id: 'section:weddings' }, { kind: 'source', id: 'section:portraits' }, { kind: 'custom', text: 'Explore the neighborhood at your own pace.' }] };
const authority = publishedWorkspace(content);
const points = greetingVisuals(content, authority);

test('greeting visuals preserve selected order and public custom text without revealing cards before speech', () => {
  assert.deepEqual(points.map(point => point.record.reference.id), ['section:weddings', 'section:portraits', 'greeting:3']);
  assert.equal(points[2].record.body, 'Explore the neighborhood at your own pace.');
  assert.equal(openingWorkspace(authority, content).objects.length, 0);
  const removed: SiteContent = { ...content, greetingPoints: [null, { kind: 'entity', id: 'unpublished' }, null] };
  assert.deepEqual(greetingVisuals(removed, publishedWorkspace(removed)), []);
  assert.equal(publishedWorkspace(removed).records.some(record => record.reference.id === 'greeting:3'), false);
});

test('entity and qualified fact cards use the same published references as ordinary browsing', () => {
  const chosen: SiteContent = { ...content, greetingPoints: [{ kind: 'entity', id: 'blue' }, null, { kind: 'fact', id: 'child-policy' }] };
  const visuals = greetingVisuals(chosen, publishedWorkspace(chosen, semanticFixture, semanticMediaFixture), semanticFixture);
  assert.deepEqual(visuals.map(point => point.slot), [0, 2]);
  assert.equal(visuals[0].record.reference.revisionId, semanticFixture.id);
  assert.match(visuals[1].text, /adult/i);
  assert.deepEqual(visuals[1].record.parent, { kind: 'entity', id: 'clay', revisionId: semanticFixture.id });
});

test('matching caption fragments advance subjects, tolerate wording changes, and never rewind', () => {
  assert.equal(greetingCue(points, "Welcome. I'm the site's AI assistant."), -1);
  assert.equal(greetingCue(points, 'Let me introduce our Wedding'), -1);
  assert.equal(greetingCue(points, 'Let me introduce our Wedding stories.'), 0);
  assert.equal(greetingCue(points, 'Wedding stories. We also have Portrait sessions.', 0), 1);
  assert.equal(greetingCue(points, 'Explore this neighborhood at a pace that suits you.', 1), 2);
  assert.equal(greetingCue(points, 'Wedding stories.', 2), 2);
});

test('visuals wait for actual output activity, then retain the carousel after quiet without rotating on a timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(points, index => shown.push(index)); t.after(follower.cancel);
  follower.caption('Wedding stories.'); assert.deepEqual(shown, []);
  follower.audio({ inputActive: false, outputActive: true }); assert.deepEqual(shown, [0]);
  t.mock.timers.tick(5000); assert.deepEqual(shown, [0]);
  follower.caption('Wedding stories. Portrait sessions.'); assert.deepEqual(shown, [0, 1]);
  follower.audio({ inputActive: false, outputActive: false }); t.mock.timers.tick(1000);
  follower.caption('Wedding stories. Portrait sessions. Explore the neighborhood at your own pace.');
  follower.audio({ inputActive: false, outputActive: true }); assert.deepEqual(shown, [0, 1, 2]);
  follower.audio({ inputActive: false, outputActive: false });
  assert.deepEqual(shown, [0, 1, 2, null], 'The last card returns as soon as output is quiet, without an extra pause');
  follower.caption('Portrait sessions.'); follower.audio({ inputActive: false, outputActive: true }); assert.equal(shown.length, 4);
});

test('manual cancellation and visitor speech abort pending visual work and ignore late captions', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const manual of [false, true]) {
    const shown: { index: number | null; signal: AbortSignal }[] = [];
    const follower = followGreeting(points, (index, signal) => shown.push({ index, signal }));
    follower.audio({ inputActive: false, outputActive: true });
    follower.caption('Wedding stories.');
    if (manual) follower.cancel(); else follower.audio({ inputActive: true, outputActive: true });
    assert.ok(shown.every(item => item.signal.aborted));
    follower.caption('Wedding stories. Portrait sessions.'); t.mock.timers.tick(60_000);
    assert.deepEqual(shown.map(item => item.index), [null, 0]);
  }
});
