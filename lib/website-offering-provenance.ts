import { createHash } from 'node:crypto';
import type { AttributeDefinition, CatalogEntity, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';
import type { ExtractedWebsitePage } from './website-import';
import type { WebsiteOfferingEvidence } from './website-structure';
import { MAX_SOURCE_EXCERPT, validateSourceProvenance, type SourceAnchor, type SourceProvenance } from './source-provenance';

type OfferingExtraction = { entities: CatalogEntity[]; attributes: AttributeDefinition[]; evidence: WebsiteOfferingEvidence[] };
const invalidEvidence = () => new AppError('A structured website offering does not match its captured source evidence. Nothing was applied.', 422);

/** Bind parser-owned values to exact captured locations, without approving any assertion. */
export function bindWebsiteOfferingProvenance(catalog: KnowledgeCatalog, provenance: SourceProvenance,
  pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[], extracted: OfferingExtraction): SourceProvenance {
  const sources = new Map<string, string>();
  for (const page of pages) {
    if (sources.has(page.url) && sources.get(page.url) !== page.text) throw invalidEvidence();
    sources.set(page.url, page.text);
  }
  const anchors = new Map(provenance.anchors.map(anchor => [anchor.id, anchor]));
  const fields = new Map(provenance.fields.map(reference => [`${reference.entityId}:${reference.field}`, { ...reference, anchorIds: [...reference.anchorIds] }]));
  const removeParserReference = (key: string) => {
    const reference = fields.get(key); if (!reference) return;
    const anchorIds = reference.anchorIds.filter(id => !id.startsWith('website-offering-'));
    if (anchorIds.length) fields.set(key, { ...reference, anchorIds }); else fields.delete(key);
  };
  const entities = new Map(catalog.entities.map(entity => [entity.id, entity]));
  const originals = new Map(extracted.entities.map(entity => [entity.id, entity]));
  for (const item of extracted.evidence) {
    const entity = entities.get(item.entityId), original = originals.get(item.entityId);
    if (!original) throw invalidEvidence();
    if (!entity) continue; // A differently identified model item cannot inherit these references.
    const text = sources.get(item.pageUrl);
    if (text === undefined) throw invalidEvidence();
    const lines = text.split('\n');
    for (const field of item.fields) {
      const key = `${entity.id}:${field.field}`;
      const attribute = field.field.startsWith('attributes.') ? field.field.slice(11) : undefined;
      if (field.field !== 'name' && !attribute) throw invalidEvidence();
      if (attribute) {
        const expected = extracted.attributes.find(definition => definition.id === attribute);
        const actual = catalog.attributes.find(definition => definition.id === attribute);
        if (!expected || !Object.hasOwn(original.attributes, attribute)) throw invalidEvidence();
        if (!actual || ['type', 'unit', 'currency'].some(key => actual[key as keyof AttributeDefinition] !== expected[key as keyof AttributeDefinition])) { removeParserReference(key); continue; }
      }
      const value = attribute ? entity.attributes[attribute] : entity.name;
      const sourceValue = attribute ? original.attributes[attribute] : original.name;
      if (JSON.stringify(value) !== JSON.stringify(sourceValue)) { removeParserReference(key); continue; }
      if (!Number.isInteger(field.lineStart) || !Number.isInteger(field.lineEnd) || field.lineStart < 1 || field.lineEnd < field.lineStart
        || field.lineEnd > lines.length || !field.excerpt || lines.slice(field.lineStart - 1, field.lineEnd).join('\n') !== field.excerpt) throw invalidEvidence();
      const baseOffset = lines.slice(0, field.lineStart - 1).reduce((offset, line) => offset + line.length + 1, 0);
      const anchorIds: string[] = [];
      for (let start = 0; start < field.excerpt.length;) {
        let end = Math.min(start + MAX_SOURCE_EXCERPT, field.excerpt.length);
        if (end < field.excerpt.length && /[\uD800-\uDBFF]/.test(field.excerpt[end - 1])) end--;
        const excerpt = field.excerpt.slice(start, end), characterStart = baseOffset + start, characterEnd = baseOffset + end;
        const lineStart = field.lineStart + (field.excerpt.slice(0, start).match(/\n/g)?.length ?? 0);
        const id = `website-offering-${createHash('sha256').update(JSON.stringify([item.pageUrl, characterStart, characterEnd, excerpt])).digest('hex').slice(0, 24)}`;
        const anchor: SourceAnchor = { id, format: 'html', label: `${item.pageUrl.slice(0, 125)} · lines ${lineStart}–${lineStart + (excerpt.match(/\n/g)?.length ?? 0)}`,
          excerpt, lineStart, lineEnd: lineStart + (excerpt.match(/\n/g)?.length ?? 0), characterStart, characterEnd };
        if (anchors.has(id) && JSON.stringify(anchors.get(id)) !== JSON.stringify(anchor)) throw invalidEvidence();
        anchors.set(id, anchor); anchorIds.push(id); start = end;
      }
      const previous = fields.get(key);
      const combined = [...new Set([...(previous?.anchorIds ?? []), ...anchorIds])];
      if (combined.length > 8) throw new AppError('A structured website field exceeds the source evidence limit. Split or review the source; nothing was truncated.', 422);
      fields.set(key, { entityId: entity.id, field: field.field, anchorIds: combined });
    }
  }
  return validateSourceProvenance({ ...provenance, anchors: [...anchors.values()], fields: [...fields.values()] }, catalog);
}
