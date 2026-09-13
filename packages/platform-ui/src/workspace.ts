import { z } from 'zod';
import { catalogFilterSchema, validateCatalogFilters, type KnowledgeCatalog } from './contracts.js';

export const WORKSPACE_LIMIT = 12;
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_:-]*$/);
export const workspaceReferenceSchema = z.object({
  kind: z.enum(['entity', 'fact', 'source', 'collection', 'album', 'photo', 'capability', 'external']),
  id, revisionId: id,
}).strict();
export type WorkspaceReference = z.infer<typeof workspaceReferenceSchema>;
export const workspaceComponentSchema = z.enum(['information', 'detail', 'photo', 'map', 'collection', 'gallery', 'comparison', 'actions', 'external']);
export type WorkspaceComponent = z.infer<typeof workspaceComponentSchema>;
export const workspaceOriginSchema = z.object({ objectId: id.nullable(), reference: workspaceReferenceSchema.nullable(),
  focusKey: z.string().max(240), scrollTop: z.number().int().min(0).max(10000000) }).strict();
export const workspaceObjectSchema = z.object({
  instanceId: id, component: workspaceComponentSchema, references: z.array(workspaceReferenceSchema).min(1).max(12),
  expanded: z.boolean(), selected: z.boolean(), layout: z.enum(['auto', 'wide']),
  origin: workspaceOriginSchema.nullable(), scrollTop: z.number().int().min(0).max(10000000),
  query: z.string().max(200).default(''), filters: z.array(catalogFilterSchema).max(24).default([]),
}).strict();
export type WorkspaceObject = z.infer<typeof workspaceObjectSchema>;
const objectInput = workspaceObjectSchema.pick({ instanceId: true, component: true, references: true });
export const workspaceOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), object: objectInput, origin: workspaceOriginSchema.nullable().optional() }).strict(),
  z.object({ kind: z.literal('update'), instanceId: id, component: workspaceComponentSchema, references: z.array(workspaceReferenceSchema).min(1).max(12) }).strict(),
  z.object({ kind: z.enum(['focus', 'close', 'expand', 'collapse']), instanceId: id }).strict(),
  z.object({ kind: z.literal('select'), instanceId: id, selected: z.boolean() }).strict(),
  z.object({ kind: z.literal('scroll'), instanceId: id, scrollTop: z.number().int().min(0).max(10000000) }).strict(),
  z.object({ kind: z.literal('filter'), instanceId: id, query: z.string().max(200), filters: z.array(catalogFilterSchema).max(24) }).strict(),
  z.object({ kind: z.literal('return') }).strict(),
  z.object({ kind: z.enum(['replace', 'reset']), objects: z.array(objectInput).max(WORKSPACE_LIMIT) }).strict(),
]);
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>;
export const workspaceBatchSchema = z.object({ schemaVersion: z.literal(1), requestId: id, publicationId: id,
  baseRevision: z.number().int().min(0).max(1000000), sceneRevision: z.number().int().min(0).max(1000000).optional(),
  operations: z.array(workspaceOperationSchema).min(1).max(16),
}).strict();
export type WorkspaceBatch = z.infer<typeof workspaceBatchSchema>;
export const workspaceStateSchema = z.object({ schemaVersion: z.literal(1), publicationId: id, revision: z.number().int().min(0).max(1000000),
  objects: z.array(workspaceObjectSchema).max(WORKSPACE_LIMIT), focusedId: id.nullable(),
  focusHistory: z.array(id).max(WORKSPACE_LIMIT),
  receipts: z.array(z.object({ requestId: id, fingerprint: z.string().max(20000) }).strict()).max(24),
}).strict();
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export type WorkspaceRecord = { reference: WorkspaceReference; name: string; component: WorkspaceComponent; body?: string;
  parent?: WorkspaceReference; members?: WorkspaceReference[]; keywords?: string; example?: boolean };
export type WorkspaceAuthority = { publicationId: string; records: WorkspaceRecord[]; catalog?: KnowledgeCatalog };
export function referenceKey(ref: WorkspaceReference) { return `${ref.kind}:${ref.revisionId}:${ref.id}`; }
/** Stable spoken grid codes: four slots per letter, independent of responsive reflow. */
export function externalItemLabel(index: number) { return `${String.fromCharCode(65 + Math.floor(index / 4))}${index % 4 + 1}`; }
export function emptyWorkspace(publicationId: string): WorkspaceState {
  return { schemaVersion: 1, publicationId, revision: 0, objects: [], focusedId: null, focusHistory: [], receipts: [] };
}
function fail(message: string): never { throw new Error(message); }
export function workspaceRecord(authority: WorkspaceAuthority, ref: WorkspaceReference) {
  return authority.records.find(record => referenceKey(record.reference) === referenceKey(ref));
}
function validateObject(object: WorkspaceObject, authority: WorkspaceAuthority) {
  const records = object.references.map(ref => workspaceRecord(authority, ref) ?? fail('This content is not in the current publication.'));
  if (new Set(object.references.map(referenceKey)).size !== object.references.length) fail('Content references must be distinct.');
  const kinds = records.map(record => record.reference.kind);
  const valid = object.component === 'comparison' ? records.length >= 2 && records.length <= 6 && kinds.every(kind => kind === 'entity')
    : object.component === 'map' ? records.length === 1 && ['entity', 'fact', 'source'].includes(kinds[0])
    : object.component === 'gallery' ? kinds.every(kind => ['photo', 'album'].includes(kind))
    : object.component === 'collection' ? kinds.every(kind => ['entity', 'collection'].includes(kind))
    : object.component === 'actions' ? kinds.every(kind => kind === 'capability')
    : records.length === 1 && records[0].component === object.component;
  if (!valid) fail('This component cannot display those references.');
  if (object.filters.length) {
    if (object.component !== 'collection' || !authority.catalog) fail('Filters require published catalog content.');
    validateCatalogFilters(object.filters, authority.catalog);
  }
  if (object.component === 'comparison' && !authority.catalog?.attributes.some(attribute => records.every(record => authority.catalog!.entities.find(entity => entity.id === record.reference.id)?.attributes[attribute.id] != null))) fail('These items have no shared published attributes for a comparison.');
  if (object.origin?.reference && !workspaceRecord(authority, object.origin.reference)) fail('The return origin is not published.');
}
export function validateWorkspace(value: unknown, authority: WorkspaceAuthority): WorkspaceState {
  const state = workspaceStateSchema.parse(value);
  if (state.publicationId !== authority.publicationId) fail('The publication changed. Reload to continue.');
  const ids = new Set(state.objects.map(object => object.instanceId));
  if (ids.size !== state.objects.length || state.focusedId && !ids.has(state.focusedId)
    || state.focusHistory.some(id => !ids.has(id)) || new Set(state.focusHistory).size !== state.focusHistory.length) fail('Invalid workspace identity or focus.');
  state.objects.forEach(object => validateObject(object, authority));
  if (state.objects.reduce((sum, object) => sum + object.references.length, 0) > 36 || JSON.stringify({ ...state, receipts: [] }).length > 24000) fail('This workspace has reached its reference capacity. Use published collections or close an object; nothing was removed.');
  return state;
}
const materialize = (object: z.infer<typeof objectInput>, origin: WorkspaceObject['origin'] = null): WorkspaceObject => ({ ...object, expanded: false, selected: false, layout: 'auto', scrollTop: 0, query: '', filters: [], origin });

/** Atomic semantic operations. No DOM, provider, URLs, content generation or silent eviction. */
export function applyWorkspaceBatch(current: WorkspaceState, input: unknown, authority: WorkspaceAuthority, sceneRevision?: number): { state: WorkspaceState; status: 'accepted' | 'duplicate'; aliases?: Record<string, string> } {
  if (JSON.stringify(input).length > 20000) fail('The workspace request is too large.');
  const batch = workspaceBatchSchema.parse(input);
  validateWorkspace(current, authority);
  if (batch.publicationId !== current.publicationId) fail('The publication changed. Reload to continue.');
  const fingerprint = JSON.stringify(batch);
  const receipt = current.receipts.find(receipt => receipt.requestId === batch.requestId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) fail('A request ID was reused with conflicting operations.');
    return { state: current, status: 'duplicate' };
  }
  // Closing the entire unchanged set does not depend on where cards moved.
  // Partial/spatial actions still require the original scene; all actions keep
  // the publication and workspace revision guards (including late clears).
  const clearsAll = batch.operations.length === 1 && (batch.operations[0].kind === 'reset' || batch.operations[0].kind === 'replace') && batch.operations[0].objects.length === 0
    || batch.operations.every(operation => operation.kind === 'close') && current.objects.every(object => batch.operations.some(operation => operation.kind === 'close' && operation.instanceId === object.instanceId));
  if (batch.baseRevision !== current.revision || !clearsAll && batch.sceneRevision !== undefined && batch.sceneRevision !== sceneRevision) fail('The workspace changed. Use its current objects before trying again.');
  const next = structuredClone(current);
  const aliases: Record<string, string> = {};
  const get = (id: string) => next.objects.find(object => object.instanceId === (aliases[id] ?? id)) ?? fail('That object is no longer open.');
  function focus(id: string | null) {
    if (id) get(id);
    if (next.focusedId && next.focusedId !== id) next.focusHistory = [...next.focusHistory.filter(key => key !== next.focusedId && key !== id), next.focusedId].slice(-WORKSPACE_LIMIT);
    next.focusedId = id;
  }
  for (const op of batch.operations) {
    if (op.kind === 'add') {
      const existing = next.objects.find(object => object.instanceId === op.object.instanceId);
      if (existing) {
        if (existing.component !== op.object.component || JSON.stringify(existing.references) !== JSON.stringify(op.object.references)) fail('That object ID already identifies different content.');
        if (op.origin !== undefined) existing.origin = op.origin;
      } else {
        // Reopening an identical, unfiltered reference reuses its existing surface.
        // Distinct references, comparison order, and filtered collections stay distinct.
        const same = next.objects.find(object => object.component === op.object.component && !object.query && !object.filters.length
          && JSON.stringify(object.references.map(referenceKey)) === JSON.stringify(op.object.references.map(referenceKey)));
        if (same) aliases[op.object.instanceId] = same.instanceId;
        else next.objects.push(materialize(op.object, op.origin ?? null));
      }
    } else if (op.kind === 'replace' || op.kind === 'reset') {
      if (op.kind === 'reset' && op.objects.length) fail('Reset must be empty. Use replace for explicit replacement.');
      next.objects = op.objects.map(object => materialize(object)); next.focusedId = null; next.focusHistory = [];
    } else if (op.kind === 'return') {
      next.focusedId = next.focusHistory.pop() ?? null;
    } else if ('instanceId' in op) {
      const object = get(op.instanceId);
      if (op.kind === 'close') {
        next.objects = next.objects.filter(item => item !== object);
        next.focusHistory = next.focusHistory.filter(id => id !== object.instanceId);
        if (next.focusedId === object.instanceId) next.focusedId = next.focusHistory.pop() ?? (object.origin?.objectId && next.objects.some(item => item.instanceId === object.origin!.objectId) ? object.origin.objectId : null);
      } else if (op.kind === 'focus') focus(object.instanceId);
      else if (op.kind === 'expand' || op.kind === 'collapse') { object.expanded = op.kind === 'expand'; object.layout = object.expanded ? 'wide' : 'auto'; }
      else if (op.kind === 'select') object.selected = op.selected;
      else if (op.kind === 'scroll') object.scrollTop = op.scrollTop;
      else if (op.kind === 'filter') { object.query = op.query; object.filters = op.filters; }
      else if (op.kind === 'update') { object.component = op.component; object.references = op.references; }
    }
  }
  if (next.objects.length > WORKSPACE_LIMIT) fail(`The workspace holds ${WORKSPACE_LIMIT} objects. Close an object or explicitly replace the workspace; nothing was removed.`);
  next.revision++;
  next.receipts = [...next.receipts, { requestId: batch.requestId, fingerprint }].slice(-24);
  validateWorkspace(next, authority);
  return { state: next, status: 'accepted', aliases };
}

const box = z.object({ x: z.number().int().min(-10000000).max(10000000), y: z.number().int().min(-10000000).max(10000000), width: z.number().int().min(0).max(100000), height: z.number().int().min(0).max(100000) }).strict();
export const workspaceSceneSchema = z.object({ revision: z.number().int().min(0).max(1000000), workspaceRevision: z.number().int().min(0).max(1000000),
  visibility: z.enum(['visible', 'hidden']), focusedId: id.nullable(),
  page: z.enum(['home', 'browse', 'workspace']).optional(),
  browseItems: z.array(z.object({ reference: workspaceReferenceSchema, order: z.number().int().min(1).max(24) }).strict()).max(24).optional(),
  highlightedReference: workspaceReferenceSchema.nullable().optional(),
  keyboardFocusId: id.nullable().optional(),
  pageScroll: z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict().optional(),
  modal: z.object({ kind: z.enum(['photo', 'external']), reference: workspaceReferenceSchema, selectedId: id }).strict().nullable().optional(),
  objects: z.array(z.object({ instanceId: id, order: z.number().int().min(1).max(WORKSPACE_LIMIT), name: z.string().max(160),
    references: z.array(workspaceReferenceSchema).min(1).max(12), open: z.literal(true), mounted: z.boolean(),
    visibility: z.enum(['unmounted', 'offscreen', 'partial', 'full', 'obscured', 'hidden']),
    position: z.enum(['left', 'center', 'right']), rect: box.nullable(), selected: z.boolean(), expanded: z.boolean(),
    sections: z.array(z.string().max(80)).max(8).optional(),
    items: z.array(z.object({ reference: workspaceReferenceSchema, order: z.number().int().min(1).max(200), visible: z.boolean() }).strict()).max(24).optional(),
    controls: z.array(z.enum(['focus', 'expand', 'collapse', 'close', 'select', 'return', 'lightbox', 'scroll'])).max(8),
    scroll: z.object({ top: z.number().int().min(0).max(10000000), height: z.number().int().min(0).max(10000000), viewport: z.number().int().min(0).max(100000) }).strict().nullable(),
  }).strict()).max(WORKSPACE_LIMIT),
}).strict();
export type WorkspaceScene = z.infer<typeof workspaceSceneSchema>;

/** Spatial words resolve only against measured visible objects; ordinals use acknowledged order. */
export function resolveWorkspaceTarget(state: WorkspaceState, scene: WorkspaceScene | undefined, query: string): string | null {
  if (!scene || scene.workspaceRevision !== state.revision || scene.visibility !== 'visible') return null;
  const text = query.toLowerCase();
  let candidates = scene.objects.filter(object => object.mounted && !['hidden', 'obscured', 'unmounted'].includes(object.visibility));
  const kind = /\b(?:photo|picture|image)\b/.test(text) && !/\bclose the map\b/.test(text) ? 'photo' : /\bmap\b/.test(text) ? 'map' : null;
  if (kind) candidates = candidates.filter(object => state.objects.find(item => item.instanceId === object.instanceId)?.component === kind);
  const position = /\bleft\b/.test(text) ? 'left' : /\bright\b/.test(text) ? 'right' : null;
  if (position) candidates = candidates.filter(object => object.position === position && ['full', 'partial'].includes(object.visibility));
  const ordinal = text.match(/\b(first|second|third|fourth|fifth)\b/)?.[1];
  if (ordinal) return candidates.sort((a, b) => a.order - b.order)[['first', 'second', 'third', 'fourth', 'fifth'].indexOf(ordinal)]?.instanceId ?? null;
  const named = candidates.filter(object => text.includes(object.name.toLowerCase()));
  if (named.length === 1) return named[0].instanceId;
  if (!position && /\b(that|this|it|done)\b/.test(text) && candidates.some(object => object.instanceId === scene.focusedId)) return scene.focusedId;
  return candidates.length === 1 ? candidates[0].instanceId : null;
}
