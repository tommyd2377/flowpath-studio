import { publicationSpaceSchema, type PublicationSpace } from '@thevoice/platform-ui/collection-space';
import { querySpecSchema, type Expression, type QuerySpec } from '@thevoice/platform-ui/query';

export const publisherVocabularies = [
  { name: 'Media archive', type: 'article', branch: 'topic', field: 'reading-minutes', tag: 'authors' },
  { name: 'Freelancer portfolio', type: 'project', branch: 'service', field: 'deliverable-count', tag: 'industries' },
  { name: 'Product catalog', type: 'product', branch: 'category', field: 'weight', tag: 'compatible-families' },
  { name: 'Travel guide', type: 'place', branch: 'county', field: 'visit-minutes', tag: 'accessibility' },
  { name: 'Class provider', type: 'course', branch: 'subject', field: 'level-number', tag: 'weekdays' },
  { name: 'Institution', type: 'resource', branch: 'department', field: 'edition', tag: 'disciplines' },
  { name: 'Unseen vocabulary', type: 'zephyrite', branch: 'xelth', field: 'lumens-of-qira', tag: 'velari' },
];
export function taskFixture(vocabulary = publisherVocabularies[0], count = 8): PublicationSpace {
  const { type, branch, field, tag } = vocabulary;
  return publicationSpaceSchema.parse({ version: 2, name: vocabulary.name, publication: { siteId: `site-${type}`, revisionId: 'publication-1', indexRevision: 'index-1' }, rootId: 'root',
    collections: [{ id: 'root', name: vocabulary.name, introduction: '', kind: 'group', view: 'grid' },
      { id: branch, name: branch, introduction: '', kind: 'explicit', view: 'grid' },
      { id: 'child', name: `${branch} child`, introduction: '', kind: 'explicit', view: 'list' },
      { id: 'cross', name: 'Cross-listed', introduction: '', kind: 'explicit', view: 'grid' }],
    edges: [{ parentId: 'root', childId: branch }, { parentId: branch, childId: 'child' }, { parentId: 'root', childId: 'cross' }],
    fields: [
      { id: field, label: field, type: 'number', cardinality: 'one', aliases: ['measure'], recordTypes: [type], unit: 'units', operations: ['eq', 'lt', 'lte', 'gt', 'gte'], filter: true, sort: true, facet: true, coverage: { known: count - 1, total: count } },
      { id: tag, label: tag, type: 'enum', cardinality: 'many', aliases: [], recordTypes: [type], operations: ['eq', 'any', 'all'], filter: true, sort: false, facet: true, coverage: { known: count, total: count } },
      { id: 'flag', label: 'Documented flag', type: 'boolean', cardinality: 'one', aliases: [], recordTypes: [type], operations: ['eq'], filter: true, sort: true, facet: true, coverage: { known: count - 1, total: count } },
    ],
    relationshipTypes: [{ id: 'relates', label: 'Relates to', inverseLabel: 'Related from', fromTypes: [type], toTypes: [type] }],
    records: Array.from({ length: count }, (_, i) => ({ id: `record-${String(i).padStart(5, '0')}`, name: `${type} ${i}`, type, summary: `Synthetic ${vocabulary.name} record ${i}.`, aliases: [], blocks: [],
      assertions: [
        { id: `amount-${i}`, fieldId: field, value: i === 2 ? null : { type: 'number', value: i, unit: 'units' }, polarity: 'affirmed', conditions: [], authority: 'publisher' },
        { id: `tags-${i}`, fieldId: tag, value: { type: 'enum', value: i % 2 ? ['alpha', 'beta'] : ['gamma'] }, polarity: 'affirmed', conditions: [], authority: 'publisher' },
        { id: `flag-${i}`, fieldId: 'flag', value: i === 2 ? null : { type: 'boolean', value: i % 2 === 0 }, polarity: 'affirmed', conditions: [], authority: 'publisher' },
      ] })),
    memberships: Array.from({ length: count }, (_, i) => ({ collectionId: i % 2 ? 'child' : branch, recordId: `record-${String(i).padStart(5, '0')}` })).concat([{ collectionId: 'cross', recordId: 'record-00000' }]),
    relationships: [{ id: 'edge', predicateId: 'relates', fromId: 'record-00000', toId: 'record-00001', polarity: 'affirmed', conditions: [] }],
  });
}
export function fixtureQuery(space: PublicationSpace, where: Expression = { kind: 'all', id: 'criteria', children: [] }): QuerySpec {
  return querySpecSchema.parse({ version: 2, publication: space.publication, queryId: 'query-1', revision: 0, scope: { collectionId: space.rootId, traversal: 'descendants', path: [space.rootId] }, where, preferences: [], order: [], asOf: '2026-09-13', timeZone: 'America/New_York' });
}

/** Cross-domain publication fixtures for website composition, with overlap and an unknown price. */
export function websiteTaskFixture(kind: 'products' | 'services', count = 40): PublicationSpace {
  const products = kind === 'products';
  const space = taskFixture({ name: products ? 'Celebration cakes' : 'Design services', type: products ? 'product' : 'service', branch: kind, field: products ? 'size' : 'duration', tag: products ? 'flavor' : 'format' }, count);
  const category = space.fields[1]; category.label = products ? 'Flavor' : 'Format'; category.cardinality = 'one'; category.operations = ['eq']; category.values = products ? ['chocolate', 'vanilla', 'lemon'] : ['remote', 'studio', 'hybrid'];
  const amount = space.fields[0]; amount.label = products ? 'Size' : 'Duration'; amount.unit = products ? 'cm' : 'minutes';
  space.fields.push({ id: 'price', label: 'Price', type: 'money', cardinality: 'one', aliases: ['cost'], recordTypes: [products ? 'product' : 'service'], currency: 'USD', basis: products ? 'item' : 'session', operations: ['eq', 'lt', 'lte', 'gt', 'gte'], filter: true, sort: true, facet: false, coverage: { known: count - 1, total: count } });
  space.records.forEach((record, i) => {
    const value = String(category.values![i % 3]); record.name = `${value[0].toUpperCase()}${value.slice(1)} ${products ? 'cake' : 'design session'} ${i}`;
    record.summary = `${products ? 'A celebration cake' : 'A design consultation'} with published options and measurements.`;
    record.assertions[0].value = { type: 'number', value: 10 + i, unit: amount.unit };
    record.assertions[1].value = { type: 'enum', value };
    record.assertions.push({ id: `price-${i}`, fieldId: 'price', value: i === 0 ? null : { type: 'money', value: 20 + i, currency: 'USD', basis: products ? 'item' : 'session' }, polarity: 'affirmed', conditions: [], authority: 'publisher' });
    record.blocks = [{ id: `description-${i}`, kind: 'paragraph', text: `Published detail for ${record.name}.` }];
  });
  return publicationSpaceSchema.parse(space);
}
