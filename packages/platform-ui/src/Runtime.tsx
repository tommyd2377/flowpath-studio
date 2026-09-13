'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MutableRefObject } from 'react';
import { z } from 'zod';
import { useReducedMotion } from 'motion/react';
import { validateCatalog, validatePlan, catalogFilterSchema, type KnowledgeCatalog, type PresentationPlan } from './contracts.js';
import { defaultPresentation, filterEntities } from './catalog.js';
import { applyPresentationState, comparisonPlan, detailPlan, entityIdsForComponent, initialInteraction, planForIntent, replaceCatalogFilter, type CatalogInteractionState, type FocusReference, type ReturnAnchor as ReturnAnchorState } from './interaction.js';
import { compilePresentation } from './compile.js';
import { preflightPresentation } from './preflight.js';
import { FocusStage, FocusSurface, Icon, RuntimeContext, VoiceFocusBridge, platformLibrary } from './components.js';
import { Renderer } from './openui.js';
import { InterfaceMotion } from './motion.js';
import { MediaProvider } from './MediaViews.js';
import { galleryAssetIds, type AssetUrlResolver, type MediaLibrary } from './media.js';

export type CatalogViewCommand = { kind: string; id?: string; ids?: string[] };
export type CatalogExplorerProps = {
  commandRef?: MutableRefObject<((command: CatalogViewCommand) => boolean) | null>;
  catalog: KnowledgeCatalog;
  accent?: string;
  snapshotId?: string;
  plan?: PresentationPlan | null;
  onStateChange?: (state: CatalogInteractionState) => void;
  onInteraction?: () => void;
  onOutcome?: (event: { kind: 'selection' | 'link_click'; entityId?: string; capabilityId?: string }) => void;
  onPresentation?: (plan: PresentationPlan) => void;
  onAsk?: (text: string, state: CatalogInteractionState, signal: AbortSignal) => Promise<PresentationPlan>;
  pending?: boolean;
  showComposer?: boolean;
  media?: MediaLibrary | null;
  resolveAssetUrl?: AssetUrlResolver;
  onPhotoView?: (assetId: string) => void;
};

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('focus'), params: z.object({ id: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('back'), params: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('select'), params: z.object({ id: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('collection'), params: z.object({ id: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('filter'), params: catalogFilterSchema }).strict(),
  z.object({ type: z.literal('clear-filters'), params: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('compare'), params: z.object({}).strict() }).strict(),
]);

type SavedView = { plan: PresentationPlan; state: CatalogInteractionState; scrollTop: number; spotlightId: string | null; returnAnchor?: ReturnAnchorState };
function scrollContainer(root: HTMLElement | null) {
  for (let node = root; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Reveal a requested destination after its geometry settles, unless the visitor takes over. */
function useSettledReveal(root: { current: HTMLDivElement | null }, plan: PresentationPlan) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const name = plan.transition.targetComponentId;
    if (!name) return;
    let frame = 0;
    let cancelled = false;
    let previous = '';
    let stable = 0;
    const started = performance.now();
    const follow = () => {
      if (cancelled) return;
      const target = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-platform-slot]') ?? [])
        .find(element => element.dataset.platformSlot === name && !element.closest('[inert], [aria-hidden="true"]'));
      if (!target) {
        if (performance.now() - started < 900) frame = requestAnimationFrame(follow);
        return;
      }
      // Focus surfaces are viewport-bound overlays; scrolling their detail
      // slot would pull the document toward the old card's flow position.
      if (target.closest('[data-focus-layer="true"]')) return;
      const bounds = target.getBoundingClientRect();
      const geometry = [bounds.top, bounds.bottom, bounds.width].map(value => Math.round(value * 10)).join(':');
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
      const moving = target.getAnimations({ subtree: true }).some(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
      if ((stable < 3 || !reduced && moving || performance.now() - started < 100) && performance.now() - started < 900) {
        frame = requestAnimationFrame(follow);
        return;
      }
      const viewport = window.visualViewport;
      const dock = root.current?.closest('[data-visitor-site]')?.querySelector('[data-voice-dock="true"]')?.getBoundingClientRect();
      let top = Math.max((viewport?.offsetTop ?? 0) + 16, dock && dock.top <= 1 ? dock.bottom + 16 : 0);
      let bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 16;
      // Studio may embed the same runtime in a scrolling preview pane.
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
          const visible = parent.getBoundingClientRect();
          top = Math.max(top, visible.top + 16);
          bottom = Math.min(bottom, visible.bottom - 16);
        }
      }
      if (bounds.top < top || bounds.top > bottom - Math.min(100, bounds.height)) {
        // A tall collection may already span the viewport. Reveal its heading
        // without start-aligning every ancestor of a scrolling preview pane.
        const destination = bounds.height > bottom - top
          ? target.querySelector<HTMLElement>('.platform-section-heading, .platform-media-heading, h3, .platform-selection-label') ?? target
          : target;
        destination.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
      }
    };
    frame = requestAnimationFrame(follow);
    const cancel = () => { cancelled = true; cancelAnimationFrame(frame); };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    events.forEach(event => window.addEventListener(event, cancel, { passive: true, capture: true }));
    return () => { cancel(); events.forEach(event => window.removeEventListener(event, cancel, true)); };
  }, [root, plan, reduced]);
}

function checkedView(catalog: KnowledgeCatalog, value: unknown, snapshotId: string, media?: MediaLibrary | null) {
  const plan = validatePlan(value, catalog, snapshotId, media);
  const program = compilePresentation(catalog, plan, snapshotId, media);
  preflightPresentation(program);
  return plan;
}

/** Render a complete validated view. Data and actions are supplied by the embedding application. */
export function PresentationView({ catalog, plan, state, onAction, onLinkClick, media, resolveAssetUrl, onMediaInteraction, onPhotoView, onMediaFocusChange, mediaLayoutId, spotlightId }: {
  spotlightId?: string | null;
  catalog: KnowledgeCatalog; plan: PresentationPlan; state: CatalogInteractionState;
  onAction?: (event: { type: string; params: Record<string, unknown> }) => void;
  onLinkClick?: (event: { kind: 'link_click'; entityId?: string; capabilityId: string }) => void;
  media?: MediaLibrary | null; resolveAssetUrl?: AssetUrlResolver; onMediaInteraction?: () => void; onPhotoView?: (assetId: string) => void;
  onMediaFocusChange?: (reference: FocusReference | null, origin?: ReturnAnchorState | null) => void; mediaLayoutId?: string;
}) {
  const program = useMemo(() => {
    const compiled = compilePresentation(catalog, plan, state.snapshotId, media);
    preflightPresentation(compiled);
    return compiled;
  }, [catalog, plan, state.snapshotId, media]);
  const context = useMemo(() => ({ catalog, state, plan, spotlightId, onLinkClick, onInteraction: onMediaInteraction, onMediaFocusChange }), [catalog, state, plan, spotlightId, onLinkClick, onMediaInteraction, onMediaFocusChange]);
  const content = <RuntimeContext.Provider value={context}><Renderer response={program} library={platformLibrary}
    isStreaming={false} publishObservability={false} onAction={onAction}/></RuntimeContext.Provider>;
  return media ? <MediaProvider library={media} resolveAssetUrl={resolveAssetUrl ?? (() => '')} onInteraction={onMediaInteraction} onPhotoView={onPhotoView} layoutGroupId={mediaLayoutId}>{content}</MediaProvider> : content;
}

function Explorer({ commandRef, catalog, accent = '#c6af86', snapshotId = catalog.id, plan: suppliedPlan, onStateChange, onInteraction, onOutcome, onPresentation, onAsk, pending: externalPending = false, showComposer = true, media, resolveAssetUrl, onPhotoView }: CatalogExplorerProps) {
  const [initialView] = useState(() => {
    const fallback = defaultPresentation(catalog, snapshotId);
    try { return { plan: suppliedPlan ? checkedView(catalog, suppliedPlan, snapshotId, media) : fallback, error: '' }; }
    catch { return { plan: fallback, error: 'That view could not be validated. Your previous view is still available.' }; }
  });
  const [accepted, setAccepted] = useState(initialView.plan);
  const [state, setState] = useState(() => applyPresentationState(initialInteraction(catalog, snapshotId), initialView.plan));
  const [history, setHistory] = useState<SavedView[]>([]);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(initialView.error);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const restoreScroll = useRef<number | null>(null);
  const restoreAnchor = useRef<ReturnAnchorState | null>(null);
  const instanceId = useId();
  const stateCallback = useRef(onStateChange);
  const presentationCallback = useRef(onPresentation);
  const [previousSupplied, setPreviousSupplied] = useState<PresentationPlan | null | undefined>(suppliedPlan);
  const gallery = accepted.components.find(component => component.type === 'gallery');
  useSettledReveal(root, accepted);

  const visiblePlan = useMemo((): PresentationPlan => {
    if (!state.selectedIds.length || accepted.components.some(component => component.type === 'selection')) return accepted;
    return { ...accepted, components: [...accepted.components, { id: 'selection', type: 'selection', variant: 'compact', entityIds: [], attributeIds: [] }] };
  }, [accepted, state.selectedIds.length]);
  const interaction = useMemo((): CatalogInteractionState => {
    const collection = accepted.components.find(component => component.type === 'collection');
    const comparison = accepted.components.find(component => component.type === 'comparison');
    const detail = accepted.components.find(component => component.type === 'detail');
    const allowed = collection ? new Set(entityIdsForComponent(catalog, collection)) : null;
    const entityIds = collection ? filterEntities(catalog, state.filters).filter(entity => allowed!.has(entity.id)).map(entity => entity.id)
      : comparison?.entityIds ?? detail?.entityIds ?? state.entityIds;
    const focusedId = detail?.entityIds[0] ?? null;
    return { ...state, entityIds, focusedId, focusedRef: focusedId ? { kind: 'entity', id: focusedId } : state.focusedRef };
  }, [catalog, accepted, state]);

  useEffect(() => { stateCallback.current = onStateChange; }, [onStateChange]);
  useEffect(() => { presentationCallback.current = onPresentation; }, [onPresentation]);
  useEffect(() => { stateCallback.current?.(interaction); }, [interaction]);
  useEffect(() => { presentationCallback.current?.(accepted); }, [accepted]);
  useEffect(() => () => { generation.current += 1; pending.current?.abort(); }, []);

  const cancelPending = useCallback(() => {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }, []);

  const accept = useCallback((value: unknown, remember = true, returnAnchor?: ReturnAnchorState) => {
    const next = checkedView(catalog, value, snapshotId, media);
    const focusedId = next.components.find(component => component.type === 'detail')?.entityIds[0] ?? null;
    const nextState = { ...applyPresentationState(interaction, next), focusedId,
      focusedRef: focusedId ? { kind: 'entity' as const, id: focusedId } : null,
      focusOrigin: returnAnchor ?? null };
    const changedFilters = JSON.stringify(nextState.filters) !== JSON.stringify(interaction.filters);
    if (remember && (changedFilters || JSON.stringify(next) !== JSON.stringify(accepted))) setHistory(items => [...items.slice(-19), { plan: accepted, state: interaction, scrollTop: scrollContainer(root.current)?.scrollTop ?? window.scrollY, spotlightId, ...(returnAnchor ? { returnAnchor } : {}) }]);
    setState(nextState);
    setAccepted(next);
    setError('');
  }, [catalog, snapshotId, accepted, interaction, media, spotlightId]);

  // Synchronize an accepted prop during render so an obsolete view is never committed
  // for a frame. This guarded state adjustment is confined to this component.
  if (suppliedPlan && suppliedPlan !== previousSupplied) {
    setPreviousSupplied(suppliedPlan);
    setBusy(false);
    try {
      const next = checkedView(catalog, suppliedPlan, snapshotId, media);
      const focusedId = next.components.find(component => component.type === 'detail')?.entityIds[0] ?? null;
      const nextState = { ...applyPresentationState(interaction, next), focusedId,
        focusedRef: focusedId ? { kind: 'entity' as const, id: focusedId } : null, focusOrigin: null };
      const changedFilters = JSON.stringify(nextState.filters) !== JSON.stringify(interaction.filters);
      if (changedFilters || JSON.stringify(next) !== JSON.stringify(accepted)) {
        setHistory(items => [...items.slice(-19), { plan: accepted, state: interaction, scrollTop: scrollContainer(root.current)?.scrollTop ?? window.scrollY, spotlightId }]);
        setAccepted(next);
        setState(nextState);
      }
      setError('');
    } catch { setError('That view could not be validated. Your previous view is still available.'); }
  }
  useEffect(() => {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
  }, [suppliedPlan]);

  function handleAction(event: { type: string; params: Record<string, unknown> }) {
    const parsed = actionSchema.safeParse({ type: event.type, params: event.params });
    if (!parsed.success) { setError('That interface action is not available.'); return; }
    const action = parsed.data;
    onInteraction?.();
    setSpotlightId(null);
    cancelPending();
    setError('');
    try {
      if (action.type === 'back') {
        back();
      } else if (action.type === 'focus') {
        if (!catalog.entities.some(entity => entity.id === action.params.id)) throw new Error();
        const origin = document.activeElement;
        const current = generation.current;
        const returnAnchor: ReturnAnchorState = { reference: { kind: 'entity', id: action.params.id }, surface: 'collection', focusKey: `entity:${action.params.id}`, scrollTop: scrollContainer(root.current)?.scrollTop ?? window.scrollY };
        accept(detailPlan(catalog, action.params.id, snapshotId), true, returnAnchor);
        // A deliberate navigation can transfer focus; background/model updates never steal it.
        requestAnimationFrame(() => {
          if (generation.current !== current) return;
          const active = document.activeElement;
          const originRetired = !origin?.isConnected || !!origin.closest('[inert], [aria-hidden="true"]');
          if (active !== origin && !(active === document.body && originRetired)) return;
          Array.from(root.current?.querySelectorAll<HTMLElement>('[data-platform-focus]') ?? [])
            .find(element => element.closest<HTMLElement>('[data-entity-id]')?.dataset.entityId === action.params.id && !element.closest('[inert], [aria-hidden="true"]'))?.focus({ preventScroll: true });
        });
      } else if (action.type === 'select') {
        if (!catalog.entities.some(entity => entity.id === action.params.id)) throw new Error();
        if (!state.selectedIds.includes(action.params.id) && state.selectedIds.length < 6) onOutcome?.({ kind: 'selection', entityId: action.params.id });
        setState(value => ({ ...value, selectedIds: value.selectedIds.includes(action.params.id)
          ? value.selectedIds.filter(id => id !== action.params.id) : [...value.selectedIds, action.params.id].slice(0, 6) }));
      } else if (action.type === 'compare') {
        accept(comparisonPlan(catalog, state.selectedIds, snapshotId));
      } else if (action.type === 'filter') {
        const nextFilters = action.params.value === null ? state.filters.filter(filter => filter.attributeId !== action.params.attributeId) : replaceCatalogFilter(state.filters, action.params);
        filterEntities(catalog, nextFilters);
        setState(value => ({ ...value, filters: nextFilters }));
      } else if (action.type === 'clear-filters') {
        setState(value => ({ ...value, filters: [] }));
      } else if (action.type === 'collection') {
        if (action.params.id && !catalog.collections.some(collection => collection.id === action.params.id)) throw new Error();
        const next = defaultPresentation(catalog, snapshotId);
        if (action.params.id) next.components = next.components.map(component => component.type === 'collection' ? { ...component, collectionId: action.params.id } : component);
        next.transition = { type: 'replace', targetComponentId: 'collection' };
        accept(next);
      }
    } catch { setError('That change could not be applied to this catalog. Your previous view is still available.'); }
  }

  function back(manual = true) {
    if (manual) onInteraction?.();
    cancelPending();
    setSpotlightId(null);
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(items => items.slice(0, -1));
    restoreAnchor.current = previous.returnAnchor ?? previous.state.focusOrigin;
    setAccepted({ ...previous.plan, transition: { type: 'restore' } });
    setState(previous.state);
    setSpotlightId(previous.spotlightId);
    restoreScroll.current = previous.scrollTop;
    setError('');
  }
  function reset() {
    onInteraction?.();
    cancelPending();
    setHistory([]);
    accept({ ...defaultPresentation(catalog, snapshotId), stateUpdate: { filters: [] }, transition: { type: 'restore' } }, false);
  }
  useEffect(() => {
    if (restoreScroll.current === null) return;
    const position = restoreScroll.current; restoreScroll.current = null;
    let frame = 0;
    const began = performance.now();
    const follow = () => {
      const moving = root.current?.getAnimations({ subtree: true }).some(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
      if (moving && performance.now() - began < 900 || performance.now() - began < 100) { frame = requestAnimationFrame(follow); return; }
      const container = scrollContainer(root.current);
      if (container) container.scrollTo({ top: position, behavior: 'instant' });
      else window.scrollTo({ top: position, behavior: 'instant' });
    };
    frame = requestAnimationFrame(follow);
    const cancel = () => cancelAnimationFrame(frame);
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    events.forEach(event => window.addEventListener(event, cancel, { passive: true, capture: true }));
    return () => { cancel(); events.forEach(event => window.removeEventListener(event, cancel, true)); };
  }, [accepted]);
  const mediaFocusChange = useCallback((reference: FocusReference | null, origin?: ReturnAnchorState | null) => {
    setState(value => ({ ...value, focusedId: reference?.kind === 'entity' ? reference.id : null, focusedRef: reference, focusOrigin: origin ?? null }));
  }, []);
  useEffect(() => {
    const anchor = restoreAnchor.current;
    if (!anchor) return;
    let frame = 0;
    const find = () => {
      const escaped = anchor.reference.id.replace(/[^A-Za-z0-9_-]/g, '\\$&');
      const selector = anchor.reference.kind === 'entity'
        ? `[data-entity-id="${escaped}"] .platform-item-open`
        : `[data-gallery-asset="${escaped}"] button`;
      const target = Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(candidate => !candidate.closest('[inert], [aria-hidden="true"]'));
      if (target && !target.closest('[inert], [aria-hidden="true"]')) {
        target.focus({ preventScroll: true }); restoreAnchor.current = null; return;
      }
      frame = requestAnimationFrame(find);
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [accepted]);
  useEffect(() => {
    if (!commandRef) return;
    commandRef.current = command => {
      try {
        if (command.kind === 'back' || command.kind === 'collapse') {
          if (!history.length) return false;
          back(false); return true;
        }
        if (command.kind === 'compare') {
          const ids = command.ids ?? [];
          if (ids.length < 2 || ids.length > 6 || new Set(ids).size !== ids.length || !ids.every(id => catalog.entities.some(entity => entity.id === id))) return false;
          accept(comparisonPlan(catalog, ids, snapshotId)); setSpotlightId(null); return true;
        }
        if (!command.id || !catalog.entities.some(entity => entity.id === command.id)) return false;
        if (command.kind === 'spotlight') {
          if (!interaction.entityIds.includes(command.id)) return false;
          setSpotlightId(command.id); return true;
        }
        if (command.kind !== 'open' && command.kind !== 'expand') return false;
        const returnAnchor: ReturnAnchorState = { reference: { kind: 'entity', id: command.id }, surface: 'collection', focusKey: `entity:${command.id}`, scrollTop: scrollContainer(root.current)?.scrollTop ?? window.scrollY };
        accept(detailPlan(catalog, command.id, snapshotId), true, returnAnchor); setSpotlightId(null); return true;
      } catch { return false; }
    };
    return () => { commandRef.current = null; };
  });
  const focusedEntity = interaction.focusedRef?.kind === 'entity';
  const focusedReference = interaction.focusedRef;
  const focusedEntityName = focusedReference?.kind === 'entity' ? catalog.entities.find(entity => entity.id === focusedReference.id)?.name : undefined;
  const focusStatus = focusedReference ? focusedReference.kind === 'entity' ? `Focused on ${focusedEntityName ?? 'a published item'}.` : 'Focused on a published photo.' : '';
  const currentPresentation = <PresentationView spotlightId={spotlightId} catalog={catalog} plan={visiblePlan} state={interaction} media={media} resolveAssetUrl={resolveAssetUrl} mediaLayoutId={instanceId} onPhotoView={onPhotoView} onMediaInteraction={() => { onInteraction?.(); cancelPending(); }} onMediaFocusChange={mediaFocusChange} onAction={handleAction} onLinkClick={event => { onInteraction?.(); onOutcome?.(event); }}/>;
  const previousView = history.at(-1);
  const focusContext = focusedEntity
    ? previousView ? <PresentationView catalog={catalog} plan={previousView.plan} state={previousView.state} media={media} resolveAssetUrl={resolveAssetUrl} mediaLayoutId={instanceId}/> : undefined
    : currentPresentation;
  async function ask(event: FormEvent) {
    event.preventDefault();
    const query = text.trim();
    if (!query || busy) return;
    cancelPending();
    const current = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError('');
    try {
      const next = onAsk ? await onAsk(query, interaction, controller.signal) : planForIntent(catalog, query, interaction, media);
      if (controller.signal.aborted || generation.current !== current) return;
      accept(next);
      setText('');
    } catch (caught) {
      if (!controller.signal.aborted && generation.current === current) setError(caught instanceof Error ? caught.message : 'That view could not be prepared. Your previous view is still available.');
    } finally {
      if (generation.current === current) { setBusy(false); pending.current = null; }
    }
  }

  return <div ref={root} className="platform-explorer" data-platform-catalog={catalog.id} style={{ '--platform-accent': /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#c6af86' } as CSSProperties}>
    <InterfaceMotion id={instanceId}>
      <header className="platform-introduction"><div className="platform-intro-top"><span className="platform-eyebrow"><span className="platform-status-dot"/> A MORE PERSONAL WAY TO EXPLORE</span><span className="platform-catalog-label">{catalog.entities.length} items</span></div><h2>{catalog.name}</h2><p>{catalog.description}</p></header>
      {showComposer && <div className="platform-composer-area"><form onSubmit={event => void ask(event)} className="platform-composer"><Icon name="spark" size={20}/><label className="platform-sr-only" htmlFor={`${instanceId}-intent`}>What are you looking for?</label><input ref={composer} id={`${instanceId}-intent`} value={text} maxLength={2000} onChange={event => setText(event.target.value)} placeholder="Tell us what matters to you…" autoComplete="off"/><button className="platform-submit" type="submit" disabled={busy || !text.trim()} aria-label="Explore this request"><Icon name="arrow"/></button></form>
        <div className="platform-prompts"><span>Try a direction</span>{catalog.jobs.slice(0, 3).map(job => <button type="button" key={job.id} disabled={busy} onClick={() => { setText(job.label); composer.current?.focus({ preventScroll: true }); }}>{job.label}<Icon name="arrow" size={12}/></button>)}</div>
      </div>}
      <div className="platform-view-toolbar"><div>{!!history.length && <><button className="platform-text-button" type="button" onClick={() => back()}><Icon name="back" size={14}/>Back</button><span className="platform-toolbar-divider"/></>}<button className="platform-text-button" type="button" onClick={reset}>All items</button>{!!media?.assets.length && <button className="platform-text-button" type="button" onClick={() => { onInteraction?.(); cancelPending(); accept(planForIntent(catalog, 'show photos', interaction, media)); }}>Photos</button>}</div><VoiceFocusBridge reference={focusedReference} status={busy || externalPending ? 'Shaping your view…' : focusStatus}><span className="platform-view-status" role="status" aria-live="polite">{busy || externalPending ? 'Shaping your view…' : gallery && media ? `${galleryAssetIds(media, gallery).length} photos in this view` : interaction.focusedId ? 'A closer look' : `${interaction.entityIds.length} ${accepted.operation === 'compare' ? 'items side by side' : 'items in this view'}`}</span></VoiceFocusBridge></div>
      {error && <div className="platform-error" role="alert"><p>{error}</p><button type="button" aria-label="Dismiss message" onClick={() => setError('')}><Icon name="close" size={14}/></button></div>}
      <FocusStage focused={focusedEntity} onClose={focusedEntity ? () => back() : undefined} label={interaction.focusedRef ? `Focused ${interaction.focusedRef.kind}` : 'Published catalog'} context={focusContext}>
        {focusedEntity ? <FocusSurface key={`entity:${interaction.focusedRef!.id}`} reference={interaction.focusedRef} onClose={() => back()} title={`Details of ${catalog.entities.find(entity => entity.id === interaction.focusedRef?.id)?.name ?? 'published item'}`}>{currentPresentation}</FocusSurface>
          : !focusContext ? currentPresentation : null}</FocusStage>
    </InterfaceMotion>
  </div>;
}

export function CatalogExplorer(props: CatalogExplorerProps) {
  const catalog = useMemo(() => validateCatalog(props.catalog), [props.catalog]);
  return <div className="platform-container"><Explorer {...props} catalog={catalog} key={`${catalog.id}-${props.snapshotId ?? catalog.id}`}/></div>;
}
