import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticFixture } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { defaultWelcomeMessage, greetingPointText, greetingPointTopic, validateGreeting, welcomeMessageParts } from '../lib/site-greeting';

const content = sampleContent('general');
test('entity introductions contain approved substance and qualified facts instead of a title alone', () => {
  assert.match(greetingPointText({ kind: 'entity', id: 'blue' }, content, semanticFixture)!, /Blue Bowl.*Price: USD 35/s);
  const topic = greetingPointTopic({ kind: 'entity', id: 'clay' }, content, semanticFixture)!;
  assert.equal(topic.title, 'Clay Basics');
  assert.match(topic.body, /under age: 12.*requires: adult-accompaniment/s);
  const catalog = { ...semanticFixture, entities: semanticFixture.entities.map(entity => entity.id === 'blue' ? { ...entity, summary: 'Hand-finished stoneware for everyday use.' } : entity) };
  assert.match(greetingPointText({ kind: 'entity', id: 'blue' }, content, catalog)!, /Hand-finished stoneware.*USD 35/s);
  assert.equal(greetingPointText({ kind: 'entity', id: 'missing' }, content, catalog), null);
});

test('whole qualified or conflicting fact values remain attached to their subject', () => {
  const text = greetingPointText({ kind: 'fact', id: 'child-policy' }, content, semanticFixture)!;
  assert.match(text, /Clay Basics.*Children may attend.*adult-accompaniment/s);
  const catalog = { ...semanticFixture, facts: [...semanticFixture.facts!, { id: 'different-address', entityId: 'harbor', field: 'properties.address', value: '99 Other Street', definition: { id: 'address', label: 'Address', type: 'text' as const } }] };
  const conflict = greetingPointText({ kind: 'fact', id: 'address' }, content, catalog)!;
  assert.match(conflict, /Conflicting approved assertions.*12 Example Lane.*99 Other Street/s);
});

test('zero through three topics retain their order and each complete Live passage fits the append bound', () => {
  const sections = ['A', 'B', 'C'].map(id => ({ id, title: `Subject ${id}`, body: `${id} approved description. `.repeat(55) + `Only available by prior arrangement for ${id}.` }));
  for (let count = 0; count <= 3; count++) {
    const selected = { ...content, sections, welcomeMessage: 'A short custom welcome.', greetingPoints: sections.map((section, index) => index < count ? { kind: 'source' as const, id: `section:${section.id}` } : null) };
    validateGreeting(selected);
    const parts = welcomeMessageParts(selected);
    assert.ok(parts.every(part => part.length < 2000));
    assert.equal(parts[0], 'A short custom welcome.', 'Publisher welcome is retained before every topic count');
    if (!count) assert.deepEqual(parts, ['A short custom welcome.']);
    else for (let index = 0; index < count; index++) {
      assert.ok(parts[index + 1].startsWith(sections[index].title));
      assert.ok(parts[index + 1].endsWith(`Only available by prior arrangement for ${sections[index].id}.`));
    }
  }
});

test('topic introductions use a contextual default and blank editing slots never become spoken topics', () => {
  const selected = { ...content, welcomeMessage: '   ', greetingPoints: [{ kind: 'custom' as const, text: 'Visit our open studio on Saturdays.' }, null, null] };
  const parts = welcomeMessageParts(selected);
  assert.equal(parts[0], defaultWelcomeMessage(content.name, true));
  assert.doesNotMatch(parts[0], /What would you like/);
  assert.match(parts.at(-1)!, /What would you like to explore/);
  const blank = { ...selected, greetingPoints: [{ kind: 'custom' as const, text: '  ' }, null, null] };
  assert.equal(greetingPointTopic(blank.greetingPoints[0]!, blank), null);
  assert.deepEqual(welcomeMessageParts(blank), [defaultWelcomeMessage(content.name)]);
  assert.throws(() => validateGreeting(blank), /no longer available/);
});

test('overlong material requires a concise approved point instead of cutting off its conditions', () => {
  const selected = { ...content, sections: [{ id: 'long', title: 'Long topic', body: 'Information. '.repeat(150) + 'Except on weekends.' }], greetingPoints: [{ kind: 'source' as const, id: 'section:long' }, null, null] };
  assert.throws(() => validateGreeting(selected), /shorter theme or write a short approved point/);
});


test('a page introduction explains approved content rather than its abstract label', () => {
  const catalog = { ...semanticFixture, entities: semanticFixture.entities.map(entity => entity.id === 'clay' ? { ...entity, summary: 'Class history and values.', blocks: [{ id: 'story', kind: 'paragraph' as const, text: 'The workshop teaches hand-building in small groups. Children need adult accompaniment.' }] } : entity) };
  const topic = greetingPointTopic({ kind: 'entity', id: 'clay' }, content, catalog)!;
  assert.match(topic.body, /teaches hand-building in small groups/);
  assert.match(topic.body, /Children need adult accompaniment/);
});

test('v2 selections require resolved published records and share their complete topic text', () => {
  const site = { ...content, greetingPoints: [{ kind: 'record' as const, id: 'workshop' }, null, null] };
  const records = [{ id: 'workshop', title: 'Small-group workshop', body: 'Available by arrangement. Adult accompaniment required.' }];
  assert.throws(() => validateGreeting(site), /no longer available/);
  validateGreeting(site, null, records);
  assert.match(welcomeMessageParts(site, null, records)[1], /Adult accompaniment required/);
});
