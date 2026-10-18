import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInvitations, invitationOptions } from '../scripts/create-invites';
import { invitationCodeHash } from '../lib/invitations';

test('invitation CLI requires the new project and bounds both batch size and lifetime', () => {
  assert.deepEqual(invitationOptions(['--project', 'flowpath-studio']), { projectId: 'flowpath-studio', count: 25, days: 30 });
  assert.deepEqual(invitationOptions(['--project', 'flowpath-studio', '--count', '100', '--days', '90']),
    { projectId: 'flowpath-studio', count: 100, days: 90 });
  for (const args of [[], ['--project', 'thevoice-93998'], ['--project', 'flowpath-studio', '--count', '0'],
    ['--project', 'flowpath-studio', '--count', '101'], ['--project', 'flowpath-studio', '--days', '91'],
    ['--project', 'flowpath-studio', '--days', '1.5'], ['--project', 'flowpath-studio', '--typo', '1']]) {
    assert.throws(() => invitationOptions(args));
  }
});

test('private codes exist before one publication, while only hashes reach the publisher', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'flowpath-invites-'));
  const directory = join(parent, 'private');
  try {
    let calls = 0;
    const result = await createInvitations({ projectId: 'flowpath-studio', count: 3, days: 7 }, async (project, documents) => {
      calls++;
      assert.equal(project, 'flowpath-studio');
      const [name] = await readdir(directory);
      const content = JSON.parse(await readFile(join(directory, name), 'utf8'));
      assert.equal(content.status, 'NOT_CONFIRMED');
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
      assert.equal(content.codes.length, 3);
      assert.equal(new Set(content.codes).size, 3);
      assert.deepEqual(documents.map(document => document.id), content.codes.map(invitationCodeHash));
      assert.equal(JSON.stringify(documents).includes('FP-'), false);
      for (const document of documents) {
        assert.equal(document.expiresAt - document.createdAt, 7 * 24 * 60 * 60 * 1_000);
        assert.equal(document.usedBy, null);
        assert.equal(document.usedAt, null);
      }
    }, directory);
    assert.equal(calls, 1);
    assert.equal(result.count, 3);
    const content = JSON.parse(await readFile(result.file, 'utf8'));
    assert.equal(content.status, 'PUBLISHED');
    assert.equal(content.projectId, 'flowpath-studio');
    assert.equal((await stat(result.file)).mode & 0o777, 0o600);
    assert.equal((await readdir(directory)).length, 1);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('a failed publication preserves private recovery codes without retries or credential error output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-invites-'));
  try {
    let calls = 0;
    await assert.rejects(createInvitations({ projectId: 'flowpath-studio', count: 1, days: 1 }, async () => {
      calls++;
      throw new Error('synthetic-private-provider-message');
    }, directory), (error: unknown) => error instanceof Error && error.message.includes('Publication was not confirmed')
      && !error.message.includes('synthetic-private-provider-message'));
    assert.equal(calls, 1);
    const [name] = await readdir(directory);
    const content = JSON.parse(await readFile(join(directory, name), 'utf8'));
    assert.equal(content.status, 'NOT_CONFIRMED');
    assert.match(content.codes[0], /^FP-[A-F0-9]{24}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
