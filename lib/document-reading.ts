import { createHash } from 'node:crypto';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { ExtractedSource } from './source-extractors';

/** Preserve a prose document as one reviewable reading section, alongside its graph.
 * This is extracted source text, never generated facts, executable markup or media. */
export function withDocumentReading(catalog: KnowledgeCatalog, source: ExtractedSource): KnowledgeCatalog {
  if (!['pdf', 'docx', 'text', 'ocr'].includes(source.format) || !source.text.trim()) return catalog;
  const key = `document-${createHash('sha256').update(source.text).digest('hex').slice(0, 24)}`;
  if (catalog.entities.some(entity => entity.id === key)) return catalog;
  // Shared limits must fail visibly, never silently drop existing semantic records.
  const blocks = [];
  let remaining = source.text;
  while (remaining.length) {
    let end = Math.min(8000, remaining.length);
    if (end < remaining.length) {
      const boundary = remaining.lastIndexOf('\n', end - 1);
      if (boundary > end / 2) end = boundary + 1;
    }
    blocks.push({ id: `text-${blocks.length + 1}`, kind: 'paragraph' as const, text: remaining.slice(0, end) });
    remaining = remaining.slice(end);
  }
  return validateCatalog({ ...catalog, entities: [...catalog.entities, {
    id: key, name: `Read: ${catalog.name}`.slice(0, 160), kind: 'document', summary: 'Read the extracted document text. Images and the original page layout are not included.', attributes: {}, blocks,
  }] });
}
