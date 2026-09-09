import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import { AppError } from './errors';

const token = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
export const platformEventInputSchema = z.object({
  eventId: z.string().uuid().optional(),
  type: z.enum(['studio_visit', 'upload', 'extraction', 'interpretation', 'correction', 'preview', 'approval', 'publication', 'visitor_intent', 'presentation_accepted', 'presentation_rejected', 'outcome', 'provider_usage']),
  surface: z.enum(['preview', 'public']),
  operationId: token.optional(), requestId: token.optional(), snapshotId: token.optional(), assetId: token.optional(), entityId: token.optional(), capabilityId: token.optional(),
  operation: z.enum(['upload', 'extract', 'interpret', 'correct', 'preview', 'publish', 'discover', 'understand', 'narrow', 'compare', 'decide', 'act']).optional(),
  status: z.enum(['started', 'succeeded', 'failed', 'cancelled', 'rejected', 'ready', 'pending', 'observed', 'reserved', 'confirmed', 'unknown']).optional(),
  kind: z.enum(['txt', 'pdf', 'csv', 'text', 'chat', 'voice', 'display', 'selection', 'link_click', 'photo_view']).optional(),
  durationMs: z.number().int().min(0).max(3600000).optional(),
  count: z.number().int().min(0).max(10000).optional(),
  usage: z.object({ inputTokens: z.number().int().min(0).max(10000000).optional(), outputTokens: z.number().int().min(0).max(10000000).optional(), totalTokens: z.number().int().min(0).max(20000000).optional() }).strict().refine(usage => Object.keys(usage).length > 0, 'Token usage requires a measured value.').optional(),
}).strict();
export type PlatformEventInput = z.infer<typeof platformEventInputSchema>;
export const platformEventBatchSchema = z.object({ events: z.array(platformEventInputSchema).min(1).max(10) }).strict();
const eventSourceSchema = z.enum(['server', 'owner_client', 'visitor_client']);
type EventSource = z.infer<typeof eventSourceSchema>;
const savedEventSchema = platformEventInputSchema.omit({ eventId: true }).extend({
  id: z.string().uuid(), createdAt: z.number().int().nonnegative(), source: eventSourceSchema,
}).strict();
const ledgerSchema = z.object({ schemaVersion: z.literal(1), events: z.array(savedEventSchema).max(200), totalRecorded: z.number().int().nonnegative() }).strict();
type EventLedger = z.infer<typeof ledgerSchema>;
const globals = globalThis as typeof globalThis & { platformEventQueue?: Promise<unknown> };
const directory = () => join(process.env.VOICE_DATA_DIR || join(process.cwd(), 'data'), 'platform-events');
const pathFor = (siteId: string) => join(directory(), `${z.string().uuid().parse(siteId)}.json`);

function parseLedger(value: unknown): EventLedger {
  if (value === undefined) return { schemaVersion: 1, events: [], totalRecorded: 0 };
  const result = ledgerSchema.safeParse(value);
  if (!result.success) throw new AppError('Recent activity is temporarily unavailable.', 503);
  return result.data;
}

async function readLocal(siteId: string): Promise<EventLedger> {
  try { return parseLedger(JSON.parse(await readFile(pathFor(siteId), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseLedger(undefined); throw error; }
}

/** Only validated IDs/status/counts enter the ledger; no source text, prompts or URLs. */
export function appendPlatformEvents(value: unknown, inputs: PlatformEventInput[], source: EventSource = 'server', now = Date.now()): EventLedger {
  const ledger = parseLedger(value);
  const batch = platformEventInputSchema.array().min(1).max(10).parse(inputs);
  eventSourceSchema.parse(source);
  const seen = new Set(ledger.events.map(event => event.id));
  const recentClientCount = ledger.events.filter(event => event.source !== 'server' && event.createdAt > now - 60000).length;
  let acceptedClientCount = 0;
  for (const input of batch) {
    const { eventId, ...fields } = input;
    const id = eventId ?? randomUUID();
    if (seen.has(id)) continue;
    // Limit client-observed event writes per site; server operational events have their own request bounds.
    if (source !== 'server' && recentClientCount + acceptedClientCount >= 120) continue;
    // Firestore rejects undefined values; optional metadata must be absent in both backends.
    const metadata = JSON.parse(JSON.stringify(fields)) as typeof fields;
    ledger.events.push({ ...metadata, id, createdAt: now, source });
    seen.add(id);
    ledger.totalRecorded += 1;
    if (source !== 'server') acceptedClientCount += 1;
  }
  ledger.events = ledger.events.slice(-200);
  return ledger;
}

/** Caller has already authorized its site operation; event failure must not undo successful work. */
export async function recordPlatformEvents(siteId: string, inputs: PlatformEventInput[], source: EventSource = 'server'): Promise<void> {
  z.string().uuid().parse(siteId);
  platformEventInputSchema.array().min(1).max(10).parse(inputs);
  if (getBackendMode() === 'firebase') {
    const db = getFirestore(getFirebaseAdminApp());
    const ref = db.collection('voicePlatformEvents').doc(siteId);
    await db.runTransaction(async transaction => {
      const record = (await transaction.get(ref)).data();
      if (record && record.siteId !== siteId) throw new AppError('Recent activity is temporarily unavailable.', 503);
      const ledger = appendPlatformEvents(record?.ledger, inputs, source);
      transaction.set(ref, { siteId, ledger });
    }, { maxAttempts: 3 });
    return;
  }
  const queued = (globals.platformEventQueue ?? Promise.resolve()).then(async () => {
    const ledger = appendPlatformEvents(await readLocal(siteId), inputs, source);
    await mkdir(directory(), { recursive: true });
    const temporary = `${pathFor(siteId)}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 });
    await rename(temporary, pathFor(siteId));
  });
  globals.platformEventQueue = queued.catch(() => undefined);
  await queued;
}

export async function recordPlatformEvent(siteId: string, input: PlatformEventInput): Promise<void> {
  return recordPlatformEvents(siteId, [input]);
}

/** Counts describe the retained window, not lifetime conversion or retention rates. */
export async function readPlatformEventSummary(siteId: string) {
  z.string().uuid().parse(siteId);
  let ledger: EventLedger;
  if (getBackendMode() === 'firebase') {
    const data = (await getFirestore(getFirebaseAdminApp()).collection('voicePlatformEvents').doc(siteId).get()).data();
    if (data && data.siteId !== siteId) throw new AppError('Recent activity is temporarily unavailable.', 503);
    ledger = parseLedger(data?.ledger);
  } else {
    await globals.platformEventQueue;
    ledger = await readLocal(siteId);
  }
  const counts: Record<string, number> = {};
  for (const event of ledger.events) {
    const key = [event.surface, event.source, event.type, event.kind ?? 'unspecified', event.status ?? 'unspecified'].join(':');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { retained: ledger.events.length, limit: 200, totalRecorded: ledger.totalRecorded, counts,
    from: ledger.events[0]?.createdAt ?? null, through: ledger.events.at(-1)?.createdAt ?? null,
    window: 'recent_events' as const, events: ledger.events.slice(-20) };
}
