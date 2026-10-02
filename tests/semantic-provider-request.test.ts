import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSemanticProviderRequest } from '../lib/ingestion';
import { websiteOfferings } from '../lib/website-structure';
import { WEBSITE_CONTENT_BRIEF } from '../lib/website-content';

const input = { filename: 'Workshop guide.html', source: 'Café workshop: Session $40; four weekly lessons.\nBring safety glasses.', sourceAnchors: [{ id: 'page-1', excerpt: 'Session $40' }] };
const schema = { type: 'object', properties: { complete: { type: 'boolean' } }, required: ['complete'], additionalProperties: false };
const structuredOfferings = websiteOfferings([{ url: 'https://workshop.example/classes', text: '# Workshop\nPractical lessons for new makers.\n## Classes\n### Woodworking basics\nSession: $40, Series: $150\nFour weekly sessions.\n### Finishing techniques\nSession: $35, Series: $120\nSupplies included.' }], { strict: true });

// Ordinary branches retain the original inline production request bytes.
// Website branches intentionally include content brief v2; all other fields stay unchanged.
const cases: { name: string; context: Parameters<typeof buildSemanticProviderRequest>[2]; correction?: string; bytes: number; sha256: string }[] = [
  { name: 'ordinary import', context: {}, bytes: 6425, sha256: '88aba146f916b5842c054397a78c8d9b0babbce29129a12eaf03ee8805629b39' },
  { name: 'empty correction', context: {}, correction: '', bytes: 6425, sha256: '88aba146f916b5842c054397a78c8d9b0babbce29129a12eaf03ee8805629b39' },
  { name: 'related sources', context: { related: true }, bytes: 7124, sha256: 'c01707a3ae98e4685740a1e508f38642779f2c5f858869c7e918eb42a8509aee' },
  { name: 'website', context: { website: true }, bytes: 8427, sha256: '9ae33eb7b554964e0ae08ba50759ce235a4f53e903648b50f44702d6bcb77e69' },
  { name: 'website offerings and correction', context: { website: true, related: true, structuredOfferings }, correction: 'Change the workshop name to Harbor Studio.', bytes: 10416, sha256: 'c78ddf6503286469398db23b0d4a7c8dc2920a16d988f2beeb1f9e5e9deae28e' },
];

for (const fixture of cases) {
  test(`semantic request builder preserves versioned bytes: ${fixture.name}`, () => {
    const before = JSON.stringify({ input, schema, context: fixture.context });
    const request = buildSemanticProviderRequest(input, schema, fixture.context, fixture.correction);
    const body = JSON.stringify(request);
    assert.equal(Buffer.byteLength(body), fixture.bytes);
    assert.equal(createHash('sha256').update(body).digest('hex'), fixture.sha256);
    assert.equal(request.model, 'gpt-6.1-sol');
    assert.deepEqual(request.reasoning, { effort: 'high' });
    assert.equal(request.service_tier, 'default');
    assert.equal(request.max_output_tokens, 32768);
    assert.equal(request.store, false);
    assert.equal(request.text.format.schema, schema);
    assert.deepEqual(request.input[0], { role: 'user', content: JSON.stringify(input) });
    assert.equal(request.input.length, fixture.correction ? 2 : 1);
    assert.equal(JSON.stringify({ input, schema, context: fixture.context }), before);
  });
}

test('website guidance changes only instructions, including related sources, host offerings and corrections', () => {
  for (const fixture of cases) {
    const ordinary = buildSemanticProviderRequest(input, schema, { ...fixture.context, website: false }, fixture.correction);
    const website = buildSemanticProviderRequest(input, schema, { ...fixture.context, website: true }, fixture.correction);
    assert.equal(website.instructions.split(WEBSITE_CONTENT_BRIEF).length, 2);
    assert.deepEqual({ ...website, instructions: website.instructions.replace(` ${WEBSITE_CONTENT_BRIEF}`, '') }, ordinary);
  }
});
