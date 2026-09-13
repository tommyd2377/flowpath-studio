import { validatePlan, type CatalogFilter, type KnowledgeCatalog, type PresentationComponent, type PresentationPlan } from './contracts.js';
import { defaultPresentation, filterEntities, knownAttributes } from './catalog.js';
import { galleryAssetIds, type MediaLibrary } from './media.js';

export type FocusReference = { kind: 'entity' | 'photo'; id: string };
export type ReturnAnchor = {
  reference: FocusReference;
  surface: 'collection' | 'gallery';
  focusKey: string;
  scrollTop: number;
};

export type CatalogInteractionState = {
  snapshotId: string;
  filters: CatalogFilter[];
  selectedIds: string[];
  focusedId: string | null;
  focusedRef: FocusReference | null;
  focusOrigin: ReturnAnchor | null;
  entityIds: string[];
};

export function initialInteraction(catalog: KnowledgeCatalog, snapshotId = catalog.id): CatalogInteractionState {
  return { snapshotId, filters: [], selectedIds: [], focusedId: null, focusedRef: null, focusOrigin: null, entityIds: catalog.entities.map(entity => entity.id) };
}

/** Apply an already validated plan's explicit filters once; omitted updates preserve them. */
export function applyPresentationState(state: CatalogInteractionState, plan: PresentationPlan): CatalogInteractionState {
  return plan.stateUpdate ? { ...state, filters: plan.stateUpdate.filters } : state;
}

/** Replace this bound/equality while keeping an opposite bound and unrelated criteria. */
export function replaceCatalogFilter(filters: CatalogFilter[], filter: CatalogFilter): CatalogFilter[] {
  const upper = ['lt', 'lte']; const lower = ['gt', 'gte'];
  const replaced = upper.includes(filter.operator) ? [...upper, 'eq'] : lower.includes(filter.operator) ? [...lower, 'eq'] : ['eq', 'contains', ...upper, ...lower];
  return [...filters.filter(current => current.attributeId !== filter.attributeId || !replaced.includes(current.operator)), filter];
}

export function entityIdsForComponent(catalog: KnowledgeCatalog, component: PresentationComponent): string[] {
  if (component.entityIds.length) return component.entityIds;
  if (component.collectionId) return catalog.collections.find(collection => collection.id === component.collectionId)?.entityIds ?? [];
  return catalog.entities.map(entity => entity.id);
}

export function detailPlan(catalog: KnowledgeCatalog, id: string, snapshotId = catalog.id): PresentationPlan {
  const related = catalog.relationships.filter(relation => relation.fromEntityId === id || relation.toEntityId === id);
  const capabilities = (catalog.capabilities ?? []).filter(action => !action.entityIds.length || action.entityIds.includes(id));
  const components: PresentationComponent[] = [
    { id: 'detail', type: 'detail', variant: 'expanded', entityIds: [id], attributeIds: catalog.attributes.map(attribute => attribute.id) },
    { id: 'selection', type: 'selection', variant: 'compact', entityIds: [], attributeIds: [] },
  ];
  if (related.length) components.push({ id: 'relationships', type: 'relationships', variant: 'list', entityIds: [id], attributeIds: [] });
  if (capabilities.length) components.push({ id: 'actions', type: 'actions', variant: 'compact', entityIds: [id], attributeIds: [], capabilityIds: capabilities.map(action => action.id) });
  return validatePlan({ schemaVersion: 1, snapshotId, operation: 'understand', components, transition: { type: 'focus', targetComponentId: 'detail' } }, catalog, snapshotId);
}

export function comparisonPlan(catalog: KnowledgeCatalog, ids: string[], snapshotId = catalog.id): PresentationPlan {
  const entities = catalog.entities.filter(entity => ids.includes(entity.id));
  const coverage = (attribute: KnowledgeCatalog['attributes'][number]) => entities.filter(entity => knownAttributes(entity, [attribute]).length).length;
  const attributes = catalog.attributes.filter(attribute => coverage(attribute) > 0).sort((a, b) => coverage(b) - coverage(a));
  return validatePlan({ schemaVersion: 1, snapshotId, operation: 'compare', components: [
    { id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: [...new Set(ids)].slice(0, 6), attributeIds: attributes.map(attribute => attribute.id) },
    { id: 'selection', type: 'selection', variant: 'compact', entityIds: [], attributeIds: [] },
  ], transition: { type: 'workspace-shift', targetComponentId: 'comparison' } }, catalog, snapshotId);
}

/** Fixture/demo planning is deterministic. It never calls a provider or invents attributes. */
export function planForIntent(catalog: KnowledgeCatalog, text: string, state = initialInteraction(catalog), media?: MediaLibrary | null): PresentationPlan {
  const query = text.trim().toLocaleLowerCase();
  const snapshotId = state.snapshotId;
  const photos = galleryPlanForIntent(catalog, text, state, media);
  if (photos) return photos;
  if (!query) return defaultPresentation(catalog, snapshotId);
  if (/^(all(?: items)?|everything|browse(?: all)?|start over|reset|show (?:me )?all(?: items)?)[.!?]*$/.test(query)) {
    return validatePlan({ ...defaultPresentation(catalog, snapshotId), stateUpdate: { filters: [] }, transition: { type: 'replace', targetComponentId: 'collection' } }, catalog, snapshotId);
  }
  const job = catalog.jobs.find(item => item.label.toLocaleLowerCase() === query);
  if (job && !/\bcompare\b/.test(query)) {
    const next = defaultPresentation(catalog, snapshotId);
    next.components = next.components.map(component => component.type === 'collection' ? { ...component, attributeIds: job.attributeIds.length ? job.attributeIds : component.attributeIds } : component);
    next.transition = { type: 'focus', targetComponentId: 'collection' };
    return validatePlan(next, catalog, snapshotId);
  }
  let constraints: CatalogFilter[] = [...state.filters];
  let changedFilters = false;
  const replaceConstraint = (filter: CatalogFilter) => {
    constraints = replaceCatalogFilter(constraints, filter);
    changedFilters = true;
  };
  const withFilters = (plan: PresentationPlan) => validatePlan({ ...plan, ...(changedFilters ? { stateUpdate: { filters: constraints } } : {}) }, catalog, snapshotId);
  const bound = query.match(/(?:under|below|less than|up to|at most|over|above|at least)\s*[$€£]?\s*(\d+(?:\.\d+)?)/);
  if (bound) {
    const numbers = catalog.attributes.filter(attribute => attribute.type === 'money' || attribute.type === 'number');
    const attribute = numbers.find(item => query.includes(item.label.toLocaleLowerCase())) ?? numbers.find(item => item.type === 'money') ?? numbers[0];
    if (attribute) replaceConstraint({ attributeId: attribute.id, operator: /^(over|above)/.test(bound[0]) ? 'gt' : /^at least/.test(bound[0]) ? 'gte' : /^(under|below|less than)/.test(bound[0]) ? 'lt' : 'lte', value: Number(bound[1]) });
  }
  for (const attribute of catalog.attributes.filter(item => item.type === 'text')) {
    const values = [...new Set(catalog.entities.map(entity => entity.attributes[attribute.id]).filter((value): value is string => typeof value === 'string'))];
    const exact = values.find(value => value.length > 2 && query.includes(value.toLocaleLowerCase()));
    if (exact) replaceConstraint({ attributeId: attribute.id, operator: 'eq', value: exact });
  }
  let candidates = filterEntities(catalog, constraints);
  const named = candidates.filter(entity => query.includes(entity.name.toLocaleLowerCase()));
  const ordinal = query.match(/\b(first|second|third|fourth|fifth|sixth)\b/);
  if (ordinal) {
    const id = state.entityIds[['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].indexOf(ordinal[1])];
    if (id && catalog.entities.some(entity => entity.id === id)) return withFilters(detailPlan(catalog, id, snapshotId));
  }
  if (/\b(compare|comparison|versus|vs)\b|side by side/.test(query)) {
    const ids = named.length >= 2 ? named.map(entity => entity.id) : state.selectedIds.length >= 2 ? state.selectedIds : candidates.slice(0, 3).map(entity => entity.id);
    if (ids.length < 2) throw new Error('Choose at least two published items to compare.');
    return withFilters(comparisonPlan(catalog, ids, snapshotId));
  }
  if (named.length === 1) return withFilters(detailPlan(catalog, named[0].id, snapshotId));
  const collection = catalog.collections.find(item => query.includes(item.name.toLocaleLowerCase()));
  if (collection) candidates = candidates.filter(entity => collection.entityIds.includes(entity.id));
  const ignored = new Set(['show', 'find', 'want', 'looking', 'something', 'would', 'like', 'please', 'with', 'that', 'this', 'under', 'below', 'above', 'over', 'than', 'about', 'options', 'items', 'available', 'have', 'what', 'your', 'give', 'some', 'details']);
  const words = query.split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 3 && !ignored.has(word));
  if (!collection && !changedFilters && words.length) {
    const relevant = candidates.filter(entity => words.some(word => `${entity.name} ${entity.summary} ${Object.values(entity.attributes).join(' ')}`.toLocaleLowerCase().includes(word)));
    if (relevant.length) candidates = relevant;
    else throw new Error('I could not match that request to the published catalog. Try an item name or describe what matters to you.');
  }
  if (!candidates.length) throw new Error('No published items match those criteria. Your previous view is still available.');
  const plan = defaultPresentation(catalog, snapshotId);
  return withFilters({ ...plan, operation: 'narrow', components: plan.components.map(component => component.type === 'collection'
    ? { ...component, entityIds: candidates.map(entity => entity.id), variant: /\blist\b/.test(query) ? 'list' : 'grid' } : component), transition: { type: 'replace', targetComponentId: 'collection' } });
}

/** Resolve photo requests through publisher associations, never visual resemblance. */
export function galleryPlanForIntent(catalog: KnowledgeCatalog, text: string, state = initialInteraction(catalog), media?: MediaLibrary | null): PresentationPlan | null {
  const query = text.trim().toLocaleLowerCase();
  if (!/\b(photos?|pictures?|images?|albums?|gallery)\b/.test(query)) return null;
  if (!media?.assets.length) throw new Error('This publisher has not provided photos yet. Your previous view is still available.');
  const album = media.albums.find(item => query.includes(item.title.toLocaleLowerCase()));
  let entities = catalog.entities.filter(entity => query.includes(entity.name.toLocaleLowerCase())).map(entity => entity.id);
  const ordinal = query.match(/\b(first|second|third|fourth|fifth|sixth)\b/);
  const explicitEntity = /\b(items?|class(?:es)?|products?|people|persons?|places?|offerings?|books?|events?)\b/.test(query)
    || catalog.entities.some(entity => ` ${query.replace(/[^\p{L}\p{N}]+/gu, ' ')} `.includes(` ${entity.kind.toLocaleLowerCase()} `));
  if (ordinal && !explicitEntity && !album && !entities.length) throw new Error('Open a photo or name its album to choose a specific image. Photo numbers are not available in this view.');
  if (!entities.length && ordinal && !album) {
    const id = state.entityIds[['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].indexOf(ordinal[1])];
    if (id) entities = [id];
    else throw new Error('That item is not in the current view.');
  }
  if (!entities.length && !album && /\b(this|that|it)\b/.test(query) && state.focusedId) entities = [state.focusedId];
  if (!entities.length && !album && /\b(selected|shortlist|these)\b/.test(query)) entities = [...state.selectedIds];
  if (!entities.length && !album) {
    const ignored = new Set(['show', 'me', 'us', 'the', 'a', 'an', 'some', 'all', 'your', 'our', 'of', 'for', 'please', 'can', 'i', 'see', 'view', 'photos', 'photo', 'pictures', 'picture', 'images', 'image', 'albums', 'album', 'gallery']);
    const words = query.split(/[^\p{L}\p{N}]+/u).filter(word => word && !ignored.has(word));
    if (words.length) {
      entities = catalog.entities.filter(entity => words.every(word => `${entity.name} ${entity.kind}`.toLocaleLowerCase().includes(word.replace(/s$/, '')))).map(entity => entity.id);
      if (!entities.length) throw new Error('No published photos match that subject. Try an item or album name.');
    }
  }
  const component: PresentationComponent = { id: 'gallery', type: 'gallery', variant: 'grid', entityIds: entities, attributeIds: [], ...(album ? { albumId: album.id } : {}) };
  if (!galleryAssetIds(media, component).length) throw new Error('There are no published photos for that subject. Your previous view is still available.');
  return validatePlan({ schemaVersion: 1, snapshotId: state.snapshotId, operation: 'understand', components: [component], transition: { type: 'focus', targetComponentId: 'gallery' } }, catalog, state.snapshotId, media);
}
