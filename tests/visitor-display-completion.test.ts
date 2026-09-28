import test from 'node:test';
import assert from 'node:assert/strict';
import { queryDisplayOnlyRequest } from '../lib/visitor-command-intent';

test('display-only eligibility accepts polite requests and media as the collection subject', () => {
  for (const request of [
    'Please narrow this to vegan slices priced below eight dollars, ordered with the priciest first.',
    'Could you please filter services under $40, highest first?',
    'Only show the vegan pizza photo, please.',
    'Please show photos matching blue.',
    'Find portraits from the summer collection.',
    'Show matching paintings and sculptures.',
    'Include vegan and gluten-free items.',
  ]) assert.equal(queryDisplayOnlyRequest(request), true, request);
});

test('display-only eligibility keeps independent questions, enrichment, research and calculations running', () => {
  for (const request of [
    'Show photos from the web.',
    'Find images online.',
    'Show photos and calculate their prices.',
    'Show photos then explain the details.',
    'Show items and include pictures.',
    'Show photos and find the business address.',
    'Show photos, plus summarize the source.',
    'Show items and compare them.',
    'Show services under $40 and explain which is best.',
    'Show items with their tax-inclusive total.',
    'Show photos; tell me where they were taken.',
    'Why are these services the best?',
  ]) assert.equal(queryDisplayOnlyRequest(request), false, request);
});
