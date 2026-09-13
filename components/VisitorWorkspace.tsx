'use client';
import LoadingIndicator from './LoadingIndicator';

import { useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import { AdaptiveWorkspace, ContentCard, PublishedWebsite, DisclosureStack, ExternalSearchResults, ExternalSearchViewer, MediaImage, MotionHeight, PresentationView } from '@thevoice/platform-ui';
import { initialInteraction } from '@thevoice/platform-ui/interaction';
import { filterEntities, formatAttribute } from '@thevoice/platform-ui/catalog';
import { assertionActive, projectKnowledgeCatalog, retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import type { KnowledgeCatalog, PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { applyWorkspaceBatch, referenceKey, workspaceRecord, type WorkspaceBatch, type WorkspaceObject, type WorkspaceOperation, type WorkspaceRecord, type WorkspaceReference, type WorkspaceScene, type WorkspaceState } from '@thevoice/platform-ui/workspace';
import { acknowledgeWorkspace, captureWorkspaceScene, workspaceElementVisible } from '@/lib/workspace-screen';
import { namedWorkspaceRecords, objectInput, openingWorkspace, planWorkspaceIntent, publishedWorkspace, workspaceBatch, workspaceFact, workspaceFromPlan, workspaceFromSources, workspaceLocation } from '@/lib/visitor-workspace';
import { annotationMatches, annotationTargetForObject, exploreContextForResult, exploreResultSchema, exploreSettings, type AnnotationTarget, type ExploreCommand, type ExploreContext, type ExploreResult } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';
import type { SitePresentation } from '@/lib/site-presentation';
import { siteStyle } from '@/lib/site-style';
import { knowledgeValueText } from '@/lib/knowledge-display';
import { searchPlacement } from '@/lib/explore-workspace';
import { publishedNameGroup, websiteEntry, websiteSections } from '@/lib/website-presentation';
import { openingCopy } from '@/lib/site-opening';
import { greetingVisuals } from '@/lib/greeting-presentation';

export type VisitorWorkspaceHandle = {
  greeting: (index: number | null, signal: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  context: () => { workspace: WorkspaceState; scene?: WorkspaceScene; externalResults?: ExploreContext[]; explore?: ExploreContext };
  apply: (batch: WorkspaceBatch, signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  intent: (text: string, signal?: AbortSignal) => Promise<boolean>;
  plan: (plan: PresentationPlan | SitePresentation, signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  navigate: (kind: string, id?: string, ids?: string[], signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  showExternal: (result: unknown, signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  confirm: (signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  externalCommand: (command: ExploreCommand) => boolean;
  annotationTarget: (text: string) => AnnotationTarget | undefined;
  browse: (signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  home: (signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled'>;
  beforeSearch: (target?: AnnotationTarget) => void;
  reset: () => void;
};
export default function VisitorWorkspace({ content, catalog, media, handleRef, onInteraction, onContext, onInvoke, onPhotoView, onAnnotate, onHome, onReset, pendingAnnotationId }: {
  pendingAnnotationId?: string;
  content: SiteContent; catalog?: KnowledgeCatalog | null; media?: MediaLibrary | null; handleRef?: Ref<VisitorWorkspaceHandle>;
  onInteraction: () => void; onContext?: () => void; onInvoke?: () => void; onPhotoView?: (id: string) => void;
  onHome?: () => void; onReset?: () => void;
  onAnnotate?: (target: AnnotationTarget, name: string) => void;
}) {
  const [external, setExternal] = useState<ExploreResult[]>([]);
  const [externalSelection, setExternalSelection] = useState<Record<string, string | null>>({});
  const [externalKinds, setExternalKinds] = useState<Record<string, ExploreResult['kind']>>({});
  const [externalActive, setExternalActive] = useState<string | null>(null);
  const displayCatalog = useMemo(() => catalog ? projectKnowledgeCatalog(catalog) : null, [catalog]);
  const authority = useMemo(() => publishedWorkspace(content, catalog, media, external.map(result => ({ resultId: result.id, kind: result.kind, images: [], selectedImageId: null, map: result.map }))), [content, catalog, media, external]);
  const authorityRef = useRef(authority);
  useLayoutEffect(() => { authorityRef.current = authority; }, [authority]);
  const [state, setState] = useState(() => openingWorkspace(authority, content));
  const current = useRef(state);
  const scene = useRef<WorkspaceScene | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');
  const [greetingIds, setGreetingIds] = useState<string[]>([]);

  const [error, setError] = useState('');
  const [highlighted, setHighlighted] = useState<WorkspaceReference | null>(null);
  const [focusKeyboard, setFocusKeyboard] = useState(true);
  const contextCallback = useRef(onContext);
  useLayoutEffect(() => { contextCallback.current = onContext; }, [onContext]);
  const capture = useCallback(() => {
    scene.current = captureWorkspaceScene(root.current, current.current, authorityRef.current, scene.current);
    contextCallback.current?.();
  }, []);
  useEffect(() => {
    const element = root.current; if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; capture(); }, 150); };
    const mutations = new MutationObserver(schedule);
    // Portalled focus and modal photos also belong to this workspace's scene.
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'inert', 'aria-hidden', 'open', 'data-workspace-transition'] });
    const resize = new ResizeObserver(schedule); resize.observe(element);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); document.addEventListener('visibilitychange', schedule);
    capture();
    return () => { clearTimeout(timer); mutations.disconnect(); resize.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); document.removeEventListener('visibilitychange', schedule); };
  }, [capture]);
  async function apply(batch: WorkspaceBatch, signal?: AbortSignal, moveFocus = false, invoke = true) {
    if (signal?.aborted) return 'cancelled' as const;
    if (document.visibilityState !== 'visible') return 'failed' as const;
    try {
      const previousFocus = current.current.focusedId;
      const accepted = applyWorkspaceBatch(current.current, batch, authorityRef.current, scene.current?.revision);
      // A non-focused result (such as a comparison or search grid) must not
      // stay behind Browse mode's hidden workspace. Focused cards keep their
      // website return context; new workspace views reveal the workspace.
      if (!accepted.state.focusedId && batch.operations.some(operation => operation.kind === 'add' || operation.kind === 'replace')) setBrowsing(false);
      current.current = accepted.state; setFocusKeyboard(moveFocus && accepted.state.focusedId !== previousFocus); setState(accepted.state); setError(''); if (invoke) onInvoke?.();
      if (accepted.status !== 'duplicate' && batch.operations.some(op => op.kind === 'reset' || op.kind === 'replace')) {
        const kept = new Set(accepted.state.objects.flatMap(object => object.references.filter(ref => ref.kind === 'external').map(ref => ref.id)));
        setExternal(items => items.filter(item => kept.has(item.id)));
        setExternalSelection(items => Object.fromEntries(Object.entries(items).filter(([id]) => kept.has(id))));
        setExternalKinds(items => Object.fromEntries(Object.entries(items).filter(([id]) => kept.has(id))));
        setExternalActive(id => id && kept.has(id) ? id : null);
      }
      const requiredIds = batch.operations.flatMap(operation => operation.kind === 'add' ? [operation.object.instanceId]
        : operation.kind === 'replace' ? operation.objects.map(object => object.instanceId)
        : 'instanceId' in operation && operation.kind !== 'close' ? [operation.instanceId] : []).map(id => accepted.aliases?.[id] ?? id);
      const status = await acknowledgeWorkspace(root.current, () => current.current, authorityRef.current, accepted.state.revision, signal, requiredIds);
      const photo = accepted.state.objects.find(object => object.instanceId === accepted.state.focusedId)?.references.find(ref => ref.kind === 'photo');
      if (status === 'applied' && photo && accepted.state.focusedId !== previousFocus) onPhotoView?.(photo.id);
      capture();
      return status;
    } catch (error) { setError(error instanceof Error ? error.message : 'The workspace could not change.'); return 'failed' as const; }
  }
  function manual(operations: WorkspaceOperation[]) { setHighlighted(null); onInteraction(); void apply(workspaceBatch(current.current, operations), undefined, true); }
  async function spotlight(record: WorkspaceRecord, signal?: AbortSignal) {
    if (signal?.aborted) return 'cancelled' as const;
    const key = referenceKey(record.reference);
    const candidates = [...document.querySelectorAll<HTMLElement>('[data-workspace-content], [data-workspace-object]')].filter(element => {
      if (element.closest('[inert], [aria-hidden="true"]')) return false;
      return element.dataset.workspaceContent === key || current.current.objects.some(object => object.instanceId === element.dataset.workspaceObject && object.references.some(ref => referenceKey(ref) === key));
    });
    const visible = candidates.some(workspaceElementVisible);
    if (!visible) return 'failed' as const;
    setHighlighted(record.reference);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    capture(); return signal?.aborted ? 'cancelled' as const : scene.current?.highlightedReference && referenceKey(scene.current.highlightedReference) === key ? 'applied' as const : 'failed' as const;
  }
  function reset() {
    setGreetingIds([]);
    onReset?.();
    manual([{ kind: 'reset', objects: [] }]);
    setExternal([]); setExternalSelection({}); setExternalKinds({}); setExternalActive(null);
  }
  async function home(signal?: AbortSignal) {
    if (signal?.aborted) return 'cancelled' as const;
    setGreetingIds([]);
    setBrowsing(false); setQuery(''); setError(''); setHighlighted(null);
    setExternal([]); setExternalSelection({}); setExternalKinds({}); setExternalActive(null);
    const opening = openingWorkspace(authorityRef.current, content);
    const status = await apply(workspaceBatch(current.current, [{ kind: 'replace', objects: opening.objects.map(({ instanceId, component, references }) => ({ instanceId, component, references })) }]), signal, false, false);
    root.current?.closest('[data-visitor-site]')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    capture(); return status;
  }
  async function browse(signal?: AbortSignal) {
    if (signal?.aborted) return 'cancelled' as const;
    if (!signal) onInteraction(); setBrowsing(true); setQuery(''); setHighlighted(null); onInvoke?.();
    if (current.current.focusedId) await apply(workspaceBatch(current.current, Array.from({ length: current.current.focusHistory.length + 1 }, () => ({ kind: 'return' as const }))), signal, false);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise<void>(resolve => {
      const start = performance.now(); let prior = '', stable = 0;
      const settle = () => {
        const site = root.current?.querySelector<HTMLElement>('[data-published-website]');
        const bounds = site?.getBoundingClientRect(); const position = bounds ? String(Math.round(bounds.top + window.scrollY)) : '';
        stable = position && position === prior ? stable + 1 : 0; prior = position;
        if (signal?.aborted || !site || stable > 6 && performance.now() - start > 850 || performance.now() - start > 1400) {
          if (!signal?.aborted) site?.scrollIntoView({ block: 'start', behavior: 'instant' }); resolve();
        } else requestAnimationFrame(settle);
      }; requestAnimationFrame(settle);
    });
    capture(); return 'applied' as const;
  }
  const homeClick = () => { if (onHome) onHome(); else { onInteraction(); onReset?.(); void home(); } };
  function open(record: WorkspaceRecord, component = record.component, originObject?: WorkspaceObject, focus = true) {
    const group = component === 'detail' ? publishedNameGroup(record, authorityRef.current, catalog) : [record];
    const object = group.length > 1 ? { instanceId: `entries-${group[0].reference.id}`.slice(0, 100), component: 'collection' as const, references: group.map(item => item.reference) } : objectInput(record, component);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const origin = { objectId: originObject?.instanceId ?? null, reference: originObject?.references[0] ?? record.reference,
      focusKey: active?.dataset.workspaceContent ?? '', scrollTop: Math.round(active?.closest('[data-workspace-scroll]')?.scrollTop ?? 0) };
    manual([...(originObject ? [{ kind: 'scroll' as const, instanceId: originObject.instanceId, scrollTop: origin.scrollTop }] : []), { kind: 'add', object, origin }, ...(focus ? [{ kind: 'focus' as const, instanceId: object.instanceId }] : [])]);
  }
  function currentExternalId() {
    const open = external.filter(isRetained).map(result => result.id);
    return current.current.objects.find(object => object.instanceId === current.current.focusedId)?.references.find(ref => ref.kind === 'external')?.id
      ?? external.findLast(result => result.annotationTarget?.instanceId === current.current.focusedId && isRetained(result))?.id
      ?? (externalActive && open.includes(externalActive) ? externalActive : open.at(-1));
  }
  function isRetained(result: ExploreResult) {
    return result.annotationTarget ? annotationMatches(result.annotationTarget, current.current) : current.current.objects.some(object => object.references.some(ref => ref.kind === 'external' && ref.id === result.id));
  }
  function externalCommand(command: ExploreCommand, resultId = currentExternalId()) {
    const result = external.find(item => item.id === resultId);
    if (!result) return false;
    setExternalActive(result.id);
    if (command.kind === 'open_image' || command.kind === 'open_source') { if (command.kind === 'open_image' ? !result.images.some(image => image.id === command.id) : !result.sources.some((_, index) => command.id === `source-${index + 1}`)) return false; setExternalSelection({ [result.id]: command.id }); }
    else if (command.kind === 'back') { if (externalSelection[result.id]) setExternalSelection(value => ({ ...value, [result.id]: null })); else if (result.annotationTarget) setExternal(items => items.filter(item => item.id !== result.id)); else { const object = current.current.objects.find(object => object.references.some(ref => ref.kind === 'external' && ref.id === result.id)); if (object) manual([{ kind: 'close', instanceId: object.instanceId }]); } }
    else if (command.kind === 'images' || command.kind === 'web') { if (command.kind === 'images' && !result.images.length) return false; setExternalKinds(value => ({ ...value, [result.id]: command.kind as 'images' | 'web' })); }
    else { if (!result.map) return false; setExternal(items => items.map(item => item.id === result.id ? { ...item, map: { ...item.map!, zoom: Math.max(2, Math.min(12, item.map!.zoom + (command.kind === 'zoom_in' ? 1 : -1))) } } : item)); }
    requestAnimationFrame(capture); return true;
  }
  useImperativeHandle(handleRef, () => ({
    context: () => {
      scene.current = captureWorkspaceScene(root.current, current.current, authorityRef.current, scene.current);
      const externalContexts = external.filter(isRetained).map(result => exploreContextForResult(result, externalKinds[result.id] ?? result.kind, externalSelection[result.id] ?? null));
      const explore = externalContexts.find(result => result.resultId === currentExternalId());
      return { workspace: { ...current.current, receipts: [] }, scene: scene.current, ...(externalContexts.length ? { externalResults: externalContexts } : {}), ...(explore ? { explore } : {}) };
    },
    apply,
    greeting: async (index, signal) => {
      if (signal.aborted) return 'cancelled';
      const points = greetingVisuals(content, authorityRef.current, catalog);
      const objects = points.map(point => objectInput(point.record, point.record.component, current.current.objects.find(object => object.component === point.record.component && object.references.length === 1 && referenceKey(object.references[0]) === referenceKey(point.record.reference))?.instanceId));
      const ids = [...new Set(objects.map(object => object.instanceId))];
      if (!ids.length || index !== null && !objects[index]) return 'failed';
      const operations: WorkspaceOperation[] = [];
      for (const object of objects) if (!current.current.objects.some(item => item.instanceId === object.instanceId)) operations.push({ kind: 'add', object });
      // Each narrated card returns to the rail, without building a Back stack of the introduction.
      if (current.current.focusedId && ids.includes(current.current.focusedId)) operations.push({ kind: 'return' });
      if (index !== null) operations.push({ kind: 'focus', instanceId: objects[index].instanceId });
      setGreetingIds(ids);
      return operations.length ? apply(workspaceBatch(current.current, operations), signal) : 'applied';
    },
    intent: async (text, signal) => {
      if (/\b(highlight|spotlight)\b/i.test(text)) {
        const records = namedWorkspaceRecords(text, authorityRef.current, catalog);
        if (records.length === 1 && await spotlight(records[0], signal) === 'applied') return true;
        setError('Name one visible published item to highlight.'); return false;
      }
      capture(); const result = planWorkspaceIntent(text, current.current, authorityRef.current, scene.current, catalog, media);
      if (!result.batch) { setError(result.message); return false; }
      return await apply(result.batch, signal) === 'applied';
    },
    plan: async (plan, signal) => {
      try { return await apply('schemaVersion' in plan && catalog ? workspaceFromPlan(plan, current.current, authorityRef.current, catalog, media)
        : workspaceFromSources(plan as SitePresentation, current.current, authorityRef.current, content, media), signal); }
      catch { return 'failed'; }
    },
    navigate: async (kind, id, ids, signal) => {
      const state = current.current;
      if (kind === 'spotlight') {
        const record = authorityRef.current.records.find(record => record.reference.id === id || `${record.reference.kind}:${record.reference.id}` === id);
        return record ? spotlight(record, signal) : 'failed';
      }
      setHighlighted(null);
      if (kind === 'back' || kind === 'collapse') return apply(workspaceBatch(state, [{ kind: 'return' }]), signal);
      if (kind === 'compare' && ids && catalog) return apply(workspaceBatch(state, [{ kind: 'add', object: { instanceId: `compare-${ids.join('-')}`.slice(0, 100), component: 'comparison', references: ids.map(id => ({ kind: 'entity', id, revisionId: catalog.id })) } }]), signal);
      const existing = state.objects.find(object => object.instanceId === id);
      if (existing) return apply(workspaceBatch(state, [{ kind: kind === 'expand' ? 'expand' : 'focus', instanceId: existing.instanceId }]), signal);
      const record = authorityRef.current.records.find(record => record.reference.id === id || `${record.reference.kind}:${record.reference.id}` === id);
      if (!record) return 'failed';
      const object = objectInput(record);
      return apply(workspaceBatch(state, [{ kind: 'add', object }, { kind: 'focus', instanceId: object.instanceId }]), signal);
    },
    confirm: signal => acknowledgeWorkspace(root.current, () => current.current, authorityRef.current, current.current.revision, signal),
    showExternal: async (raw, signal) => {
      if (signal?.aborted) return 'cancelled';
      const result = exploreResultSchema.parse(raw), settings = exploreSettings(content);
      if (!settings.enabled || result.kind === 'images' && !settings.images || result.kind === 'map' && !settings.maps || result.annotationTarget && (!settings.annotations || !annotationMatches(result.annotationTarget, current.current))) throw new Error('This external view is disabled or its published card has changed.');
      const placement = searchPlacement(current.current, external.filter(item => item.id !== result.id).map(item => exploreContextForResult(item, item.kind, null)), result.annotationTarget);
      const next = [...external.filter(isRetained).filter(item => !placement.retired.includes(item.id) && item.id !== result.id), result];
      const close = placement.close.map(instanceId => ({ kind: 'close' as const, instanceId }));
      setExternalSelection({});
      if (result.annotationTarget) {
        if (close.length || current.current.focusedId !== result.annotationTarget.instanceId) {
          const status = await apply(workspaceBatch(current.current, [...close, { kind: 'focus', instanceId: result.annotationTarget.instanceId }]), signal);
          if (status !== 'applied') return status;
        }
        if (signal?.aborted || !annotationMatches(result.annotationTarget, current.current)) return 'cancelled';
        setExternal(next); setExternalActive(result.id); onInvoke?.();
        // Let the new disclosure mount before acknowledging its actual geometry.
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const surface = [...document.querySelectorAll<HTMLElement>('[data-workspace-focused]:not([inert])')].find(element => element.dataset.workspaceObject === result.annotationTarget!.instanceId);
        const addition = surface?.querySelector<HTMLElement>('[data-web-addition]'), reading = addition?.closest<HTMLElement>('[data-workspace-scroll]');
        if (addition && reading) reading.scrollTo({ top: reading.scrollTop + addition.getBoundingClientRect().top - reading.getBoundingClientRect().top - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        const status = await acknowledgeWorkspace(root.current, () => current.current, authorityRef.current, current.current.revision, signal, [result.annotationTarget.instanceId]);
        capture(); return status;
      }
      // The atomic reducer validates both the old and new states. Keep retiring
      // references authorized for this transaction, then React installs `next`.
      const transitionResults = [...external.filter(item => item.id !== result.id), result];
      const nextAuthority = publishedWorkspace(content, catalog, media, transitionResults.map(item => ({ resultId: item.id, kind: item.kind, images: [], selectedImageId: null, map: item.map })));
      const record = nextAuthority.records.find(record => record.reference.kind === 'external' && record.reference.id === result.id)!;
      // Atomic rotation is limited to temporary searches; published objects stay open.
      applyWorkspaceBatch(current.current, workspaceBatch(current.current, [...close, { kind: 'add', object: objectInput(record) }]), nextAuthority);
      setExternal(next); setExternalActive(result.id); authorityRef.current = nextAuthority;
      const kept = new Set(next.map(item => item.id));
      setExternalSelection(items => Object.fromEntries(Object.entries(items).filter(([id]) => kept.has(id))));
      setExternalKinds(items => Object.fromEntries(Object.entries(items).filter(([id]) => kept.has(id))));
      return apply(workspaceBatch(current.current, [...close, { kind: 'add', object: objectInput(record) }, { kind: 'focus', instanceId: objectInput(record).instanceId }]), signal);
    },
    annotationTarget: text => {
      const named = namedWorkspaceRecords(text, authorityRef.current, catalog);
      const objects = current.current.objects.filter(object => object.references.some(ref => named.some(record => referenceKey(record.reference) === referenceKey(ref))));
      const id = objects.length === 1 ? objects[0].instanceId : !named.length ? current.current.focusedId : null;
      return id ? annotationTargetForObject(current.current, id) : undefined;
    },
    externalCommand,
    browse, home,
    beforeSearch: target => { searchPlacement(current.current, external.map(item => exploreContextForResult(item, item.kind, null)), target); },
    reset: () => { reset(); setBrowsing(false); },
  }));
  function relatedPhotos(record: WorkspaceRecord) {
    const targetType = record.reference.kind === 'entity' ? 'entity' : record.reference.kind === 'source' && record.reference.id.startsWith('section:') ? 'section' : null;
    const targetId = targetType === 'section' ? record.reference.id.slice(8) : record.reference.id;
    return targetType ? media?.associations.filter(link => link.targetType === targetType && link.targetId === targetId).sort((a, b) => Number(b.primary) - Number(a.primary)).flatMap(link => {
      const photo = authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === link.assetId);
      return photo ? [{ ...photo, example: link.role === 'example' }] : [];
    }) ?? [] : [];
  }
  function tiles(records: WorkspaceRecord[], object?: WorkspaceObject) {
    const unique = [...new Map(records.map(record => { const item = publishedNameGroup(record, authority, catalog)[0]; return [referenceKey(item.reference), item]; })).values()];
    return <ol className="platform-workspace-content-list">{unique.map((record, index) => <li key={referenceKey(record.reference)}><ContentCard entry={websiteEntry(record, media)} number={index + 1}
      highlighted={Boolean(highlighted && referenceKey(highlighted) === referenceKey(record.reference))} onOpen={() => open(record, record.component, object)}/></li>)}</ol>;
  }
  function renderContent(object: WorkspaceObject, focused: boolean) {
    const records = object.references.map(ref => workspaceRecord(authority, ref)!).filter(Boolean);
    const record = records[0]; if (!record) return <p>This content is no longer available.</p>;
    if (object.component === 'map') {
      const entityId = record.reference.kind === 'entity' ? record.reference.id : record.parent?.id;
      const location = catalog && entityId ? workspaceLocation(catalog, entityId) : null;
      const latitude = location?.latitude, longitude = location?.longitude;
      const valid = typeof latitude === 'number' && typeof longitude === 'number' && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
      return <div className="platform-workspace-location"><p>{location?.address ?? 'No address has been provided.'}</p>
        {valid ? <><p>Published coordinates: {String(latitude)}°, {String(longitude)}°</p><svg viewBox="0 0 360 180" role="img" aria-label="Published coordinates on a schematic world overview"><path d="M0 45H360M0 90H360M0 135H360M90 0V180M180 0V180M270 0V180" fill="none" stroke="currentColor" opacity=".25"/><circle cx={longitude! + 180} cy={90 - latitude!} r="5" fill="currentColor"/></svg><small>Schematic coordinate overview, not directions or a street map. No tiles or geocoding requested.</small></>
          : <p role="note">Map coordinates are not provided or are not unambiguous. No pin was invented and no geocoder was called.</p>}</div>;
    }
    if (object.component === 'information') {
      const fact = catalog && record.reference.kind === 'fact' ? workspaceFact(catalog, record.reference.id) : null;
      const photos = relatedPhotos(record);
      return <div data-source-id={record.reference.kind === 'source' ? record.reference.id : undefined} className="platform-workspace-copy"><p>{fact?.value.display ?? record.body ?? 'Not provided'}</p>{fact && <small>{fact.value.status === 'known' ? 'Published information' : fact.value.status}{fact.period?.validFrom ? ` · from ${fact.period.validFrom}` : ''}{fact.period?.validTo ? ` · through ${fact.period.validTo}` : ''}</small>}{photos.length > 0 && tiles(photos, object)}</div>;
    }
    if (object.component === 'photo') {
      const asset = media?.assets.find(asset => asset.id === record.reference.id);
      const links = media?.associations.filter(link => link.assetId === record.reference.id) ?? [];
      return <figure className="platform-workspace-photo"><MediaImage assetId={record.reference.id} size={focused ? 'display' : 'thumb'} fit="contain" interactive={focused}/>
        <figcaption>{record.name}{asset?.credit && <small>{asset.credit}</small>}{record.example && <span className="platform-media-example">Example photo · illustrative, not an identity claim</span>}</figcaption>
        {focused && <small>Choose the image to open the modal lightbox.</small>}
        {(focused || object.expanded) && links.map(link => { const related = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === link.targetId); return related ? <button type="button" key={link.id} onClick={() => open(related, 'detail', object)}>{link.role === 'example' ? 'Example for' : 'Depicts'} {related.name}</button> : null; })}
      </figure>;
    }
    if (object.component === 'collection' && records.length > 1 && records.every(record => record.reference.kind === 'entity' && record.name.toLocaleLowerCase() === records[0].name.toLocaleLowerCase())) {
      return <div className="platform-published-entries"><p>{records.length} published entries use this name. Their details are kept separate so different descriptions or dates are not mixed.</p>
        {records.map((record, index) => <details key={referenceKey(record.reference)} open={index === 0} onToggle={capture}><summary onClick={onInteraction}>Entry {index + 1} · {record.name}</summary>
          {renderContent({ ...object, component: 'detail', references: [record.reference] }, focused)}
        </details>)}
      </div>;
    }
    if (object.component === 'gallery' || object.component === 'collection') {
      const allowed = displayCatalog && object.filters.length ? new Set(filterEntities(displayCatalog, object.filters).map(entity => entity.id)) : null;
      const members = [...new Map(records.flatMap(record => record.members?.map(ref => workspaceRecord(authority, ref)!).filter(Boolean) ?? [record]).map(record => [referenceKey(record.reference), record])).values()]
        .filter(record => (!allowed || allowed.has(record.reference.id)) && (!object.query || `${record.name} ${record.body ?? ''}`.toLowerCase().includes(object.query.toLowerCase())));
      return <><label className="platform-workspace-filter">Filter this {object.component === 'gallery' ? 'gallery' : 'collection'}<input value={object.query} onChange={event => manual([{ kind: 'filter', instanceId: object.instanceId, query: event.target.value, filters: object.filters }])}/></label>
        {object.filters.length > 0 && <button type="button" onClick={() => manual([{ kind: 'filter', instanceId: object.instanceId, query: object.query, filters: [] }])}>Clear attribute filters</button>}
        {members.length ? tiles(members, object) : <p>No matching published items in this object.</p>}</>;
    }
    if (object.component === 'comparison' && displayCatalog) {
      const ids = object.references.map(ref => ref.id);
      const attributes = displayCatalog.attributes.filter(attribute => ids.some(id => displayCatalog.entities.find(entity => entity.id === id)?.attributes[attribute.id] != null));
      if (!attributes.length) return <p>No comparable attributes are published for these items.</p>;
      return <PresentationView catalog={displayCatalog} state={initialInteraction(displayCatalog)} onAction={event => {
        const record = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === event.params.id);
        if (record && event.type === 'focus') open(record, 'detail', object);
      }} plan={{ schemaVersion: 1, snapshotId: displayCatalog.id, operation: 'compare', components: [{ id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: ids, attributeIds: attributes.map(attribute => attribute.id) }], transition: { type: 'none' } }}/>
    }
    if (object.component === 'actions') return <nav aria-label="Publisher links">{records.map(record => { const capability = catalog?.capabilities?.find(item => item.id === record.reference.id); return capability ? <a key={capability.id} href={capability.url} target="_blank" rel="noopener noreferrer" onClick={onInteraction}>{capability.label} ↗</a> : null; })}</nav>;
    if (object.component === 'external') {
      const result = external.find(result => result.id === record.reference.id);
      return result ? <ExternalSearchResults showViewer={false} result={result} kind={externalKinds[result.id] ?? result.kind} selected={null} onInteraction={onInteraction} onCommand={command => externalCommand(command, result.id)}/> : <p>These temporary external results are unavailable.</p>;
    }
    if (!catalog || !displayCatalog) return null;
    const entity = displayCatalog.entities.find(entity => entity.id === record.reference.id); if (!entity) return null;
    const knowledge = retrieveKnowledge(catalog, { revisionId: catalog.id, entityIds: [entity.id], expansion: 1 }, media);
    const values = knowledge.values.filter(value => value.entityId === entity.id && !['name', 'summary'].includes(value.field));
    const valueFields = new Set(values.map(value => value.field));
    const photos = media?.associations.filter(link => link.targetType === 'entity' && link.targetId === entity.id).flatMap(link => authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === link.assetId) ?? []) ?? [];
    return <div data-entity-id={entity.id} className="platform-workspace-copy"><p>{entity.summary}</p>
      {(focused || object.expanded) && catalog.capabilities?.some(capability => !capability.entityIds.length || capability.entityIds.includes(entity.id)) && <nav aria-label={`Published links for ${entity.name}`}>{catalog.capabilities.filter(capability => !capability.entityIds.length || capability.entityIds.includes(entity.id)).map(capability => <a key={capability.id} href={capability.url} target="_blank" rel="noopener noreferrer" onClick={onInteraction}>{capability.label} ↗</a>)}</nav>}
      {photos.length > 0 && tiles(photos.slice(0, focused || object.expanded ? 4 : 1), object)}
      <dl className="platform-workspace-facts">{catalog.attributes.filter(attribute => entity.attributes[attribute.id] != null && !valueFields.has(`attributes.${attribute.id}`)).slice(0, focused || object.expanded ? 24 : 3).map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}</dl>
      <dl className="platform-workspace-facts">{values.slice(0, focused ? 6 : 3).map(value => <div key={value.field}><dt>{catalog.facts?.find(fact => value.factIds.includes(fact.id))?.definition?.label ?? catalog.attributes.find(attribute => `attributes.${attribute.id}` === value.field)?.label ?? value.field}</dt><dd>{knowledgeValueText(value, knowledge.facts)}</dd></div>)}</dl>
      <DisclosureStack open={object.expanded} onOpenChange={open => manual([{ kind: open ? 'expand' : 'collapse', instanceId: object.instanceId }])}>
        <dl className="platform-workspace-facts">{values.slice(focused ? 6 : 3).map(value => <div key={value.field}><dt>{catalog.facts?.find(fact => value.factIds.includes(fact.id))?.definition?.label ?? value.field}</dt><dd>{knowledgeValueText(value, knowledge.facts)}</dd></div>)}</dl>
        {catalog.relationships.filter(link => link.fromEntityId === entity.id || link.toEntityId === entity.id).map(link => { const target = link.fromEntityId === entity.id ? link.toEntityId : link.fromEntityId; const related = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === target); return related ? <p key={link.id}>{link.fromEntityId === entity.id ? link.label : link.inverseLabel ?? `Connected by ${link.label}`} {link.polarity === 'denied' ? '(not asserted)' : ''}{!assertionActive(link, knowledge.asOf) ? ' · outside current validity' : ''}{link.qualifiers?.length ? ` · conditional: ${link.qualifiers.map(item => `${item.predicate}: ${item.value}`).join(', ')}` : ''}{link.validFrom ? ` · from ${link.validFrom}` : ''}{link.validTo ? ` · through ${link.validTo}` : ''} <button type="button" onClick={() => open(related, 'detail', object)}>{related.name}</button></p> : null; })}
        {(knowledge.omitted.facts > 0 || knowledge.omitted.entities > 0) && <p>This is a bounded selection. Browse or request a specific fact for more information.</p>}
      </DisclosureStack>
    </div>;
  }
  function render(object: WorkspaceObject, focused: boolean) {
    try {
      const annotation = external.findLast(result => result.annotationTarget?.instanceId === object.instanceId && annotationMatches(result.annotationTarget, state));
      const target = annotationTargetForObject(state, object.instanceId);
      return <>{renderContent(object, focused)}
        {target && exploreSettings(content).enabled && exploreSettings(content).annotations && (focused || object.expanded) && <section className="platform-web-addition" data-web-addition={object.instanceId} aria-label="Web additions" aria-busy={pendingAnnotationId === object.instanceId}>
          <div className="platform-web-addition-heading"><span>From the web</span><button type="button" disabled={pendingAnnotationId === object.instanceId} onClick={() => { onInteraction(); onAnnotate?.(target, workspaceRecord(authority, target.reference)?.name ?? 'this card'); }}>{annotation ? 'Refresh web context' : 'Add web context'}</button></div>
          <MotionHeight>{pendingAnnotationId === object.instanceId && <LoadingIndicator label="Finding web context…"/>}{annotation ? <ExternalSearchResults embedded showViewer={false} result={annotation} kind={externalKinds[annotation.id] ?? annotation.kind} selected={null} onInteraction={onInteraction} onCommand={command => externalCommand(command, annotation.id)}/> : <p>Explore cited additions to this card. Your request searches the web.</p>}</MotionHeight>
        </section>}</>;
    }
    catch { return <p role="note" data-workspace-unavailable="true">This view is too large or unavailable. Use Browse published content to open a specific fact. Your other objects remain available.</p>; }
  }
  const directory = authority.records.filter(record => record.reference.kind !== 'external' && (query ? `${record.name} ${record.keywords ?? ''}`.toLowerCase().includes(query.toLowerCase()) : true));
  const sections = websiteSections(authority, content, catalog, media);
  const copy = openingCopy(content, catalog);
  const heroId = media?.associations.find(link => link.targetType === 'site' && link.primary)?.assetId ?? content.opening?.initialAssetIds?.[0]
    ?? media?.albums.flatMap(album => album.assetIds).find(id => id !== content.logoAssetId) ?? media?.assets.find(asset => asset.id !== content.logoAssetId)?.id;
  const heroRecord = authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === heroId);
  const selected = state.objects.filter(object => object.selected && object.component === 'detail');
  return <div ref={root} className="visitor-workspace" data-browsing={browsing} data-workspace-revision={state.revision}>
    <nav className="platform-workspace-toolbar" aria-label="Workspace controls"><button type="button" onClick={homeClick}>Home</button><button type="button" onClick={() => { if (browsing) { onInteraction(); setBrowsing(false); } else void browse(); }} aria-expanded={browsing}>{browsing ? 'Hide browser' : 'Browse published content'}</button>
      {(state.objects.length > 0 || external.length > 0) && <><span>{state.objects.length} / 12 open</span><button type="button" onClick={reset}>Clear workspace</button></>}
      {selected.length >= 2 && <button type="button" onClick={() => manual([{ kind: 'add', object: { instanceId: `compare-${state.revision}`, component: 'comparison', references: selected.flatMap(object => object.references).slice(0, 6) } }])}>Compare selected</button>}
    </nav>
    {error && <p role="alert">{error}</p>}
    <AdaptiveWorkspace objects={state.objects} focusedId={state.focusedId} carouselIds={greetingIds} onCarouselInteract={onInteraction} highlightedReference={highlighted} authority={authority} onOperation={manual} render={render} onSettled={capture} onHome={homeClick} focusKeyboard={focusKeyboard} layout={content.style?.layout} style={siteStyle(content) as CSSProperties}/>
    {external.filter(isRetained).map(result => <ExternalSearchViewer key={result.id} result={result} selected={externalSelection[result.id] ?? null} onHome={homeClick} onClose={() => { onInteraction(); externalCommand({ kind: 'back' }, result.id); }}/>) }
    {browsing && <PublishedWebsite name={content.name} {...copy} logoAssetId={content.logoAssetId} hero={heroRecord ? websiteEntry(heroRecord, media) : undefined} sections={sections}
      contact={content.contact} hours={content.hours} onHome={homeClick} onInteraction={onInteraction} query={query}
      onQueryChange={value => { onInteraction(); setQuery(value); }} searchResults={directory.map(record => websiteEntry(record, media))}
      highlightedId={highlighted ? referenceKey(highlighted) : undefined} onOpen={id => { const record = authority.records.find(record => referenceKey(record.reference) === id); if (record) open(record); }}/>}
  </div>;
}
