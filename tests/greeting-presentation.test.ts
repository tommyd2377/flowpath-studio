import assert from 'node:assert/strict';
import test from 'node:test';
import { greetingCue, greetingVisuals, followGreeting } from '../lib/greeting-presentation';
import { sampleContent, type SiteContent } from '../lib/site-model';
import { openingWorkspace, publishedWorkspace } from '../lib/visitor-workspace';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import type { GreetingRecordTopic } from '../lib/greeting-records';

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

test('caption cues follow selected order even when an opening mentions later topic names', () => {
  assert.equal(greetingCue(points, 'Portrait sessions. Explore the neighborhood at your own pace.'), -1);
  assert.equal(greetingCue(points, 'Wedding stories, Portrait sessions, and Explore the neighborhood at your own pace.'), 0);
});

test('captions arriving before playback cannot skip the first topic or rotate on audio ticks', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(points, index => shown.push(index)); t.after(follower.cancel);
  follower.caption('Wedding stories.');
  follower.caption('Wedding stories. Portrait sessions.');
  assert.deepEqual(shown, []);
  follower.audio({ inputActive: false, outputActive: true });
  follower.audio({ inputActive: false, outputActive: true });
  follower.caption('Wedding stories. Portrait sessions.');
  assert.deepEqual(shown, [0]);
  follower.caption('Wedding stories. Portrait sessions. A portrait that feels like you.');
  assert.deepEqual(shown, [0, 1]);
});

const overlappingContent: SiteContent = { ...content, sections: [
  { id: 'story', title: 'Our story', body: 'Mara Lin opened this independent workshop to bring careful craftsmanship to the neighborhood.' },
  { id: 'visit', title: 'Visit our studio', body: 'Our accessible showroom welcomes visitors on the ground floor. Drop in to explore materials together.' },
  { id: 'founder', title: 'Mara Lin', body: 'Mara Lin is the founder. She guides the design practice and mentors the team each morning.' },
], greetingPoints: [{ kind: 'source', id: 'section:story' }, { kind: 'source', id: 'section:visit' }, { kind: 'source', id: 'section:founder' }] };
const overlappingPoints = greetingVisuals(overlappingContent, publishedWorkspace(overlappingContent));

test('an early founder mention cannot cue its later card while the location is being introduced', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(overlappingPoints, index => shown.push(index)); t.after(follower.cancel);
  let caption = 'Our story. Mara Lin opened this workshop many years ago.';
  follower.caption(caption);
  follower.audio({ inputActive: false, outputActive: true });
  assert.deepEqual(shown, [0]);
  caption += ' Visit our studio.'; follower.caption(caption);
  assert.deepEqual(shown, [0, 1]);
  caption += ' You will find our accessible showroom on the ground floor.'; follower.caption(caption);
  follower.audio({ inputActive: false, outputActive: true });
  assert.deepEqual(shown, [0, 1], 'The founder name before the location cue is already consumed.');
  caption += ' Now meet Mara'; follower.caption(caption);
  assert.deepEqual(shown, [0, 1], 'A split name is not yet a complete cue.');
  caption += ' Lin, who guides the design practice.'; follower.caption(caption);
  assert.deepEqual(shown, [0, 1, 2]);
});

test('published person topics accept an unambiguous first or last name only after the preceding cue', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const records: GreetingRecordTopic[] = [
    { id: 'story', title: 'Our story', kind: 'article', body: 'Mara Evelyn Westbrook opened the neighborhood workshop many years ago.' },
    { id: 'visit', title: 'Visit our studio', kind: 'place', body: 'The ground-floor showroom is accessible and welcomes visitors to explore materials.' },
    { id: 'founder', title: 'Mara Evelyn Westbrook', kind: 'type-person', body: 'Mara Evelyn Westbrook founded the workshop. She guides its design practice and mentors apprentices.' },
  ];
  const selected: SiteContent = { ...content, greetingPoints: records.map(record => ({ kind: 'record', id: record.id })) };
  const visuals = greetingVisuals(selected, publishedWorkspace(selected), null, records);
  assert.deepEqual(visuals[2].cueAliases, ['mara', 'westbrook']);
  for (const shortName of ['Mara', 'Westbrook']) {
    const shown: (number | null)[] = [];
    const follower = followGreeting(visuals, index => shown.push(index)); t.after(follower.cancel);
    let caption = 'Our story. Mara Evelyn Westbrook began this workshop.';
    follower.caption(caption); follower.audio({ inputActive: false, outputActive: true });
    caption += ' Visit our studio.'; follower.caption(caption);
    caption += ' You can explore our accessible showroom on the ground floor.'; follower.caption(caption);
    assert.deepEqual(shown, [0, 1], 'The founder name from the story cannot be reused.');
    caption += ` Now ${shortName}, known to friends by a nickname, brings that experience to every project.`; follower.caption(caption);
    assert.deepEqual(shown, [0, 1, 2]);
  }
  const productRecords = records.map(record => ({ ...record, kind: 'product' }));
  const products = greetingVisuals(selected, publishedWorkspace(selected), null, productRecords);
  assert.equal(products[2].cueAliases, undefined);
  assert.equal(greetingCue(products, 'Mara', 1), 1, 'Individual non-person words do not become fuzzy topic cues.');
});

test('shared first names are not person cues, while unique surnames and full names remain usable', () => {
  const records: GreetingRecordTopic[] = [
    { id: 'one', title: 'Mara Evelyn Westbrook', kind: 'person', body: 'A designer and mentor.' },
    { id: 'two', title: 'Mara Quinn Eastwood', kind: 'profile', body: 'A specialist in materials.' },
  ];
  const selected: SiteContent = { ...content, greetingPoints: records.map(record => ({ kind: 'record', id: record.id })) };
  const visuals = greetingVisuals(selected, publishedWorkspace(selected), null, records);
  assert.deepEqual(visuals.map(point => point.cueAliases), [['westbrook'], ['eastwood']]);
  assert.equal(greetingCue(visuals, 'Meet Mara.'), -1);
  assert.equal(greetingCue(visuals, 'Meet Westbrook.'), 0);
  assert.equal(greetingCue(visuals, 'Mara is here.', 0), 0);
  assert.equal(greetingCue(visuals, 'Eastwood is here.', 0), 1);
  assert.equal(greetingCue(visuals, 'Mara Quinn Eastwood is here.', 0), 1);
});

test('legacy published person entities support the same bounded name cues', () => {
  const catalog = { ...semanticFixture, entities: [...semanticFixture.entities, { id: 'mentor', name: 'Dr. Leona Grace Marshall', kind: 'person', summary: 'Leads the independent studio.', attributes: {} }] };
  const selected: SiteContent = { ...content, greetingPoints: [{ kind: 'entity', id: 'mentor' }, null, null] };
  const visuals = greetingVisuals(selected, publishedWorkspace(selected, catalog), catalog);
  assert.deepEqual(visuals[0].cueAliases, ['leona', 'marshall']);
  assert.equal(greetingCue(visuals, 'Leona welcomes you.'), 0);
  assert.equal(greetingCue(visuals, 'The doctor welcomes you.'), -1);
});

test('rolling caption tails retain the consumed cue boundary and assemble a later fragmented name', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(overlappingPoints, index => shown.push(index)); t.after(follower.cancel);
  let caption = 'Our story. ' + 'A thoughtful beginning. '.repeat(12) + 'Mara Lin started this business. ' + 'Each project has a personal connection. '.repeat(35);
  const append = (text: string) => { caption += text; follower.caption(caption.slice(-2000)); };
  append(''); follower.audio({ inputActive: false, outputActive: true });
  append(' Visit our studio.'); assert.deepEqual(shown, [0, 1]);
  append(' There is space to explore at your own pace. '.repeat(7));
  assert.ok(caption.length > 2000);
  assert.ok(caption.slice(-2000).includes('Mara Lin'), 'The retained window still includes the stale founder name.');
  assert.deepEqual(shown, [0, 1]);
  append(' Meet Mara'); assert.deepEqual(shown, [0, 1]);
  append(' Lin.'); assert.deepEqual(shown, [0, 1, 2]);
});

test('a revised caption retains an unchanged consumed topic prefix', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(points, index => shown.push(index)); t.after(follower.cancel);
  follower.audio({ inputActive: false, outputActive: true });
  follower.caption('Wedding stories, with a thoughtful documentary approach.');
  follower.caption('Wedding stories. Portrait sessions.');
  assert.deepEqual(shown, [0, 1]);
});

test('visuals wait for actual output activity, then finish without rotating on a timer', t => {
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
  assert.deepEqual(shown, [0, 1, 2, null], 'Completion is signalled as soon as output is quiet, without an extra pause');
  follower.caption('Portrait sessions.'); follower.audio({ inputActive: false, outputActive: true }); assert.equal(shown.length, 4);
});

test('manual cancellation and visitor speech abort pending visual work and ignore late captions', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const manual of [false, true]) {
    const shown: { index: number | null; signal: AbortSignal }[] = [];
    const follower = followGreeting(points, (index, signal) => shown.push({ index, signal }));
    follower.audio({ inputActive: false, outputActive: true });
    follower.caption('Wedding stories.');
    if (manual) follower.cancel(); else { follower.audio({ inputActive: true, outputActive: true }); follower.cancel(); }
    assert.ok(shown.every(item => item.signal.aborted));
    follower.caption('Wedding stories. Portrait sessions.'); t.mock.timers.tick(60_000);
    assert.deepEqual(shown.map(item => item.index), [0]);
  }
});

test('a generic hello never opens an unrelated card and empty selections do not create a topic', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const selected of [[], points]) {
    const shown: (number | null)[] = [];
    const follower = followGreeting(selected, index => shown.push(index));
    follower.caption("Welcome. I'm the site's AI assistant.");
    follower.audio({ inputActive: false, outputActive: true });
    follower.audio({ inputActive: false, outputActive: false });
    t.mock.timers.tick(60_000);
    assert.deepEqual(shown, []);
  }
});


test('microphone level alone does not cancel a spoken introduction', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(points, index => shown.push(index)); t.after(follower.cancel);
  follower.audio({ inputActive: true, outputActive: false });
  follower.caption('Wedding stories.');
  follower.audio({ inputActive: true, outputActive: true });
  assert.deepEqual(shown, [0]);
  follower.caption('Wedding stories. Portrait sessions.');
  assert.deepEqual(shown, [0, 1]);
  follower.cancel(); // Called by the recognized-speech callback.
  follower.caption('Wedding stories. Portrait sessions. Explore the neighborhood at your own pace.');
  assert.deepEqual(shown, [0, 1]);
});

test('repeated silent audio meter updates do not postpone completion indefinitely', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: (number | null)[] = [];
  const follower = followGreeting(points, index => shown.push(index)); t.after(follower.cancel);
  follower.caption('Wedding stories.'); follower.audio({ inputActive: false, outputActive: true });
  for (let tick = 0; tick < 20; tick++) {
    follower.audio({ inputActive: false, outputActive: false });
    t.mock.timers.tick(100);
  }
  assert.deepEqual(shown, [0, null]);
});
