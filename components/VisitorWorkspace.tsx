'use client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { MediaImage, MediaVideo, type PlaybackState, ExternalSearchResults, PresentationView } from '@thevoice/platform-ui';
import { initialInteraction } from '@thevoice/platform-ui/interaction';
import { projectKnowledgeCatalog, retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { formatAttribute } from '@thevoice/platform-ui/catalog';
import { applyWorkspaceBatch, emptyWorkspace, referenceKey, workspaceRecord, type WorkspaceBatch, type WorkspaceObject, type WorkspaceRecord, type WorkspaceScene, type WorkspaceState } from '@thevoice/platform-ui/workspace';
import { initialCarouselPosition, reconcileCarousel, moveCarousel, carouselCommand, type CarouselCard, type CarouselContext } from '@thevoice/platform-ui/carousel';
import type { KnowledgeCatalog, PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { objectInput, openingWorkspace, planWorkspaceIntent, publishedWorkspace, workspaceBatch, workspaceFact, workspaceFromPlan, workspaceFromSources, workspaceLocation } from '@/lib/visitor-workspace';
import { annotationTargetForObject, exploreContextForResult, exploreResultSchema, type AnnotationTarget, type ExploreCommand, type ExploreContext, type ExploreResult } from '@/lib/explore-model';
import { knowledgeValueText } from '@/lib/knowledge-display';
import type { SiteContent } from '@/lib/site-model';
import type { SitePresentation } from '@/lib/site-presentation';
import { useVisitorTasks, useWebsiteTasks } from './VisitorTasks';
import AssistantAnswer from './AssistantAnswer';
import styles from './VisitorCarousel.module.css';

type Status = 'applied' | 'failed' | 'cancelled';
export type VisitorWorkspaceHandle = {
  context: () => { workspace: WorkspaceState; scene?: WorkspaceScene; carousel: CarouselContext; externalResults?: ExploreContext[]; explore?: ExploreContext };
  apply: (batch: WorkspaceBatch, signal?: AbortSignal) => Promise<Status>;
  intent: (text: string, signal?: AbortSignal) => Promise<boolean>;
  command: (text: string, signal?: AbortSignal) => Promise<boolean>;
  plan: (plan: PresentationPlan | SitePresentation, signal?: AbortSignal) => Promise<Status>;
  navigate: (kind: string, id?: string, ids?: string[], signal?: AbortSignal) => Promise<Status>;
  greeting: (index: number | null, signal: AbortSignal) => Promise<Status>;
  showExternal: (result: unknown, signal?: AbortSignal) => Promise<Status>;
  confirm: (signal?: AbortSignal) => Promise<Status>;
  externalCommand: (command: ExploreCommand) => boolean;
  annotationTarget: (text: string) => AnnotationTarget | undefined;
  browse: (signal?: AbortSignal) => Promise<Status>;
  home: (signal?: AbortSignal) => Promise<Status>;
  clear: (signal?: AbortSignal) => Promise<Status>;
  restoreWebsite: (signal?: AbortSignal) => Promise<Status>;
  releaseFocus: (signal?: AbortSignal) => Promise<Status>;
  beforeSearch: (target?: AnnotationTarget) => void;
  reset: () => void;
  narrate: () => void;
};
type Card = CarouselCard & { object?: WorkspaceObject; record?: WorkspaceRecord; content?: ReactNode; recordId?: string; videoId?: string };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** One foreground rail. Query results and validated semantic plans are data sources, never website mutations. */
export default function VisitorWorkspace({ content, catalog, media, handleRef, onInteraction, onContext, onInvoke, onPhotoView, active = true, answer = '', pending = false, onDismiss, onMediaAudible }: {
  content: SiteContent; catalog?: KnowledgeCatalog | null; media?: MediaLibrary | null; handleRef?: Ref<VisitorWorkspaceHandle>;
  onInteraction: () => void; onContext?: () => void; onInvoke?: () => void; onPhotoView?: (id: string) => void;
  onMediaAudible?: () => void;
  active?: boolean; answer?: string; pending?: boolean; onDismiss?: () => void;
  onDismissMedia?: () => void; onHome?: () => void; onReset?: () => void; onAnnotate?: (target: AnnotationTarget, name: string) => void; pendingAnnotationId?: string;
}) {
  const tasks = useVisitorTasks(), taskSurface = useWebsiteTasks(), view = taskSurface?.view;
  const [external, setExternal] = useState<ExploreResult[]>([]);
  const [externalSelection, setExternalSelection] = useState<Record<string, string | null>>({});
  const authority = useMemo(() => publishedWorkspace(content, catalog, media, external.map(result => exploreContextForResult(result, result.kind, null))), [content, catalog, media, external]);
  const authorityRef = useRef(authority); authorityRef.current = authority;
  const displayCatalog = useMemo(() => catalog ? projectKnowledgeCatalog(catalog) : null, [catalog]);
  const [state, setState] = useState(() => openingWorkspace(authority, content));
  const current = useRef(state); current.current = state;
  const [position, setPosition] = useState(initialCarouselPosition), positionRef = useRef(position); positionRef.current = position;
  const [error, setError] = useState('');
  const root = useRef<HTMLElement>(null), reading = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<string | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const version = useRef(0), revision = useRef(0), lastNarrated = useRef<string | null>(null);
  const sceneClock = useRef({ key: '', revision: 0 });
  const playback = useRef<Record<string, PlaybackState>>({});
  function videoCard(id: string) { return <MediaVideo videoId={id} active={active} allowAutoplay initialSeconds={playback.current[id]?.seconds ?? 0} resumePaused={!!playback.current[id]} onAudible={onMediaAudible} onChange={state => { playback.current[id] = state; capture(); }}/>; }
  const recent = useRef<CarouselCard[]>([]), frames = useRef<WorkspaceState[]>([]);
  const scrolls = useRef<Record<string, number>>({});
  const reduced = useReducedMotion();
  const callback = useRef(onContext); callback.current = onContext;
  function capture() { revision.current++; callback.current?.(); recordBrowserTestEvent('screen.observed', { workspace: current.current, position: positionRef.current, active: activeRef.current, revision: revision.current, scrollTop: reading.current?.scrollTop ?? 0 }); }
  const execute = (id: string, input: unknown, manual = true, signal?: AbortSignal) => taskSurface?.execute(id, input, manual, signal);
  function recordContent(record: WorkspaceRecord, expanded: boolean): ReactNode {
    if (record.reference.kind === 'source' && record.reference.id.startsWith('video:')) return videoCard(record.reference.id.slice(6));
    if (record.reference.kind === 'photo') {
      const asset = media?.assets.find(item => item.id === record.reference.id);
      return <figure className={styles.photo}><MediaImage assetId={record.reference.id} size="display" fit="contain" interactive={false}/><figcaption>{asset?.caption || asset?.alt}{asset?.credit && <small>{asset.credit}</small>}{record.example && <small>Illustrative example</small>}</figcaption></figure>;
    }
    if (record.reference.kind === 'fact' && catalog) return <p>{workspaceFact(catalog, record.reference.id)?.value.display ?? 'Not provided'}</p>;
    if (record.reference.kind === 'capability') { const link = catalog?.capabilities?.find(item => item.id === record.reference.id); return link ? <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a> : null; }
    if (record.reference.kind === 'external') {
      const result = external.find(item => item.id === record.reference.id); if (!result) return null;
      const selection = externalSelection[result.id], image = result.images.find(image => image.id === selection), source = result.sources.find((_, index) => selection === `source-${index + 1}`);
      if (image || source) return <><button className={styles.textButton} onClick={() => { onInteraction(); externalCommand({ kind: 'back' }); }}>Back to search</button>{image ? <figure className={styles.photo}>
        {/* External images are already validated references; no server proxy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={image.caption} style={{ maxHeight: '55dvh', objectFit: 'contain' }}/><figcaption>{image.caption}</figcaption><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">Visit image source ↗</a></figure> : source && <><h3>{source.title}</h3><AssistantAnswer text={result.answer}/><a href={source.url} target="_blank" rel="noopener noreferrer">Read this source ↗</a></>}<small>External information · separate from the publisher’s information</small></>;
      return <ExternalSearchResults showViewer={false} result={result} kind={result.kind} selected={null} onInteraction={onInteraction} onCommand={externalCommand}/>;
    }
    const entity = displayCatalog?.entities.find(item => item.id === record.reference.id && record.reference.kind === 'entity');
    const photos = media?.associations.filter(link => (record.reference.kind === 'entity' && link.targetType === 'entity' && link.targetId === record.reference.id) || (record.reference.kind === 'source' && link.targetType === 'section' && `section:${link.targetId}` === record.reference.id)) ?? [];
    const knowledge = catalog && entity ? retrieveKnowledge(catalog, { revisionId: catalog.id, entityIds: [entity.id], expansion: 0, includeBlocks: false }, media) : null;
    return <>{photos[0] && <figure className={styles.photo}><MediaImage assetId={photos[0].assetId} size="display" fit="contain" interactive={false}/>{photos[0].role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}
      {entity?.blocks?.length ? entity.blocks.map(block => block.kind === 'heading' ? <h3 key={block.id} data-reading-block={block.id}>{block.text}</h3> : <p key={block.id} data-reading-block={block.id}>{block.text}</p>) : <p>{record.body || 'No further description has been published.'}</p>}
      {entity && <dl className={styles.facts}>{displayCatalog!.attributes.filter(attribute => entity.attributes[attribute.id] != null && !knowledge?.values.some(value => value.field === `attributes.${attribute.id}`)).map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}{knowledge?.values.filter(value => !['name', 'summary'].includes(value.field)).map(value => <div key={value.field}><dt>{catalog!.facts?.find(fact => value.factIds.includes(fact.id))?.definition?.label ?? catalog!.attributes.find(attribute => `attributes.${attribute.id}` === value.field)?.label ?? value.field}</dt><dd>{knowledgeValueText(value, knowledge.facts)}</dd></div>)}</dl>}
      {expanded && entity && catalog?.capabilities?.filter(link => !link.entityIds.length || link.entityIds.includes(entity.id)).map(link => <p key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a></p>)}
    </>;
  }
  let cards: Card[] = [];
  if (view) {
    if (view.detail?.record.type === 'published-video' && view.detail.record.media) cards = [{ id: `detail:${view.detail.record.id}`, title: view.detail.record.name, kind: 'video', videoId: view.detail.record.media.assetId, referenceIds: [view.detail.record.id], content: <><button className={styles.textButton} onClick={() => void execute('view.back', { target: 'results' })}>Back to results</button><h2>{view.detail.record.name}</h2>{videoCard(view.detail.record.media.assetId)}</> }];
    else if (view.detail || view.comparison) cards = [{ id: view.detail ? `detail:${view.detail.record.id}` : `comparison:${view.result.resultSetId}`, title: view.detail?.record.name ?? 'Comparison', kind: view.detail?.record.type === 'published-photo' ? 'photo' : view.detail ? 'record' : 'comparison', referenceIds: view.detail ? [view.detail.record.id] : view.comparison!.rows.map(row => row.id), content: taskSurface?.foreground }];
    else if (view.focus && ['research', 'map', 'artifact', 'business', 'quote', 'booking', 'receipt', 'cart', 'slots'].includes(view.focus)) cards = [{ id: `${view.focus}:${view.operationId}`, title: view.research?.query ?? view.map?.label ?? 'Your request', kind: view.research ? 'research' : 'artifact', referenceIds: [], content: taskSurface?.after }];
    else cards = view.records.map(record => ({ id: `record:${record.id}`, kind: record.type === 'published-video' ? 'video' : record.type === 'published-photo' ? 'photo' : 'record', title: record.name, referenceIds: [record.id], recordId: record.id, ...(record.type === 'published-video' ? { videoId: record.media?.assetId } : {}), content: <>
      {record.type === 'published-video' && record.media ? videoCard(record.media.assetId) : record.media && <figure className={styles.photo}><MediaImage assetId={record.media.assetId} size="display" fit="contain" interactive={false}/>{record.media.role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}
      <p>{record.summary}</p><dl className={styles.facts}>{record.values.map(value => <div key={value.fieldId}><dt>{value.label}</dt><dd>{value.text}</dd></div>)}</dl>
      <button type="button" className={styles.textButton} onClick={() => void execute('record.detail', { recordId: record.id })}>Read details ↗</button>
    </> }));
    if (!cards.length) cards = [{ id: `empty:${view.result.resultSetId}`, title: view.clarification ? 'A little more detail' : 'No matches yet', kind: 'information', referenceIds: [], content: null }];
  } else {
    for (const object of state.objects) {
      const records = object.references.flatMap(ref => { const item = workspaceRecord(authority, ref); return item?.members && ['collection', 'gallery'].includes(object.component) ? item.members.flatMap(member => workspaceRecord(authority, member) ?? []) : item ? [item] : []; });
      if (object.component === 'comparison' && displayCatalog) cards.push({ id: object.instanceId, title: 'Compare published details', kind: 'comparison', referenceIds: records.map(record => referenceKey(record.reference)), object, content: <PresentationView catalog={displayCatalog} state={initialInteraction(displayCatalog)} onAction={event => {
        const record = event.type === 'focus' && records.find(record => record.reference.id === event.params.id);
        if (!record) return;
        onInteraction(); const detail = objectInput(record);
        void apply(workspaceBatch(current.current, [{ kind: 'add', object: detail }, { kind: 'focus', instanceId: detail.instanceId }]));
      }} plan={{ schemaVersion: 1, snapshotId: displayCatalog.id, operation: 'compare', components: [{ id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: records.map(record => record.reference.id), attributeIds: displayCatalog.attributes.map(attribute => attribute.id).slice(0, 12) }], transition: { type: 'none' } }}/> });
      else if (object.component === 'map') { const record = records[0]; const location = catalog && record ? workspaceLocation(catalog, record.reference.id) : null; cards.push({ id: object.instanceId, title: record?.name ?? 'Location', kind: 'information', referenceIds: records.map(record => referenceKey(record.reference)), object, content: <><p>{location?.address ?? 'No address is published.'}</p><p>{location?.latitude != null ? `Published coordinates: ${location.latitude}, ${location.longitude}` : 'No unambiguous coordinates are published.'}</p></> }); }
      else records.forEach(record => cards.push({ id: referenceKey(record.reference), title: record.name, kind: record.reference.id.startsWith('video:') ? 'video' : record.reference.kind === 'photo' ? 'photo' : 'information', referenceIds: [referenceKey(record.reference)], record, object }));
    }
    cards = [...new Map(cards.map(card => [card.id, card])).values()].slice(0, 48);
    if (!cards.length) cards = [{ id: answer ? 'answer' : 'welcome', title: answer ? 'Your answer' : 'What would you like to explore?', kind: answer ? 'answer' : 'information', referenceIds: [], content: answer ? null : <p>Ask a question, explore a collection, or take a closer look. Your website is right where you left it.</p> }];
  }
  const key = view ? `${view.result.resultSetId}:${view.detail ? `detail:${view.detail.record.id}:${view.detail.blockOffset ?? 0}:${view.detail.fieldOffset ?? 0}` : view.comparison ? 'comparison' : view.focus ?? 'query'}` : `workspace:${state.revision}`;
  const ids = cards.map(card => card.id);
  const preferred = !view && state.focusedId ? cards.find(card => card.object?.instanceId === state.focusedId)?.id : undefined;
  const reconciled = reconcileCarousel(position, key, ids, key !== position.key ? preferred : undefined);
  if (reconciled !== position) { positionRef.current = reconciled; setPosition(reconciled); }
  const selected = cards.find(card => card.id === reconciled.activeId) ?? cards[0];
  const cardsRef = useRef(cards); cardsRef.current = cards;
  const selectedIndex = cards.findIndex(card => card.id === selected?.id);
  useLayoutEffect(() => {
    if (taskSurface) taskSurface.root.current = root.current;
    if (reading.current) reading.current.scrollTop = scrolls.current[selected?.id] ?? 0;
    if (selected) { const { id, title, kind, referenceIds } = selected; recent.current = [...recent.current.filter(card => card.id !== id), { id, title, kind, referenceIds }].slice(-12); }
    capture();
  // Context changes come from committed cards, never from the background website.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, key, active, answer, position.expanded]);
  useEffect(() => { if (!active) version.current++; }, [active]);
  async function confirm(signal?: AbortSignal): Promise<Status> {
    const expected = version.current;
    const start = performance.now();
    while (performance.now() - start < 1600) {
      await frame();
      const card = root.current?.querySelector<HTMLElement>('[data-carousel-card]');
      if (signal?.aborted || expected !== version.current || !activeRef.current) return 'cancelled';
      if (card?.dataset.carouselCard === positionRef.current.activeId && Number(getComputedStyle(card).opacity) >= .98) break;
    }
    if (signal?.aborted || expected !== version.current || !activeRef.current) return 'cancelled';
    const committed = root.current?.querySelector<HTMLElement>('[data-carousel-card]');
    if (committed?.dataset.carouselCard !== positionRef.current.activeId || Number(getComputedStyle(committed).opacity) < .98 || document.visibilityState !== 'visible') return 'failed';
    capture(); recordBrowserTestEvent('screen.confirmed', { activeId: positionRef.current.activeId, revision: revision.current }); return 'applied';
  }
  async function apply(batch: WorkspaceBatch, signal?: AbortSignal): Promise<Status> {
    if (signal?.aborted) return 'cancelled';
    try {
      const accepted = applyWorkspaceBatch(current.current, batch, authorityRef.current, context().scene.revision).state;
      frames.current = [...frames.current, current.current].slice(-12);
      version.current++; tasks?.hide(); current.current = accepted; setState(accepted); setError(''); onInvoke?.();
      return await confirm(signal);
    } catch (error) { setError(error instanceof Error ? error.message : 'This card could not be prepared.'); return 'failed'; }
  }
  function move(target: string, manual = true) {
    if (root.current?.contains(document.activeElement)) focusAfterMove.current = document.activeElement?.getAttribute('aria-label') ?? 'card';
    if (manual) onInteraction();
    version.current++;
    const next = moveCarousel(positionRef.current, cardsRef.current.map(card => card.id), target); positionRef.current = next; setPosition(next);
    if (next !== position && cardsRef.current.find(card => card.id === target)?.kind === 'photo') onPhotoView?.(cardsRef.current.find(card => card.id === target)?.record?.reference.id ?? cardsRef.current.find(card => card.id === target)?.recordId ?? '');
  }
  function expand(value: boolean, manual = true) { if (manual) onInteraction(); version.current++; const next = { ...positionRef.current, expanded: value, revision: positionRef.current.revision + 1 }; positionRef.current = next; setPosition(next); }
  async function navigate(kind: string, id?: string, itemIds?: string[], signal?: AbortSignal): Promise<Status> {
    if (signal?.aborted) return 'cancelled';
    if (kind === 'next' || kind === 'previous') {
      const all = cardsRef.current, index = all.findIndex(card => card.id === positionRef.current.activeId), target = all[index + (kind === 'next' ? 1 : -1)];
      if (target) { move(target.id, false); return confirm(signal); }
      if (kind === 'previous' && view && (view.result.items[0]?.ordinal ?? 1) > 1) return await execute('view.back', { target: 'previous' }, false, signal) ? 'applied' : 'failed';
      if (kind === 'next' && view?.result.nextCursor) return await execute('query.page', { cursor: view.result.nextCursor }, false, signal) ? 'applied' : 'failed';
      return 'failed';
    }
    if (kind === 'expand' || kind === 'collapse') { if (id) { const target = cardsRef.current.find(card => card.id === id || card.referenceIds.includes(id) || card.object?.instanceId === id || card.record?.reference.id === id); if (target) move(target.id, false); } expand(kind === 'expand', false); return confirm(signal); }
    if (kind === 'back') {
      if (positionRef.current.expanded) { expand(false, false); return confirm(signal); }
      if (view) return await execute('view.back', { target: view.detail || view.comparison ? 'results' : 'previous' }, false, signal) ? 'applied' : 'failed';
      const previous = frames.current.pop(); if (previous) { current.current = previous; setState(previous); return confirm(signal); }
      return 'failed';
    }
    if (kind === 'home') { onDismiss?.(); window.scrollTo({ top: 0, behavior: 'instant' }); return 'applied'; }
    if (kind === 'start_over') { await tasks?.home(signal); frames.current = []; return navigate('clear', undefined, undefined, signal); }
    if (kind === 'clear') { tasks?.hide(); const initial = emptyWorkspace(authorityRef.current.publicationId); current.current = initial; setState(initial); setPosition(initialCarouselPosition()); return confirm(signal); }
    if (kind === 'browse') return taskSurface?.available ? await execute('view.reset', {}, false, signal) ? 'applied' : 'failed' : navigate('home', undefined, undefined, signal);
    if (kind === 'unfocus' || kind === 'close' || kind === 'dismiss') { onDismiss?.(); return 'applied'; }
    if (['top', 'bottom', 'up', 'down', 'next_section', 'previous_section'].includes(kind)) { const element = reading.current; element?.scrollTo({ top: kind === 'top' ? 0 : kind === 'bottom' ? element.scrollHeight : element.scrollTop + (['up', 'previous_section'].includes(kind) ? -1 : 1) * element.clientHeight * .8, behavior: 'instant' }); return confirm(signal); }
    const target = cardsRef.current.find(card => card.id === id || card.referenceIds.includes(id ?? '') || card.object?.instanceId === id || card.record?.reference.id === id);
    if (target) { move(target.id, false); if (kind === 'open' || kind === 'focus') expand(true, false); return confirm(signal); }
    const record = authorityRef.current.records.find(record => referenceKey(record.reference) === id || record.reference.id === id || `${record.reference.kind}:${record.reference.id}` === id);
    if (record) return apply(workspaceBatch(current.current, [{ kind: 'replace', objects: [objectInput(record)] }]), signal);
    if (kind === 'compare' && itemIds && catalog) return apply(workspaceBatch(current.current, [{ kind: 'replace', objects: [{ instanceId: 'comparison', component: 'comparison', references: itemIds.map(id => ({ kind: 'entity', id, revisionId: catalog.id })) }] }]), signal);
    return 'failed';
  }
  async function command(text: string, signal?: AbortSignal) {
    const command = carouselCommand(text); if (!command) return false;
    if (command.action === 'dismiss') { onDismiss?.(); return true; }
    if (command.action === 'open') { const ordinal = command.ordinal ?? 1; const card = cardsRef.current[ordinal - (view?.result.items[0]?.ordinal ?? 1)]; if (!card && view && ordinal <= view.result.count.value) { await tasks?.openOrdinal(ordinal); return true; } if (!card) setError('Which card? Use a number in these results or its name.'); else { move(card.id, false); expand(true, false); await confirm(signal); } return true; }
    const status = await navigate(command.action, undefined, undefined, signal); if (status === 'failed') setError(command.action === 'next' ? 'You are at the last card.' : 'There is no previous card in this set.'); return true;
  }
  function externalCommand(command: ExploreCommand) {
    const selectedRecord = cardsRef.current.find(card => card.id === positionRef.current.activeId)?.record;
    const result = external.find(result => result.id === selectedRecord?.reference.id) ?? external.at(-1); if (!result) return false;
    if (command.kind === 'back') { if (externalSelection[result.id]) setExternalSelection(current => ({ ...current, [result.id]: null })); else void navigate('back'); }
    else if (command.kind === 'open_source' || command.kind === 'open_image') {
      const valid = command.kind === 'open_image' ? result.images.some(image => image.id === command.id) : result.sources.some((_, index) => command.id === `source-${index + 1}`);
      if (!valid) return false; setExternalSelection(current => ({ ...current, [result.id]: command.id }));
    } else if (command.kind === 'images' || command.kind === 'web') { setExternal(items => items.map(item => item.id === result.id ? { ...item, kind: command.kind as 'images' | 'web' } : item)); setExternalSelection(current => ({ ...current, [result.id]: null })); }
    else if ((command.kind === 'zoom_in' || command.kind === 'zoom_out') && result.map) setExternal(items => items.map(item => item.id === result.id ? { ...item, map: { ...result.map!, zoom: Math.max(2, Math.min(12, result.map!.zoom + (command.kind === 'zoom_in' ? 1 : -1))) } } : item));
    else return false;
    void frame().then(capture); return true;
  }
  function context() {
    const pos = positionRef.current, activeCard = cardsRef.current.find(card => card.id === pos.activeId);
    const element = reading.current;
    const block = element && [...element.querySelectorAll<HTMLElement>('[data-reading-block]')].find(block => block.getBoundingClientRect().bottom >= element.getBoundingClientRect().top + 10)?.dataset.readingBlock;
    const scene: WorkspaceScene = { revision: revision.current, workspaceRevision: current.current.revision, visibility: activeRef.current && document.visibilityState === 'visible' ? 'visible' : 'hidden', page: 'workspace', focusedId: current.current.focusedId, objects: current.current.objects.map((object, index) => ({ instanceId: object.instanceId, order: index + 1, name: object.references.map(ref => workspaceRecord(authorityRef.current, ref)?.name).join(' / ').slice(0, 160), references: object.references, open: true, mounted: activeRef.current && object.instanceId === activeCard?.object?.instanceId, visibility: activeRef.current && object.instanceId === activeCard?.object?.instanceId ? 'full' : 'unmounted', position: 'center', rect: null, selected: object.selected, expanded: object.expanded, controls: ['expand', 'collapse', 'return', 'scroll'], scroll: null })) };
    // Context/answer updates, narration and repeated ACKs are observations, not
    // new navigation. Guard batches against changes to actual cards and reading
    // position instead. Answer/loading placeholders never identify a target.
    const sceneKey = JSON.stringify({ ...scene, revision: 0, result: view ? key : null,
      activeCard: view || activeCard?.object ? activeCard?.id : null, expanded: pos.expanded,
      scrollTop: Math.round(element?.scrollTop ?? 0), externalSelection });
    if (sceneClock.current.key !== sceneKey) sceneClock.current = { key: sceneKey, revision: sceneClock.current.revision + 1 };
    scene.revision = sceneClock.current.revision;
    const carousel: CarouselContext = { version: 1, open: activeRef.current, revision: revision.current, cards: cardsRef.current.map(({ id, title, kind, referenceIds }) => ({ id, title, kind, referenceIds })), activeId: pos.activeId, previousId: pos.previousId, lastNarratedId: lastNarrated.current, expanded: pos.expanded, recentCards: recent.current, ...(view ? { page: { start: view.result.items[0]?.ordinal ?? 1, total: view.result.count.value } } : {}), reading: { scrollTop: Math.round(element?.scrollTop ?? 0), blockId: block ?? null }, media: activeCard?.kind === 'video' ? Object.values(playback.current).find(item => activeCard.record?.reference.id === `video:${item.id}` || activeCard.videoId === item.id) ?? null : null, ...(answer ? { answer: answer.slice(0, 8000) } : {}) };
    const externalResults = external.map(result => exploreContextForResult(result, result.kind, externalSelection[result.id] ?? null));
    return { workspace: { ...current.current, receipts: [] }, scene, carousel, ...(externalResults.length ? { externalResults, explore: externalResults.at(-1) } : {}) };
  }
  useImperativeHandle(handleRef, () => ({ context, apply, confirm, command, navigate,
    intent: async (text, signal) => { if (await command(text, signal)) return true; const result = planWorkspaceIntent(text, current.current, authorityRef.current, context().scene, catalog, media); if (!result.batch) { setError(result.message); return false; } return await apply(result.batch, signal) === 'applied'; },
    plan: (plan, signal) => apply('schemaVersion' in plan && catalog ? workspaceFromPlan(plan, current.current, authorityRef.current, catalog, media) : workspaceFromSources(plan as SitePresentation, current.current, authorityRef.current, content, media), signal),
    greeting: async (index, signal) => { const card = cardsRef.current[index ?? 0]; if (card) move(card.id, false); lastNarrated.current = card?.id ?? null; return confirm(signal); },
    showExternal: async (input, signal) => { const result = exploreResultSchema.parse(input); const next = [...external.filter(item => item.id !== result.id), result].slice(-6); const nextAuthority = publishedWorkspace(content, catalog, media, next.map(result => exploreContextForResult(result, result.kind, null))); setExternal(next); authorityRef.current = nextAuthority; const record = nextAuthority.records.find(record => record.reference.kind === 'external' && record.reference.id === result.id)!; return apply(workspaceBatch(current.current, [{ kind: 'replace', objects: [objectInput(record)] }]), signal); },
    externalCommand, annotationTarget: () => selected?.object ? annotationTargetForObject(current.current, selected.object.instanceId) : undefined,
    browse: signal => navigate('browse', undefined, undefined, signal), home: signal => navigate('home', undefined, undefined, signal), clear: signal => navigate('clear', undefined, undefined, signal), restoreWebsite: signal => navigate('browse', undefined, undefined, signal), releaseFocus: async () => 'applied', beforeSearch: () => {}, reset: () => { void navigate('clear'); }, narrate: () => { lastNarrated.current = positionRef.current.activeId; capture(); },
  }));
  const drag = useRef<{ x: number; y: number } | null>(null);
  return <section ref={root} className={styles.rail} data-ai-carousel data-active-card={selected.id} data-result-set={view?.result.resultSetId} data-workspace-transition="settled" data-carousel-active={active} aria-label="Assistant cards" aria-busy={pending || taskSurface?.busy}>
    <AnimatePresence initial={false} mode="wait">
      <motion.article className={styles.card} key={selected.id} data-carousel-card={selected.id} data-task-record={selected.recordId} data-expanded={position.expanded} tabIndex={0} aria-label={selected.title}
        initial={{ opacity: 0, x: reduced ? 0 : 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -16 }} transition={{ duration: reduced ? 0 : .22, ease: [.22, 1, .36, 1] }}
        onAnimationComplete={() => { const label = focusAfterMove.current; if (!label || root.current?.querySelector<HTMLElement>('[data-carousel-card]')?.dataset.carouselCard !== positionRef.current.activeId) return; focusAfterMove.current = null; if (document.activeElement !== document.body && !root.current?.contains(document.activeElement)) return; const target = [...root.current?.querySelectorAll<HTMLButtonElement>('button') ?? []].find(button => button.getAttribute('aria-label') === label && !button.disabled); (target ?? root.current?.querySelector<HTMLElement>('[data-carousel-card]'))?.focus({ preventScroll: true }); }}
        onKeyDown={event => { if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, video, iframe')) return; if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); expand(true); } if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); onInteraction(); void navigate(event.key === 'ArrowRight' ? 'next' : 'previous'); } }}
        onPointerDown={event => { if (event.pointerType === 'touch') drag.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={event => { const origin = drag.current; drag.current = null; if (origin && Math.abs(event.clientX - origin.x) > 70 && Math.abs(event.clientY - origin.y) < 45) { onInteraction(); void navigate(event.clientX < origin.x ? 'next' : 'previous'); } }}>
        <div className={styles.reading} ref={reading} data-workspace-scroll onScroll={() => { scrolls.current[selected.id] = reading.current?.scrollTop ?? 0; capture(); }}>
          <div className={styles.eyebrow}>{view ? view.detail ? 'A closer look' : `${view.result.count.value} matching ${view.result.count.value === 1 ? 'item' : 'items'}` : selected.kind === 'photo' ? 'In pictures' : 'Explore'}</div>
          {!(view?.detail || view?.comparison) && <h2>{selected.title}</h2>}
          {view && !view.detail && !view.comparison && <div className={styles.criteria}>{taskSurface?.header}</div>}
          {(error || taskSurface?.error) && <p role="alert">{error || taskSurface?.error}</p>}
          {answer && <aside className={styles.answer} aria-label="Assistant answer"><AssistantAnswer text={answer}/></aside>}
          {selected.content ?? (selected.record ? recordContent(selected.record, position.expanded) : null)}
          {pending && <p className={styles.pending} role="status">Preparing your response…</p>}
        </div>
        <footer className={styles.controls}>
          <button type="button" aria-label="Previous card" disabled={selectedIndex <= 0 && (view?.result.items[0]?.ordinal ?? 1) <= 1} onClick={() => { onInteraction(); void navigate('previous'); }}><ChevronLeft size={20}/></button>
          <span role="status" aria-live="polite">{selectedIndex + (view?.detail || view?.comparison ? 1 : view?.result.items[0]?.ordinal ?? 1)} / {view?.detail || view?.comparison ? 1 : view?.result.count.value || cards.length}</span>
          <button type="button" aria-label="Next card" disabled={selectedIndex === cards.length - 1 && !view?.result.nextCursor} onClick={() => { onInteraction(); void navigate('next'); }}><ChevronRight size={20}/></button>
          <button type="button" className={styles.expand} aria-label={position.expanded ? 'Collapse card' : 'Expand card'} aria-expanded={position.expanded} onClick={() => expand(!position.expanded)}>{position.expanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
        </footer>
      </motion.article>
    </AnimatePresence>
  </section>;
}
