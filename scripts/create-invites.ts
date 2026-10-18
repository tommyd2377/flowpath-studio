import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { getFirebaseAccountServices } from '../lib/firebase-accounts';
import { INVITATIONS_COLLECTION, generateInvitationCode, invitationCodeHash } from '../lib/invitations';

type InvitationOptions = { projectId: string; count: number; days: number };
type InvitationDocument = { id: string; createdAt: number; expiresAt: number; usedBy: null; usedAt: null };
type Publisher = (projectId: string, documents: InvitationDocument[]) => Promise<void>;

export function invitationOptions(args: string[]): InvitationOptions {
  const { values } = parseArgs({ args, options: {
    project: { type: 'string' }, count: { type: 'string', default: '25' }, days: { type: 'string', default: '30' },
  } });
  if (values.project !== 'flowpath-studio') throw new Error('Explicit --project flowpath-studio is required. No other project is supported.');
  const integer = (value: string | undefined, maximum: number, label: string) => {
    if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) {
      throw new Error(`--${label} must be an integer from 1 to ${maximum}.`);
    }
    return Number(value);
  };
  return { projectId: values.project, count: integer(values.count, 100, 'count'), days: integer(values.days, 90, 'days') };
}

async function publishInvitations(projectId: string, documents: InvitationDocument[]) {
  const { db } = getFirebaseAccountServices(projectId, '(default)');
  const batch = db.batch();
  for (const { id, ...document } of documents) batch.create(db.collection(INVITATIONS_COLLECTION).doc(id), document);
  await batch.commit();
}

export async function createInvitations(options: InvitationOptions, publish: Publisher = publishInvitations,
  directory = join(process.cwd(), '.local-invites')) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error('The private invitation directory must not be a symbolic link.');
  await chmod(directory, 0o700);
  const createdAt = Date.now();
  const expiresAt = createdAt + options.days * 24 * 60 * 60 * 1_000;
  const codes = Array.from({ length: options.count }, generateInvitationCode);
  if (new Set(codes).size !== codes.length) throw new Error('Duplicate invitation generated; no invitations were published.');
  const file = join(directory, `${new Date(createdAt).toISOString().replaceAll(':', '-')}-${randomUUID()}.json`);
  const content = { status: 'NOT_CONFIRMED', projectId: options.projectId, createdAt, expiresAt, codes };
  await writeFile(file, `${JSON.stringify(content, null, 2)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  try {
    await publish(options.projectId, codes.map(code => ({ id: invitationCodeHash(code)!, createdAt, expiresAt, usedBy: null, usedAt: null })));
  } catch {
    throw new Error(`Publication was not confirmed. Recovery file: ${file}. Do not share its codes until publication is verified. Use an already authorized Application Default Credentials runtime; no login or retry was attempted.`);
  }
  const confirmed = `${file}.confirmed`;
  try {
    await writeFile(confirmed, `${JSON.stringify({ ...content, status: 'PUBLISHED' }, null, 2)}\n`, { flag: 'wx', mode: 0o600, flush: true });
    await rename(confirmed, file);
  } catch {
    throw new Error(`The batch was published, but its local status could not be saved. Recovery file: ${file}. Do not rerun automatically.`);
  }
  return { file, projectId: options.projectId, count: codes.length, expiresAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await createInvitations(invitationOptions(process.argv.slice(2)));
    console.info(`Published ${result.count} single-use invitations for ${result.projectId}. Private file: ${result.file}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invitation creation failed.');
    process.exitCode = 1;
  }
}
