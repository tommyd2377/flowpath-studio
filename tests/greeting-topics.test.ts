import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticFixture } from '../fixtures/semantic-knowledge/graph';
import { sampleContent } from '../lib/site-model';
import { greetingTopicChoices, selectGreetingEditorialTopics } from '../lib/greeting-topics';
import { greetingCommentaryParts, greetingDescription, greetingOpeningInstructions } from '../lib/site-greeting';

test('opening themes stay small regardless of individual menu items or facts', () => {
  const catalog = { ...semanticFixture, collections: [], relationships: [], facts: [], capabilities: [], entities: [
    ...Array.from({ length: 70 }, (_, i) => ({ id: `product-${i}`, kind: 'product', name: `Product ${i}`, summary: 'A single product.', attributes: {} })),
    { id: 'about', kind: 'article', name: 'About our business', summary: 'Our history.', attributes: {} },
    { id: 'story', kind: 'article', name: 'Our story', summary: 'We began as a neighborhood workshop and now teach small groups to make their own ceramics.', attributes: {} },
    { id: 'services', kind: 'article', name: 'Our services', summary: 'We teach classes and create commissioned pieces.', attributes: {} },
    { id: 'visit', kind: 'information', name: 'Plan your visit', summary: 'Find our studio beside the station. Visits are by arrangement.', attributes: {} },
    { id: 'terms', kind: 'article', name: 'Terms of service', summary: 'Legal terms.', attributes: {} },
  ] };
  const choices = greetingTopicChoices({ ...sampleContent('general'), sections: [], hours: '', contact: '' }, catalog);
  assert.deepEqual(choices.map(choice => choice.point), [{ kind: 'entity', id: 'story' }, { kind: 'entity', id: 'services' }, { kind: 'entity', id: 'visit' }]);
  assert.ok(choices.every(choice => choice.topic?.body));
});

test('personal portfolios use substantive sections without a business-specific catalog', () => {
  const content = { ...sampleContent('photographer'), hours: '', contact: '', sections: [
    { id: 'biography', title: 'About me', body: 'I document everyday life using natural light. My practice began with family portraits.' },
    { id: 'process', title: 'Working together', body: 'Every project starts with a conversation. We agree the scope before setting a date.' },
    { id: 'work', title: 'Selected work', body: 'Explore portraits and documentary projects.' },
  ] };
  const choices = greetingTopicChoices(content);
  assert.equal(choices.length, 3);
  assert.ok(choices.some(choice => choice.point.kind === 'source' && choice.point.id === 'section:process'));
  assert.ok(choices.every(choice => choice.topic!.body.length > 20));
});

test('a service SKU with a story-like name is not mistaken for an introduction theme', () => {
  assert.deepEqual(selectGreetingEditorialTopics([
    { id: 'single', title: 'Our story consultation', kind: 'service', body: 'A paid one-hour service.' },
    { id: 'story', title: 'Our story', kind: 'type-article', body: 'A team of independent designers founded this practice.' },
  ]).map(topic => topic.id), ['story']);
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `article-${i}`, title: `Article ${i}`, kind: 'article', body: 'Substantive published information.' }));
  assert.ok(selectGreetingEditorialTopics(many).length <= 6);
});

test('Live receives complete short paragraphs and silent source labels, not a heading-reading script', () => {
  const body = greetingDescription('An about section.', [
    { kind: 'paragraph', text: 'The studio was founded by two sisters.' },
    { kind: 'paragraph', text: 'They teach small groups using locally sourced clay.' },
  ]);
  const content = { ...sampleContent('general'), sections: [{ id: 'about', title: 'About', body }], greetingPoints: [{ kind: 'source' as const, id: 'section:about' }, null, null] };
  const parts = greetingCommentaryParts(content);
  assert.match(parts[1], /silent organizing label/);
  assert.match(parts[1], /two sisters.*locally sourced clay/s);
  assert.ok(parts.every(part => part.length <= 2000));
  const instruction = greetingOpeningInstructions('Use English.');
  assert.match(instruction, /two or three natural sentences/);
  assert.match(instruction, /exception to terse acknowledgement/);
  assert.match(instruction, /Do not pad a short source/);
});
