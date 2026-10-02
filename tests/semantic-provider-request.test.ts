import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSemanticProviderRequest } from '../lib/ingestion';
import { websiteOfferings } from '../lib/website-structure';

const input = { filename: 'Workshop guide.html', source: 'Café workshop: Session $40; four weekly lessons.\nBring safety glasses.', sourceAnchors: [{ id: 'page-1', excerpt: 'Session $40' }] };
const schema = { type: 'object', properties: { complete: { type: 'boolean' } }, required: ['complete'], additionalProperties: false };
const structuredOfferings = websiteOfferings([{ url: 'https://workshop.example/classes', text: '# Workshop\nPractical lessons for new makers.\n## Classes\n### Woodworking basics\nSession: $40, Series: $150\nFour weekly sessions.\n### Finishing techniques\nSession: $35, Series: $120\nSupplies included.' }], { strict: true });

// Captured from the original inline production request before extracting the builder.
// Keep complete serialized bytes stable across every conditional prompt branch.
const cases: { name: string; context: Parameters<typeof buildSemanticProviderRequest>[2]; correction?: string; bytes: number; sha256: string }[] = [
  { name: 'ordinary import', context: {}, bytes: 6425, sha256: '88aba146f916b5842c054397a78c8d9b0babbce29129a12eaf03ee8805629b39' },
  { name: 'empty correction', context: {}, correction: '', bytes: 6425, sha256: '88aba146f916b5842c054397a78c8d9b0babbce29129a12eaf03ee8805629b39' },
  { name: 'related sources', context: { related: true }, bytes: 7124, sha256: 'c01707a3ae98e4685740a1e508f38642779f2c5f858869c7e918eb42a8509aee' },
  { name: 'website', context: { website: true }, bytes: 7991, sha256: '4459b80d5cf9acb686cd29cdeb653b5b7fd452992cd2c1d0cb7e920c2fab3d7b' },
  { name: 'website offerings and correction', context: { website: true, related: true, structuredOfferings }, correction: 'Change the workshop name to Harbor Studio.', bytes: 9980, sha256: '4c3b09dbdfdb68431793810ca587dbdc3dd287320c7108070d1329144759cab7' },
];

for (const fixture of cases) {
  test(`semantic request builder preserves original bytes: ${fixture.name}`, () => {
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
