'use client';

import { createContext, forwardRef, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion, useScroll, useSpring, type HTMLMotionProps } from 'motion/react';
import { z } from 'zod';
import { createLibrary, defineComponent, useTriggerAction, type ElementNode } from './openui.js';
import { formatAttribute, filterEntities, knownAttributes } from './catalog.js';
import type { AttributeDefinition, KnowledgeCatalog, PresentationPlan } from './contracts.js';
import type { CatalogInteractionState, FocusReference, ReturnAnchor } from './interaction.js';
import { Disclosure, MotionHeight, SemanticSurface, feedbackTransition, motionTiming, revealTransition, sequenceItemVariants, sequenceVariants, surfaceTransition } from './motion.js';
import { EntityMedia, MediaGallery } from './MediaViews.js';

export type RuntimeContextValue = { spotlightId?: string | null; catalog: KnowledgeCatalog; state: CatalogInteractionState; plan: PresentationPlan;
  onLinkClick?: (event: { kind: 'link_click'; entityId?: string; capabilityId: string }) => void;
  onInteraction?: () => void;
  onMediaFocusChange?: (reference: FocusReference | null, origin?: ReturnAnchor | null) => void;
};
export const RuntimeContext = createContext<RuntimeContextValue | null>(null);
function useCatalog() {
  const context = useContext(RuntimeContext);
  if (!context) throw new Error('Catalog components require their runtime context.');
  return context;
}
function useAction() {
  const trigger = useTriggerAction();
  return (type: string, params: Record<string, unknown> = {}) => trigger('Update this view', undefined, { type, params });
}

/** Shared non-modal orchestration shell for a focused entity or photo. */
export function FocusStage({ children, context, focused = false, onClose, label = 'Focused content', managed = false }: { children?: ReactNode; context?: ReactNode; focused?: boolean; onClose?: () => void; label?: string; managed?: boolean }) {
  const reduced = useReducedMotion();
  const hasContext = context !== undefined && context !== null;
  const [layerActive, setLayerActive] = useState(focused);
  const focusActive = focused || layerActive;
  const showChildren = focused || !hasContext && layerActive;
  const stage = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || managed) return;
    const properties = ['--platform-focus-top', '--platform-focus-right', '--platform-focus-bottom', '--platform-focus-left'];
    const clear = () => properties.forEach(property => element.style.removeProperty(property));
    if (!focused) { if (!layerActive) clear(); return; }
    const root = element.closest<HTMLElement>('[data-visitor-site], .platform-explorer') ?? element;
    const scrollParent = (() => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
      }
      return null;
    })();
    const update = () => {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const visible = scrollParent?.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      const top = Math.max(viewportTop, visible?.top ?? viewportTop);
      const right = Math.min(viewportRight, visible?.right ?? viewportRight, rootBounds.right);
      const bottom = Math.min(viewportBottom, visible?.bottom ?? viewportBottom);
      const left = Math.max(viewportLeft, visible?.left ?? viewportLeft, rootBounds.left);
      if (![top, right, bottom, left].every(Number.isFinite) || right <= left || bottom <= top) return;
      element.style.setProperty('--platform-focus-top', `${top}px`);
      element.style.setProperty('--platform-focus-right', `${Math.max(0, viewportRight - right)}px`);
      element.style.setProperty('--platform-focus-bottom', `${Math.max(0, viewportBottom - bottom)}px`);
      element.style.setProperty('--platform-focus-left', `${left}px`);
    };
    update();
    const resize = () => update();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, { passive: true, capture: true });
    scrollParent?.addEventListener('scroll', resize, { passive: true });
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(root);
    if (scrollParent) observer?.observe(scrollParent);
    const clearOnCleanup = !focused || !layerActive;
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
      scrollParent?.removeEventListener('scroll', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      observer?.disconnect();
      if (clearOnCleanup) clear();
    };
  }, [focused, layerActive, managed]);
  if (managed) return <section ref={stage} className="platform-workspace-stage" data-focus-stage="true" data-focus-active={focused} aria-label={label}>{context}{children}</section>;
  return <section ref={stage} className="platform-focus-stage" data-focus-stage="true" data-focus-active={focusActive || undefined} aria-label={label} onKeyDown={event => {
    if (event.key === 'Escape' && focused && onClose) { event.preventDefault(); onClose(); }
  }}>
    {context && <motion.div className="platform-focus-context" data-focus-context="true" inert={focusActive || undefined} aria-hidden={focusActive || undefined} initial={false} animate={focused ? { opacity: 0.34, ...(reduced ? {} : { filter: 'saturate(0.72)' }) } : { opacity: 1, filter: 'saturate(1)' }} transition={reduced ? { duration: 0 } : surfaceTransition}>{context}</motion.div>}
    <motion.div className="platform-focus-surface-layer" data-focus-layer="true" layout={false} onPointerDown={event => {
      if (focused && onClose && event.target === event.currentTarget) { event.preventDefault(); onClose(); }
    }}>
      {focusActive && <motion.div className="platform-focus-scrim" data-focus-scrim="true" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: focused ? 1 : 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : .45 }} onAnimationStart={() => { if (focused) setLayerActive(true); }} onPointerDown={event => {
        if (focused && onClose) { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}/>}
      <AnimatePresence initial={false} onExitComplete={() => { if (!focused) setLayerActive(false); }}>
        {showChildren ? children : null}
      </AnimatePresence>
    </motion.div>
  </section>;
}

/** A composed, page-region focus surface. It is intentionally not a dialog. */
export function FocusSurface({ children, reference, onClose, title, returnLabel = 'Back to results', managed = false }: { children: ReactNode; reference?: FocusReference | null; onClose?: () => void; title?: string; returnLabel?: string; managed?: boolean }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  if (managed) return <section className="platform-workspace-focus-content" data-focus-surface="true" data-focus-reference-kind={reference?.kind} data-focus-reference-id={reference?.id} aria-label={title}>
    {onClose && <ReturnAnchor onReturn={onClose} label={returnLabel}/>} {children}
  </section>;
  return <motion.section className="platform-focus-surface" data-focus-surface="true" data-focus-reference-kind={reference?.kind} data-focus-reference-id={reference?.id} aria-label={title ? `${title} focused surface` : undefined}
    layout={reduced ? false : 'position'} inert={!present || undefined} aria-hidden={!present || undefined}
    initial={false} animate={{ opacity: 1 }}
    // Hold the surface visually opaque for the reverse layout pass. A tiny
    // opacity delta keeps AnimatePresence mounted for the same workspace
    // duration without introducing a fade that would break card identity.
    exit={{ opacity: reduced ? 1 : 0.999, transition: { ...revealTransition, duration: reduced ? 0 : motionTiming.workspace, layout: reduced ? { duration: 0 } : surfaceTransition } }}
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.workspace, layout: reduced ? { duration: 0 } : surfaceTransition }}>
    {onClose && <ReturnAnchor onReturn={onClose} label={returnLabel}/>} {children}
  </motion.section>;
}

/** Stable return affordance shared by entity and photo focused surfaces. */
export function ReturnAnchor({ onReturn, label = 'Back to results' }: { onReturn: () => void; label?: string }) {
  return <button type="button" className="platform-return-anchor" data-return-anchor="true" onClick={onReturn}><Icon name="back" size={14}/><span>{label}</span></button>;
}

/** Semantic, interruptible evidence disclosure used by focused surfaces. */
export function DisclosureStack({ children, label = 'More context', defaultOpen = false, open: controlledOpen, onOpenChange }: { children: ReactNode; label?: string; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [localOpen, setOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const contentId = useId();
  return <div className="platform-disclosure-stack" data-disclosure-stack="true">
    <button type="button" className="platform-text-button" aria-expanded={open} aria-controls={contentId} onClick={() => { setOpen(!open); onOpenChange?.(!open); }}>{open ? 'Show less' : label}<Icon name={open ? 'close' : 'arrow'} size={13}/></button>
    <AnimatePresence initial={false}>{open && <Disclosure name="evidence"><div id={contentId} className="platform-disclosure-content">{children}</div></Disclosure>}</AnimatePresence>
  </div>;
}

/** Shared status bridge for voice/chat intent acknowledgement. */
export function VoiceFocusBridge({ status, reference, children }: { status?: string; reference?: FocusReference | null; children?: ReactNode }) {
  return <div className="platform-voice-focus-bridge" data-voice-focus-bridge="true" data-voice-focus-open={reference ? 'true' : undefined} data-voice-focus-kind={reference?.kind} data-voice-focus-id={reference?.id}>{children}<span className="platform-sr-only" role="status" aria-live="polite" aria-atomic="true">{status || ''}</span></div>;
}

export function Icon({ name, size = 17 }: { name: 'arrow' | 'plus' | 'check' | 'close' | 'back' | 'filter' | 'compare' | 'spark'; size?: number }) {
  const paths = {
    arrow: 'M6 18 18 6M6 6h12v12', plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6', back: 'm12 5-7 7 7 7M5 12h14',
    filter: 'M4 7h16M7 12h10M10 17h4', compare: 'M4 5h6v14H4zM14 5h6v14h-6z',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

const componentProps = () => z.object({ entityIds: z.array(z.string()), attributeIds: z.array(z.string()), variant: z.string(), collectionId: z.string(), capabilityIds: z.array(z.string()), assetIds: z.array(z.string()), albumId: z.string() });
type ComponentProps = z.infer<ReturnType<typeof componentProps>>;
function definitions(catalog: KnowledgeCatalog, ids: string[]) {
  return ids.flatMap(id => catalog.attributes.find(attribute => attribute.id === id) ?? []);
}
function cardAttributes(catalog: KnowledgeCatalog, entity: KnowledgeCatalog['entities'][number], preferred: AttributeDefinition[]) {
  const preferredIds = new Set(preferred.map(attribute => attribute.id));
  const ordered = [...preferred, ...catalog.attributes.filter(attribute => !preferredIds.has(attribute.id))]
    // A card already has an authored summary. Repeating a free-form description as a fact
    // makes the dense card layout look like a raw import rather than a composed reading view.
    .filter(attribute => !/^(?:description|summary)$/i.test(attribute.label.trim()));
  return knownAttributes(entity, ordered).slice(0, 3);
}
function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <div className="platform-section-heading"><div>{eyebrow && <span className="platform-eyebrow">{eyebrow}</span>}<h3>{title}</h3></div>{children}</div>;
}

const PresentCard = forwardRef<HTMLElement, HTMLMotionProps<'article'>>(function PresentCard(props, ref) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return <motion.article {...props} ref={ref} layout={reduced ? false : 'position'} whileHover={reduced ? undefined : { y: -4 }} whileTap={reduced ? undefined : { scale: 0.992 }} whileFocus={reduced ? undefined : { y: -2 }} style={{ ...props.style, borderRadius: 13 }} inert={!present} aria-hidden={!present || undefined}
    variants={reduced ? undefined : sequenceItemVariants} initial={reduced ? false : 'hidden'} animate="visible" exit="exit"
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reveal, layout: reduced ? { duration: 0 } : surfaceTransition }}>
    <motion.div layout={reduced ? false : 'position'} className="platform-item-content" transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }}>{props.children}</motion.div>
  </motion.article>;
});

const PresentChip = forwardRef<HTMLButtonElement, HTMLMotionProps<'button'>>(function PresentChip(props, ref) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return <motion.button {...props} ref={ref} layout={reduced ? false : 'position'} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}
    exit={{ opacity: 0, transition: { ...revealTransition, duration: reduced ? 0 : motionTiming.exit } }}
    whileHover={reduced ? undefined : { y: -1 }} whileTap={reduced ? undefined : { scale: 0.98 }} whileFocus={reduced ? undefined : { scale: 1.02 }}
    transition={{ ...feedbackTransition, duration: reduced ? 0 : motionTiming.feedback, layout: reduced ? { duration: 0 } : surfaceTransition }}/>;
});

function CollectionContent({ entityIds, attributeIds, variant, collectionId }: ComponentProps) {
  const { catalog, state, onInteraction, spotlightId } = useCatalog();
  const action = useAction();
  const reduced = useReducedMotion();
  const [limit, setLimit] = useState(18);
  const collection = catalog.collections.find(item => item.id === collectionId);
  const collectionTabs = catalog.collections.filter(item => item.name.toLocaleLowerCase() !== 'all items' || item.entityIds.length !== catalog.entities.length);
  const allowed = new Set(entityIds.length ? entityIds : collection?.entityIds ?? catalog.entities.map(entity => entity.id));
  const entities = filterEntities(catalog, state.filters).filter(entity => allowed.has(entity.id));
  const attributes = definitions(catalog, attributeIds).slice(0, 3);
  return <section className="platform-collection" aria-label="Published collection">
    <SectionHeading eyebrow={state.filters.length ? 'REFINED FOR YOU' : 'ROOM TO EXPLORE'} title={collection?.name || (entityIds.length ? 'Your possibilities' : 'Explore the collection')}>
      <span className="platform-count">{entities.length} {entities.length === 1 ? 'item' : 'items'}</span>
    </SectionHeading>
    {collectionTabs.length > 0 && <div className="platform-collection-tabs" aria-label="Collections">
      <button type="button" aria-pressed={!collectionId} onClick={() => { setLimit(18); action('collection', { id: '' }); }}>All items</button>
      {collectionTabs.map(item => <button type="button" key={item.id} aria-pressed={item.id === collectionId} onClick={() => { setLimit(18); action('collection', { id: item.id }); }}>{item.name}</button>)}
    </div>}
    <MotionHeight><motion.div layout={reduced ? false : 'position'} variants={reduced ? undefined : sequenceVariants} initial={reduced ? false : 'hidden'} animate="visible" className="platform-items" data-variant={variant} transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }}>
      <AnimatePresence initial={false} mode="popLayout">
      {!entities.length && <PresentCard key="empty" className="platform-empty"><Icon name="filter" size={26}/><h4>A little too specific.</h4><p>No published items match these filters. Ask the assistant to adjust your request.</p><button className="platform-button" type="button" onClick={() => action('clear-filters')}>Clear filters</button></PresentCard>}
      {entities.slice(0, limit).map((entity, index) => {
        const selected = state.selectedIds.includes(entity.id);
        const selectDisabled = !selected && state.selectedIds.length >= 6;
        const details = cardAttributes(catalog, entity, attributes);
        const layout = variant !== 'list' && index === 0 ? 'feature' : details.length === 0 ? 'narrative' : details.length === 1 ? 'spotlight' : 'details';
        return <PresentCard key={`item-${entity.id}`} layoutId={`entity-card-${entity.id}`} className="platform-item" data-entity-id={entity.id} data-card-focus={`entity:${entity.id}`} data-spotlight={spotlightId === entity.id} data-expanded={spotlightId === entity.id} data-selected={selected} data-detail-count={details.length} data-layout={layout}
          onClick={event => { if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return; action('focus', { id: entity.id }); }}>
          <EntityMedia targetId={entity.id}/>
          <div className="platform-item-kicker"><span>{entity.kind}</span><span>{String(index + 1).padStart(2, '0')}</span></div>
          <button className="platform-item-open" type="button" data-focus-key={`entity:${entity.id}`} onClick={() => action('focus', { id: entity.id })}><motion.h4 layoutId={`entity-title-${entity.id}`}>{entity.name}</motion.h4><Icon name="arrow"/></button>
          <p className="platform-item-summary">{entity.summary}</p>
          {!!details.length && <dl className="platform-item-attributes">{details.map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}</dl>}
          <div className="platform-item-bottom"><button className="platform-select" type="button" aria-pressed={selected} disabled={selectDisabled} aria-label={`${selected ? 'Remove' : 'Select'} ${entity.name} ${selected ? 'from' : 'for'} comparison`} onClick={() => action('select', { id: entity.id })}><Icon name={selected ? 'check' : 'plus'} size={15}/><span>{selected ? 'Selected' : 'Compare'}</span></button></div>
        </PresentCard>;
      })}</AnimatePresence>
    </motion.div></MotionHeight>
    {entities.length > limit && <button className="platform-button platform-load-more" type="button" onClick={() => { onInteraction?.(); setLimit(value => value + 12); }}>Show more <span>{entities.length - limit} remaining</span></button>}
  </section>;
}


function DetailProgress({ target }: { target: RefObject<HTMLElement | null> }) {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target, offset: ['start end', 'end start'] });
  const scaleX = useSpring(scrollYProgress, reduced ? { stiffness: 1000, damping: 100 } : { stiffness: 170, damping: 30, mass: 0.22 });
  return <div className="platform-reading-progress" aria-hidden="true"><motion.span style={{ scaleX }}/><motion.svg viewBox="0 0 48 10" focusable="false"><motion.path d="M1 5h8l3-3 4 6 5-7 5 8 4-5 5 1h12" fill="none" pathLength={1} initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reveal }}/></motion.svg></div>;
}

function DetailContent({ entityIds, attributeIds }: ComponentProps) {
  const { catalog, state } = useCatalog();
  const action = useAction();
  const detail = useRef<HTMLElement>(null);
  const entity = catalog.entities.find(item => item.id === entityIds[0])!;
  const selected = state.selectedIds.includes(entity.id);
  const details = knownAttributes(entity, definitions(catalog, attributeIds));
  return <motion.section ref={detail} layoutId={`entity-card-${entity.id}`} layout="position" className="platform-detail" data-entity-id={entity.id} aria-label={`Details of ${entity.name}`} transition={{ layout: surfaceTransition }}>
    <DetailProgress target={detail}/><span className="platform-eyebrow">{entity.kind} · A CLOSER LOOK</span><motion.h3 layoutId={`entity-title-${entity.id}`} tabIndex={-1} data-platform-focus>{entity.name}</motion.h3><p className="platform-detail-summary">{entity.summary}</p>
    <EntityMedia targetId={entity.id} variant="detail" includeExamples/>
    {!!details.length && <DisclosureStack defaultOpen label="Show published details"><dl className="platform-detail-attributes">{details.map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}</dl></DisclosureStack>}
    <button className="platform-button" type="button" aria-pressed={selected} disabled={!selected && state.selectedIds.length >= 6} onClick={() => action('select', { id: entity.id })}><Icon name={selected ? 'check' : 'plus'}/>{selected ? 'Selected for comparison' : 'Add to comparison'}</button>
  </motion.section>;
}

function ComparisonContent({ entityIds, attributeIds }: ComponentProps) {
  const { catalog } = useCatalog();
  const action = useAction();
  const entities = entityIds.flatMap(id => catalog.entities.find(entity => entity.id === id) ?? []);
  const attributes = definitions(catalog, attributeIds).filter(attribute => entities.some(entity => knownAttributes(entity, [attribute]).length));
  return <section className="platform-comparison" aria-label="Compare published attributes">
    <SectionHeading eyebrow="A LITTLE PERSPECTIVE" title="Side by side"><Icon name="compare" size={22}/></SectionHeading>
    <p className="platform-section-intro">The details that make the difference.</p>
    <div className="platform-comparison-table"><table><caption className="platform-sr-only">Comparison of {entities.map(entity => entity.name).join(', ')}</caption><thead><tr><th scope="col">Published details</th>{entities.map(entity => <th scope="col" key={entity.id} data-entity-id={entity.id}><EntityMedia targetId={entity.id} variant="comparison"/><span>{entity.kind}</span><button type="button" onClick={() => action('focus', { id: entity.id })}>{entity.name}<Icon name="arrow" size={14}/></button></th>)}</tr></thead><tbody>{attributes.map(attribute => <tr key={attribute.id}><th scope="row">{attribute.label}</th>{entities.map(entity => <td key={entity.id} data-entity-id={entity.id}>{knownAttributes(entity, [attribute]).length ? formatAttribute(entity.attributes[attribute.id], attribute) : ''}</td>)}</tr>)}</tbody></table></div>
    <div className="platform-comparison-mobile">{entities.map(entity => { const details = knownAttributes(entity, attributes); return <article key={entity.id} data-entity-id={entity.id}><EntityMedia targetId={entity.id} variant="comparison"/><button type="button" className="platform-item-open" onClick={() => action('focus', { id: entity.id })}><h4>{entity.name}</h4><Icon name="arrow"/></button>{!!details.length && <dl>{details.map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}</dl>}</article>; })}</div>
  </section>;
}

function SelectionContent() {
  const { catalog, state } = useCatalog();
  const action = useAction();
  const entities = state.selectedIds.flatMap(id => catalog.entities.find(entity => entity.id === id) ?? []);
  return <AnimatePresence>{entities.length > 0 && <Disclosure key="shortlist" name="selection"><section className="platform-selection" aria-label="Selected for comparison"><div className="platform-selection-label"><Icon name="compare"/><span>Your shortlist <b>{entities.length}/6</b></span></div>
    <div className="platform-selection-items"><AnimatePresence initial={false} mode="popLayout">{entities.map(entity => <PresentChip key={entity.id} data-entity-id={entity.id} type="button" onClick={() => action('select', { id: entity.id })} aria-label={`Remove ${entity.name} from comparison`}>{entity.name}<Icon name="close" size={12}/></PresentChip>)}</AnimatePresence></div>
    <button className="platform-button platform-primary" type="button" disabled={entities.length < 2 || !catalog.attributes.length} onClick={() => action('compare')}><span>{entities.length < 2 ? 'Choose one more' : 'Compare selections'}</span><Icon name="arrow" size={14}/></button>
  </section></Disclosure>}</AnimatePresence>;
}

function RelationshipsContent({ entityIds }: ComponentProps) {
  const { catalog } = useCatalog();
  const action = useAction();
  const relationships = catalog.relationships.filter(relation => entityIds.includes(relation.fromEntityId) || entityIds.includes(relation.toEntityId));
  if (!relationships.length) return null;
  return <section className="platform-related"><SectionHeading eyebrow="THE CONNECTIONS" title="A little more context"/><div className="platform-related-items">{relationships.map(relation => {
    const from = catalog.entities.find(entity => entity.id === relation.fromEntityId)!;
    const to = catalog.entities.find(entity => entity.id === relation.toEntityId)!;
    return <div key={relation.id}><button type="button" data-entity-id={from.id} onClick={() => action('focus', { id: from.id })}>{from.name}</button><span>{relation.label}</span><button type="button" data-entity-id={to.id} onClick={() => action('focus', { id: to.id })}>{to.name}<Icon name="arrow" size={13}/></button></div>;
  })}</div></section>;
}

function ActionsContent({ capabilityIds, entityIds }: ComponentProps) {
  const { catalog, onLinkClick } = useCatalog();
  const actions = capabilityIds.flatMap(id => catalog.capabilities?.find(action => action.id === id) ?? []);
  return <section className="platform-actions" aria-label="Published next steps"><SectionHeading eyebrow="WHEN YOU’RE READY" title="Take the next step"/><div>{actions.map(action => <a key={action.id} className="platform-button" href={action.url} target="_blank" rel="noopener noreferrer"
    onClick={() => onLinkClick?.({ kind: 'link_click', capabilityId: action.id, ...(entityIds[0] ? { entityId: entityIds[0] } : {}) })}>{action.label}<Icon name="arrow" size={14}/></a>)}</div><p>Opens the publisher’s website in a new tab.</p></section>;
}

const CollectionView = defineComponent({ name: 'CollectionView', description: 'Explore a bounded published collection with stable item identity.', props: componentProps(), component: ({ props }) => <CollectionContent {...props}/> });
const EntityDetail = defineComponent({ name: 'EntityDetail', description: 'A published entity and its known attributes.', props: componentProps(), component: ({ props }) => <DetailContent {...props}/> });
const AttributeComparison = defineComponent({ name: 'AttributeComparison', description: 'Compare identical attribute definitions across published entities.', props: componentProps(), component: ({ props }) => <ComparisonContent {...props}/> });
const SelectionTray = defineComponent({ name: 'SelectionTray', description: 'Runtime-owned comparison selections.', props: componentProps(), component: () => <SelectionContent/> });
const RelatedEntities = defineComponent({ name: 'RelatedEntities', description: 'Explicit relationships between published entities.', props: componentProps(), component: ({ props }) => <RelationshipsContent {...props}/> });
const ActionGroup = defineComponent({ name: 'ActionGroup', description: 'Explicit publisher-registered destinations only.', props: componentProps(), component: ({ props }) => <ActionsContent {...props}/> });
function PhotoGalleryContent({ props }: { props: ComponentProps }) {
  const { onMediaFocusChange } = useCatalog();
  return <MediaGallery assetIds={props.assetIds.length ? props.assetIds : undefined} albumId={props.albumId || undefined} entityIds={props.entityIds.length ? props.entityIds : undefined} variant={props.variant === 'list' ? 'list' : 'grid'} showAlbums={!props.assetIds.length && !props.entityIds.length} onFocusChange={onMediaFocusChange}/>;
}
const PhotoGallery = defineComponent({ name: 'PhotoGallery', description: 'Published photos in publisher order, filtered only by approved references.', props: componentProps(), component: ({ props }) => <PhotoGalleryContent props={props}/> });
const CatalogCanvas = defineComponent({ name: 'CatalogCanvas', description: 'A stable semantic composition with shared platform motion.',
  props: z.object({ sections: z.array(z.union([CollectionView.ref, EntityDetail.ref, AttributeComparison.ref, SelectionTray.ref, RelatedEntities.ref, ActionGroup.ref, PhotoGallery.ref])) }),
  component: function Canvas({ props, renderNode }) {
    const { plan } = useCatalog();
    const workspace = ['workspace-shift', 'restore', 'focus'].includes(plan.transition.type);
    return <MotionHeight className="platform-canvas-frame" duration={workspace ? motionTiming.workspace : motionTiming.reflow}>
      <div className="platform-canvas" data-operation={plan.operation} data-has-criteria={false} data-has-collection={plan.components.some(component => component.type === 'collection')}><AnimatePresence initial={false} mode="popLayout">{props.sections.map(section => {
      const node = section as ElementNode;
      const statement = node.statementId ?? node.typeName;
      const componentIndex = /^object_(\d+)$/.exec(statement)?.[1];
      const name = plan.identityMode && componentIndex !== undefined ? plan.components[Number(componentIndex)]?.id ?? statement : statement;
      const entity = node.typeName === 'EntityDetail' ? String((node.props.entityIds as string[])[0]) : '';
      const intent = !plan.transition.targetComponentId || plan.transition.targetComponentId === name ? plan.transition.type : 'none';
      return <SemanticSurface key={`${name}${entity ? `-${entity}` : ''}`} name={name} intent={intent}>{renderNode(section)}</SemanticSurface>;
    })}</AnimatePresence></div></MotionHeight>;
  },
});

export const platformLibrary = createLibrary({ id: 'platform-ui-v1', root: 'CatalogCanvas', components: [CatalogCanvas, CollectionView, EntityDetail, AttributeComparison, SelectionTray, RelatedEntities, ActionGroup, PhotoGallery] });
