import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from './contracts.js';
import type { MediaLibrary } from './media.js';

export const COMPONENT_NAMES = {
  collection: 'CollectionView', detail: 'EntityDetail', comparison: 'AttributeComparison',
  selection: 'SelectionTray', relationships: 'RelatedEntities', actions: 'ActionGroup', gallery: 'PhotoGallery',
} as const;

function literal(value: unknown) {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Component names and statement identities come only from the registered vocabulary. */
export function compilePresentation(catalog: KnowledgeCatalog, value: PresentationPlan, snapshotId = catalog.id, media?: MediaLibrary | null): string {
  const plan = validatePlan(value, catalog, snapshotId, media);
  const components = plan.components.filter(component => component.type !== 'criteria');
  const statementId = (index: number) => plan.identityMode === 'instances' ? `object_${index}` : components[index].type;
  const definitions = components.map((component, index) => {
    if (component.type === 'criteria') throw new Error('Filter controls have been retired.');
    const args = [component.entityIds, component.attributeIds, component.variant, component.collectionId ?? '', component.capabilityIds ?? [], component.assetIds ?? [], component.albumId ?? ''];
    return `${statementId(index)} = ${COMPONENT_NAMES[component.type]}(${args.map(literal).join(', ')})`;
  });
  return `root = CatalogCanvas([${components.map((_, index) => statementId(index)).join(', ')}])\n${definitions.join('\n')}`;
}
