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
