import { z } from 'zod';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const line = z.number().int().min(1).max(60_001);
export const MAX_SOURCE_EXCERPT = 1600;
export const MAX_SOURCE_PROVENANCE_BYTES = 400_000;

export const sourceAnchorSchema = z.object({
  id, format: z.enum(['csv', 'text', 'pdf']), label: z.string().min(1).max(160),
  excerpt: z.string().min(1).max(MAX_SOURCE_EXCERPT), truncated: z.boolean().optional(), row: line.optional(),
  lineStart: line.optional(), lineEnd: line.optional(),
  pageStart: z.number().int().min(1).max(40).optional(), pageEnd: z.number().int().min(1).max(40).optional(),
}).strict().superRefine((anchor, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if ((anchor.lineStart === undefined) !== (anchor.lineEnd === undefined) || (anchor.pageStart === undefined) !== (anchor.pageEnd === undefined)) issue('Source locations need both range endpoints.');
  if (anchor.lineStart !== undefined && anchor.lineEnd! < anchor.lineStart || anchor.pageStart !== undefined && anchor.pageEnd! < anchor.pageStart) issue('Source location ranges must be ordered.');
  if (anchor.format === 'csv' && (anchor.row === undefined || anchor.lineStart === undefined)) issue('CSV anchors need a record and physical line range.');
  if (anchor.format === 'text' && anchor.lineStart === undefined) issue('Text anchors need a line range.');
  if (anchor.format !== 'csv' && anchor.row !== undefined || anchor.format === 'pdf' && anchor.lineStart !== undefined || anchor.format !== 'pdf' && anchor.pageStart !== undefined) issue('Source locations must match their format.');
  // Legacy PDF extraction may lack a page map. An unlocated excerpt is honest;
  // a guessed page number is not. New extraction always supplies page ranges.
});

export const sourceFieldReferenceSchema = z.object({
  entityId: id,
  field: z.string().regex(/^(?:name|kind|summary|attributes\.[A-Za-z0-9][A-Za-z0-9_-]{0,79})$/),
  anchorIds: z.array(id).min(1).max(8),
}).strict();

export const sourceProvenanceSchema = z.object({
  anchors: z.array(sourceAnchorSchema).max(200), fields: z.array(sourceFieldReferenceSchema).max(2700),
}).strict().superRefine((provenance, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const anchors = new Map(provenance.anchors.map(anchor => [anchor.id, anchor]));
  if (anchors.size !== provenance.anchors.length) issue('Source anchor IDs must be unique.');
  const fields = new Set<string>();
  for (const reference of provenance.fields) {
    const key = `${reference.entityId}:${reference.field}`;
    if (fields.has(key)) issue('Each source field has one reference entry.');
    fields.add(key);
    if (new Set(reference.anchorIds).size !== reference.anchorIds.length || reference.anchorIds.some(id => !anchors.has(id))) issue('Source fields must reference distinct known anchors.');
    if (reference.anchorIds.some(id => anchors.get(id)?.truncated)) issue('Field references require complete source excerpts.');
  }
  if (new TextEncoder().encode(JSON.stringify(provenance)).length > MAX_SOURCE_PROVENANCE_BYTES) issue('Source provenance exceeds the private artifact limit. Split the source; nothing was truncated.');
});

export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
export type SourceFieldReference = z.infer<typeof sourceFieldReferenceSchema>;
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;

export function validateSourceProvenance(input: unknown, catalog?: KnowledgeCatalog): SourceProvenance {
  const provenance = sourceProvenanceSchema.parse(input);
  if (catalog) {
    const entities = new Map(catalog.entities.map(entity => [entity.id, entity]));
    const attributes = new Set(catalog.attributes.map(attribute => attribute.id));
    for (const reference of provenance.fields) {
      const entity = entities.get(reference.entityId);
      const attribute = reference.field.startsWith('attributes.') ? reference.field.slice(11) : null;
      if (!entity || attribute !== null && (!attributes.has(attribute) || !Object.hasOwn(entity.attributes, attribute))) {
        throw new z.ZodError([{ code: 'custom', path: ['fields'], message: 'Source references must belong to this catalog and its fields.' }]);
      }
    }
  }
  return provenance;
}
