import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { readPublishedContent, publishedContentTool, PUBLISHED_CONTENT_BYTES } from '../lib/visitor-published-content';
import { publishedWorkspace, workspaceInstructions } from '../lib/visitor-workspace';
import { sampleContent } from '../lib/site-model';
import { publishedProseFixture } from './helpers/published-prose-fixture';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { diagnosticError } from '../lib/visitor-diagnostics';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { visitorChatTask } from '../lib/visitor-chat-task';
import { readVisitorChatEvents } from '../lib/visitor-chat-protocol';
import { newSite, modifySite } from '../lib/site-store';
import { publicationContent } from '../lib/site-opening';
import { visitorAccess } from '../lib/visitor-store';

for (const [subject, detail] of [['cakes', 'Cocoa Cloud and Lemon Blossom'], ['services', 'Portrait sessions and editorial photography'], ['courses', 'Robotics and creative writing']]) {
  test(`long published ${subject} pages remain answerable in both channels without a display operation`, async () => {
    const catalog = publishedProseFixture(subject, detail), content = sampleContent('general', 'Synthetic publisher');
    const authority = publishedWorkspace(content, catalog), workspace = emptyWorkspace(authority.publicationId), question = `What ${subject} do you have?`;
    assert.throws(() => retrieveKnowledge(catalog, { revisionId: catalog.id, query: question, expansion: 1 }), /32,000/);
    const instructions = workspaceInstructions(workspace, authority, undefined, question, catalog, undefined, 'tool');
    const data = JSON.parse(instructions.split('\n').at(-1)!);
    assert.equal(data.knowledge.omitted.blocks, 11);
    assert.ok(data.knowledge.entities.every((entity: { blocks?: unknown }) => !entity.blocks));
    assert.equal(data.directory.filter((entry: { reference: { kind: string } }) => entry.reference.kind === 'entity').length, 11);
    assert.ok(data.publishedText.passages.some((passage: { text: string }) => passage.text.includes(detail)));
    assert.ok(Buffer.byteLength(JSON.stringify(data.publishedText)) <= PUBLISHED_CONTENT_BYTES);
    assert.ok(data.records.every((record: { keywords?: unknown }) => !record.keywords), 'Full text used for local indexing must not leak back into the prompt as keywords');
    for (const channel of ['chat', 'voice'] as const) {
      let calls = 0;
      const result = await runVisitorTask({ channel, model: 'offline-model', apiKey: 'synthetic', context: { request: question }, instructions, tools: [publishedContentTool], signal: new AbortController().signal,
        execute: async () => { throw new Error('No display or external lookup is needed'); }, fetch: async (_url, init) => {
          calls++; const sent = JSON.parse(String(init?.body)); assert.ok(sent.instructions.includes(detail));
          assert.ok(sent.instructions.includes('read_published_content'));
          return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: `The published offerings include ${detail}.` }] }] });
        } });
      assert.equal(calls, 1); assert.ok(result.text.includes(detail)); assert.deepEqual(workspace.objects, []);
    }
  });
}

test('published text is fully pageable, byte bounded and restricted to its publication', () => {
  const catalog = publishedProseFixture(), content = sampleContent('general');
  const text = '本日は公開情報を紹介します 🌲 '.repeat(200);
  catalog.entities[0].blocks = Array.from({ length: 10 }, (_, i) => ({ id: `section-${i}`, kind: 'paragraph' as const, text: `${i}: ${text}` }));
  const authority = publishedWorkspace(content, catalog), reference = authority.records.find(record => record.reference.id === 'offerings')!.reference;
  let offset: number | null = 0; const pieces = new Map<string, string[]>(); let pages = 0;
  do {
    const result = readPublishedContent({ query: '', reference, offset }, authority, catalog); pages++;
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= PUBLISHED_CONTENT_BYTES);
    assert.ok(result.passages.length > 0);
    for (const passage of result.passages) {
      assert.deepEqual(passage.reference, reference);
      assert.equal(passage.text.length, passage.end - passage.start);
      pieces.set(passage.blockId, [...pieces.get(passage.blockId) ?? [], passage.text]);
    }
    if (result.nextOffset !== null) assert.ok(result.nextOffset > offset!);
    offset = result.nextOffset;
  } while (offset !== null && pages < 100);
  assert.equal(offset, null); assert.ok(pages > 1);
  for (const block of catalog.entities[0].blocks) assert.equal(pieces.get(block.id)!.join(''), block.text);
  assert.throws(() => readPublishedContent({ query: '', reference: { ...reference, revisionId: 'old' }, offset: 0 }, authority, catalog), /reference/);
  assert.throws(() => readPublishedContent({ query: '', reference: { ...reference, id: 'private-draft' }, offset: 0 }, authority, catalog), /reference/);
  const other = publishedProseFixture('courses', 'Robotics'); other.id = 'another-publication';
  const otherAuthority = publishedWorkspace(content, other);
  assert.throws(() => readPublishedContent({ query: '', reference, offset: 0 }, otherAuthority, other), /reference/);
  assert.equal(readPublishedContent({ query: 'Cocoa', reference: null, offset: 0 }, otherAuthority, other).totalPassages, 0);
});

test('site-only content can be read in full and unknown content is not invented', () => {
  const content = sampleContent('general'); content.sections = [{ id: 'policy', title: 'Appointments', body: 'Consultations require two working days of notice.' }];
  const authority = publishedWorkspace(content);
  const result = readPublishedContent({ query: 'Consultations', reference: null, offset: 0 }, authority);
  assert.equal(result.passages[0].reference.kind, 'source'); assert.match(result.passages[0].text, /two working days/);
  assert.equal(readPublishedContent({ query: 'unpublished-secret', reference: null, offset: 0 }, authority).totalPassages, 0);
  assert.deepEqual(diagnosticError(new Error('Knowledge context exceeds 32,000 bytes.')), { reason: 'capacity' });
});

test('the actual chat stream reads published section content without navigation or search', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'published-content-chat-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await newSite(user, { name: 'Synthetic services', slug: 'synthetic-services', kind: 'general' });
    site = await modifySite(user, site.id, site.revision, stored => {
      stored.draft.sections = [{ id: 'services', title: 'Our services', body: 'We offer portrait sessions and editorial photography. Appointments must be confirmed.' }];
      stored.published = publicationContent(stored.draft); stored.publishedAt = new Date().toISOString();
    });
    const { content } = await visitorAccess(site.slug);
    const authority = publishedWorkspace(content), workspace = emptyWorkspace(authority.publicationId);
    const reference = authority.records.find(record => record.reference.id === 'section:services')!.reference;
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init.body)); calls++;
      assert.ok(body.tools.some((tool: { name: string }) => tool.name === 'read_published_content'));
      if (calls === 1) return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'published-read', name: 'read_published_content', arguments: JSON.stringify({ query: '', reference, offset: 0 }) }] });
      assert.ok(JSON.stringify(body.input).includes('Appointments must be confirmed.'));
      assert.ok(!JSON.stringify(body.input).includes('Private capture note'));
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'We offer portrait sessions and editorial photography.' }] }] });
    });
    const response = visitorChatTask({ slug: site.slug, siteId: site.id, content, signal: new AbortController().signal,
      request: { kind: 'chat', text: 'What services do you have?', requestId: randomUUID(), history: [], context: { workspace } },
      availability: { enabled: true, live: true, mode: 'both', chatRemaining: 10, voiceRemaining: 10, resetsAt: '' }, onUsage: () => {} });
    const events: { type: string; text?: string; stage?: string }[] = [];
    await readVisitorChatEvents(response.body!, new AbortController().signal, async event => { events.push(event); });
    assert.equal(calls, 2); assert.deepEqual(events.filter(event => event.type !== 'progress').map(event => event.type), ['control', 'done']);
    assert.ok(events.some(event => event.type === 'progress' && event.stage === 'retrieving'));
    assert.equal(events.find(event => event.type === 'done')?.text, 'We offer portrait sessions and editorial photography.');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
