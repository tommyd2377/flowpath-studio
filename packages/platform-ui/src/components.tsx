'use client';

import { createContext, forwardRef, useContext, useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { z } from 'zod';
import { createLibrary, defineComponent, useTriggerAction, type ElementNode } from './openui.js';
import { formatAttribute, filterEntities, filterOperatorLabel, knownAttributes, usefulAttributes } from './catalog.js';
import type { AttributeDefinition, KnowledgeCatalog, PresentationPlan } from './contracts.js';
import type { CatalogInteractionState } from './interaction.js';
import { Disclosure, MotionHeight, SemanticSurface, motionTiming, revealTransition, surfaceTransition } from './motion.js';
import { EntityMedia, MediaGallery } from './MediaViews.js';

export type RuntimeContextValue = { catalog: KnowledgeCatalog; state: CatalogInteractionState; plan: PresentationPlan;
  onLinkClick?: (event: { kind: 'link_click'; entityId?: string; capabilityId: string }) => void;
  onInteraction?: () => void;
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
  return <motion.article {...props} ref={ref} layout={!reduced} whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: 0.995 }} style={{ ...props.style, borderRadius: 13 }} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, transition: { ...revealTransition, duration: reduced ? 0 : motionTiming.exit } }}
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
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reveal, layout: reduced ? { duration: 0 } : surfaceTransition }}/>;
});

function CollectionContent({ entityIds, attributeIds, variant, collectionId }: ComponentProps) {
  const { catalog, state, onInteraction } = useCatalog();
  const action = useAction();
  const [limit, setLimit] = useState(12);
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
      <button type="button" aria-pressed={!collectionId} onClick={() => { setLimit(12); action('collection', { id: '' }); }}>All items</button>
      {collectionTabs.map(item => <button type="button" key={item.id} aria-pressed={item.id === collectionId} onClick={() => { setLimit(12); action('collection', { id: item.id }); }}>{item.name}</button>)}
    </div>}
    <MotionHeight><div className="platform-items" data-variant={variant}>
      <AnimatePresence initial={false} mode="popLayout">
      {!entities.length && <PresentCard key="empty" className="platform-empty"><Icon name="filter" size={26}/><h4>A little too specific.</h4><p>No published items match these filters. Change a criterion to open up the possibilities.</p><button className="platform-button" type="button" onClick={() => action('clear-filters')}>Clear filters</button></PresentCard>}
      {entities.slice(0, limit).map((entity, index) => {
        const selected = state.selectedIds.includes(entity.id);
        const selectDisabled = !selected && state.selectedIds.length >= 6;
        const details = cardAttributes(catalog, entity, attributes);
        const layout = variant !== 'list' && index === 0 ? 'feature' : details.length === 0 ? 'narrative' : details.length === 1 ? 'spotlight' : 'details';
        return <PresentCard key={`item-${entity.id}`} className="platform-item" data-entity-id={entity.id} data-selected={selected} data-detail-count={details.length} data-layout={layout}>
          <EntityMedia targetId={entity.id}/>
          <div className="platform-item-kicker"><span>{entity.kind}</span><span>{String(index + 1).padStart(2, '0')}</span></div>
          <button className="platform-item-open" type="button" onClick={() => action('focus', { id: entity.id })}><h4>{entity.name}</h4><Icon name="arrow"/></button>
          <p className="platform-item-summary">{entity.summary}</p>
          {!!details.length && <dl className="platform-item-attributes">{details.map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}</dl>}
          <div className="platform-item-bottom"><button className="platform-text-button" type="button" onClick={() => action('focus', { id: entity.id })}>Take a closer look <Icon name="arrow" size={13}/></button>
            <button className="platform-select" type="button" aria-pressed={selected} disabled={selectDisabled} aria-label={`${selected ? 'Remove' : 'Select'} ${entity.name} ${selected ? 'from' : 'for'} comparison`} onClick={() => action('select', { id: entity.id })}><Icon name={selected ? 'check' : 'plus'} size={15}/><span>{selected ? 'Selected' : 'Compare'}</span></button></div>
        </PresentCard>;
      })}</AnimatePresence>
    </div></MotionHeight>
    {entities.length > limit && <button className="platform-button platform-load-more" type="button" onClick={() => { onInteraction?.(); setLimit(value => value + 12); }}>Show more <span>{entities.length - limit} remaining</span></button>}
  </section>;
}

function Criterion({ attribute }: { attribute: AttributeDefinition }) {
  const { catalog, state } = useCatalog();
  const action = useAction();
  const filter = state.filters.find(item => item.attributeId === attribute.id);
  const id = useId();
  if (attribute.type === 'money' || attribute.type === 'number') return <div className="platform-criterion">
    <label htmlFor={id}>{attribute.label}<span>{attribute.currency || attribute.unit || 'Maximum'}</span></label>
    <div className="platform-number"><span>{filterOperatorLabel(filter?.operator ?? 'lte', attribute.type)}</span><input id={id} type="number" step="any" inputMode="decimal" placeholder="Any amount" value={typeof filter?.value === 'number' ? filter.value : ''}
      onChange={event => action('filter', { attributeId: attribute.id, operator: filter?.operator ?? 'lte', value: event.target.value === '' ? null : Number(event.target.value) })}/></div>
  </div>;
  if (attribute.type === 'date') return <div className="platform-criterion"><label htmlFor={id}>{attribute.label}<span>{filterOperatorLabel(filter?.operator ?? 'gte', attribute.type)}</span></label><input className="platform-date" id={id} type="date" value={typeof filter?.value === 'string' ? filter.value : ''} onChange={event => action('filter', { attributeId: attribute.id, operator: filter?.operator ?? 'gte', value: event.target.value || null })}/></div>;
  if (attribute.type === 'boolean') return <div className="platform-criterion"><label htmlFor={id}>{attribute.label}</label><select id={id} value={filter ? String(filter.value) : ''} onChange={event => action('filter', { attributeId: attribute.id, operator: 'eq', value: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></div>;
  const values = [...new Set(catalog.entities.flatMap(entity => typeof entity.attributes[attribute.id] === 'string' ? [entity.attributes[attribute.id] as string] : []))];
  if (filter?.operator === 'contains') return <div className="platform-criterion"><label htmlFor={id}>{attribute.label}<span>Contains</span></label><input className="platform-date" id={id} type="text" value={typeof filter.value === 'string' ? filter.value : ''} onChange={event => action('filter', { attributeId: attribute.id, operator: 'contains', value: event.target.value || null })}/></div>;
  return <div className="platform-criterion"><label htmlFor={id}>{attribute.label}</label><select id={id} value={typeof filter?.value === 'string' ? filter.value : ''} onChange={event => action('filter', { attributeId: attribute.id, operator: 'eq', value: event.target.value || null })}><option value="">Any {attribute.label.toLocaleLowerCase()}</option>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></div>;
}

function CriteriaContent({ attributeIds, variant }: ComponentProps) {
  const { catalog, state, onInteraction } = useCatalog();
  const action = useAction();
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(variant === 'expanded');
  const [previousVariant, setPreviousVariant] = useState(variant);
  if (previousVariant !== variant) { setPreviousVariant(variant); setExpanded(variant === 'expanded'); }
  const attributes = usefulAttributes(catalog, definitions(catalog, attributeIds));
  return <motion.section layout={!reduced} style={{ borderRadius: 12 }} transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }} className="platform-criteria" aria-label="Refine the collection"><motion.div layout={reduced ? false : 'position'} transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }}>
    <SectionHeading eyebrow="WHAT MATTERS TO YOU" title="Find your fit"><Icon name="filter"/></SectionHeading>
    {!!state.filters.length && <ul className="platform-active-filters" aria-label="Active filters">{state.filters.map((filter, index) => {
      const attribute = catalog.attributes.find(item => item.id === filter.attributeId)!;
      return <li key={index}>{attribute.label}: {filter.value === null ? 'Not provided' : `${filterOperatorLabel(filter.operator, attribute.type)} ${formatAttribute(filter.value, attribute)}`}</li>;
    })}</ul>}
    <div className="platform-criteria-fields">{attributes.slice(0, 4).map(attribute => <Criterion key={attribute.id} attribute={attribute}/>)}</div>
    <AnimatePresence initial={false}>{expanded && attributes.length > 4 && <Disclosure key="extra-criteria" name="criteria"><div className="platform-criteria-fields platform-extra-criteria">{attributes.slice(4).map(attribute => <Criterion key={attribute.id} attribute={attribute}/>)}</div></Disclosure>}</AnimatePresence>
    <div className="platform-criteria-bottom">{attributes.length > 4 && <button className="platform-text-button" type="button" aria-expanded={expanded} onClick={() => { onInteraction?.(); setExpanded(value => !value); }}>{expanded ? 'Fewer filters' : `All ${attributes.length} filters`}</button>}{state.filters.length > 0 && <button className="platform-text-button" type="button" onClick={() => action('clear-filters')}>Clear filters <Icon name="close" size={12}/></button>}</div>
  </motion.div></motion.section>;
}

function DetailContent({ entityIds, attributeIds }: ComponentProps) {
  const { catalog, state } = useCatalog();
  const action = useAction();
  const entity = catalog.entities.find(item => item.id === entityIds[0])!;
  const selected = state.selectedIds.includes(entity.id);
  const details = knownAttributes(entity, definitions(catalog, attributeIds));
  return <section className="platform-detail" data-entity-id={entity.id} aria-label={`Details of ${entity.name}`}>
    <span className="platform-eyebrow">{entity.kind} · A CLOSER LOOK</span><h3 tabIndex={-1} data-platform-focus>{entity.name}</h3><p className="platform-detail-summary">{entity.summary}</p>
    <EntityMedia targetId={entity.id} variant="detail" includeExamples/>
    {!!details.length && <dl className="platform-detail-attributes">{details.map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}</dl>}
    <button className="platform-button" type="button" aria-pressed={selected} disabled={!selected && state.selectedIds.length >= 6} onClick={() => action('select', { id: entity.id })}><Icon name={selected ? 'check' : 'plus'}/>{selected ? 'Selected for comparison' : 'Add to comparison'}</button>
  </section>;
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
const CriteriaControls = defineComponent({ name: 'CriteriaControls', description: 'Exact typed filters; changes update visitor state without a model request.', props: componentProps(), component: ({ props }) => <CriteriaContent {...props}/> });
const EntityDetail = defineComponent({ name: 'EntityDetail', description: 'A published entity and its known attributes.', props: componentProps(), component: ({ props }) => <DetailContent {...props}/> });
const AttributeComparison = defineComponent({ name: 'AttributeComparison', description: 'Compare identical attribute definitions across published entities.', props: componentProps(), component: ({ props }) => <ComparisonContent {...props}/> });
const SelectionTray = defineComponent({ name: 'SelectionTray', description: 'Runtime-owned comparison selections.', props: componentProps(), component: () => <SelectionContent/> });
const RelatedEntities = defineComponent({ name: 'RelatedEntities', description: 'Explicit relationships between published entities.', props: componentProps(), component: ({ props }) => <RelationshipsContent {...props}/> });
const ActionGroup = defineComponent({ name: 'ActionGroup', description: 'Explicit publisher-registered destinations only.', props: componentProps(), component: ({ props }) => <ActionsContent {...props}/> });
const PhotoGallery = defineComponent({ name: 'PhotoGallery', description: 'Published photos in publisher order, filtered only by approved references.', props: componentProps(), component: ({ props }) => <MediaGallery assetIds={props.assetIds.length ? props.assetIds : undefined} albumId={props.albumId || undefined} entityIds={props.entityIds.length ? props.entityIds : undefined} variant={props.variant === 'list' ? 'list' : 'grid'} showAlbums={!props.assetIds.length && !props.entityIds.length}/> });
const CatalogCanvas = defineComponent({ name: 'CatalogCanvas', description: 'A stable semantic composition with shared platform motion.',
  props: z.object({ sections: z.array(z.union([CollectionView.ref, CriteriaControls.ref, EntityDetail.ref, AttributeComparison.ref, SelectionTray.ref, RelatedEntities.ref, ActionGroup.ref, PhotoGallery.ref])) }),
  component: function Canvas({ props, renderNode }) {
    const { plan } = useCatalog();
    const workspace = ['workspace-shift', 'restore', 'focus'].includes(plan.transition.type);
    return <MotionHeight className="platform-canvas-frame" duration={workspace ? motionTiming.workspace : motionTiming.reflow}>
      <div className="platform-canvas" data-operation={plan.operation} data-has-criteria={plan.components.some(component => component.type === 'criteria')} data-has-collection={plan.components.some(component => component.type === 'collection')}><AnimatePresence initial={false} mode="popLayout">{props.sections.map(section => {
      const node = section as ElementNode;
      const name = node.statementId ?? node.typeName;
      const entity = node.typeName === 'EntityDetail' ? String((node.props.entityIds as string[])[0]) : '';
      const intent = !plan.transition.targetComponentId || plan.transition.targetComponentId === name ? plan.transition.type : 'none';
      return <SemanticSurface key={`${name}${entity ? `-${entity}` : ''}`} name={name} intent={intent}>{renderNode(section)}</SemanticSurface>;
    })}</AnimatePresence></div></MotionHeight>;
  },
});

export const platformLibrary = createLibrary({ id: 'platform-ui-v1', root: 'CatalogCanvas', components: [CatalogCanvas, CollectionView, CriteriaControls, EntityDetail, AttributeComparison, SelectionTray, RelatedEntities, ActionGroup, PhotoGallery] });
