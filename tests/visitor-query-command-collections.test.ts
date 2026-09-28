import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture, publisherVocabularies } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { buildVisitorTaskView, visitorCapabilities } from '../lib/visitor-capabilities';
import { websiteQueryCommand } from '../lib/visitor-query-command';
import { websiteCommandCanMatch } from '../lib/visitor-command-intent';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setup(space = taskFixture()) {
  const path = await mkdtemp(join(tmpdir(), 'website-command-'));
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(path));
  const session = await store.create(space.publication), context = { index, session, signal: new AbortController().signal };
  buildVisitorTaskView(context);
  return { context, close: () => rm(path, { recursive: true, force: true }), ask: async (text: string) => {
    assert.equal(websiteCommandCanMatch(text), true, `The browser must allow this published command: ${text}`);
    const command = websiteQueryCommand(text, context); assert.ok(command, text);
    await visitorCapabilities.get(command.capabilityId)!.execute(context, command.input);
    return buildVisitorTaskView(context);
  } };
}

test('collection display requests leave unexplained quantities and prose with the assistant across publisher domains', async () => {
  for (const [vocabulary, label, request] of [
    [publisherVocabularies[3], 'Indigenous Nations Named', 'Show me all six Indigenous nations named in this guide.'],
    [publisherVocabularies[1], 'Consulting Services', 'Show me all 6 consulting services described in this brochure.'],
    [publisherVocabularies[5], 'Research Groups Named', 'Show me all six research groups named in this report.'],
    [publisherVocabularies[6], 'Velari Clusters', 'Show me three velari clusters relevant to this project.'],
  ] as const) {
    const space = taskFixture(vocabulary, 6);
    space.collections[1].name = label; space.fields = [];
    const names = ['Coast Salish', 'Chinook', 'Nez Perce', 'Yakama', 'Kalapuya', 'Kootenai'];
    space.records.forEach((record, i) => { record.name = vocabulary.type === 'place' ? names[i] : `Published ${vocabulary.type} ${i}`; record.assertions = []; });
    space.records[0].summary = 'Six in this guide; described in this brochure and relevant to this project.';
    space.records[0].aliases = ['Summer example'];
    space.records.push({ id: 'unrelated-record', type: vocabulary.type, name: 'Winter example', summary: '', aliases: [], assertions: [], blocks: [] });
    space.memberships.push({ collectionId: 'cross', recordId: 'unrelated-record' });
    const { ask, context, close } = await setup(space);
    try {
      assert.equal((await ask(`Show me all ${label}`)).result.count.value, 6, 'Exact collection browsing stays local');
      const before = structuredClone(context.session);
      for (const text of [request, `Show me two ${label}`, `Show me the ${label} we discussed`, `Show me ${label} winter example`]) {
        assert.equal(websiteCommandCanMatch(text), true, 'Publication-aware routing still receives the request');
        assert.equal(websiteQueryCommand(text, context), null, text);
        assert.deepEqual(context.session, before, 'No partial scope, filter or display mutation precedes model interpretation');
      }
      assert.deepEqual((await ask(`Show me ${label} summer example`)).records.map(record => record.id), ['record-00000'], 'A member alias is a grounded qualifier');
      assert.equal((await ask(`Search for ${label} winter example`)).result.count.value, 0, 'An explicit keyword search is allowed to have no matches');
    } finally { await close(); }
  }
});

test('published numeric identities remain exact shortcuts, not guessed quantity instructions', async t => {
  const space = taskFixture();
  space.collections[1].name = 'Six Nations'; space.records[0].name = '6 Week Workshop'; space.records[1].aliases = ['Six Step Consultation'];
  const { ask, context, close } = await setup(space); t.after(close);
  assert.equal((await ask('Show me all Six Nations')).result.count.value, 8);
  assert.deepEqual(websiteQueryCommand('Show me 6 Week Workshop', context), { capabilityId: 'record.detail', input: { recordId: 'record-00000' } });
  assert.deepEqual(websiteQueryCommand('Show me Six Step Consultation', context), { capabilityId: 'record.detail', input: { recordId: 'record-00001' } });
});
