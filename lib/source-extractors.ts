import { createHash, randomUUID } from 'node:crypto';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCatalog, type KnowledgeCatalog, type AttributeDefinition } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';
import { MAX_SOURCE_EXCERPT, validateSourceProvenance, type SourceAnchor, type SourceProvenance } from './source-provenance';
import { extractDocxText, extractXlsx, htmlToText, type XlsxCell, type XlsxSheet } from './source-adapters';
import { extractOcrText, type OcrProvider } from './ocr';

export const MAX_EXTRACTED_CHARACTERS = 60_000;
export type ExtractedSource = {
  text: string; format: 'csv' | 'text' | 'pdf' | 'docx' | 'xlsx' | 'html' | 'ocr'; pages?: number;
  xlsxSheets?: XlsxSheet[];
  /** Offsets are into text; end is exclusive. Text is the actual PDF extraction, not the original page layout. */
  pageRanges?: { page: number; text: string; start: number; end: number }[];
};
const slug = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const excelColumn = (value: number) => { let result = ''; for (let n = Math.max(1, value); n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; };
const xlsxCellAnchorId = (sheet: string, ref: string) => `xlsx-${(slug(sheet) || 'sheet').slice(0, 34)}-${createHash('sha256').update(sheet).digest('hex').slice(0, 10)}-cell-${ref.toLowerCase()}`;

type CsvRecord = { cells: string[]; row: number; lineStart: number; lineEnd: number; excerpt: string };
function csvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
  const source = text.replace(/^\uFEFF/, '');
  let physicalLine = 1; let lineStart = 1; let recordNumber = 1; let start = 0;
  const finish = (end: number) => {
    row.push(cell.trim()); cell = ''; closed = false;
    if (row.some(Boolean)) records.push({ cells: row, row: recordNumber, lineStart, lineEnd: physicalLine, excerpt: source.slice(start, end) });
    row = []; recordNumber++;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else {
        cell += char;
        if (char === '\r') { if (source[i + 1] === '\n') { cell += '\n'; i++; } physicalLine++; }
        else if (char === '\n') physicalLine++;
      }
    } else if (char === '"') {
      if (cell || closed) throw new AppError('CSV contains a misplaced quotation mark.');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      if (char === ',') { row.push(cell.trim()); cell = ''; closed = false; }
      else {
        finish(i);
        if (char === '\r' && source[i + 1] === '\n') i++;
        physicalLine++; lineStart = physicalLine; start = i + 1;
      }
    } else {
      if (closed && char.trim()) throw new AppError('CSV contains text after a quoted field.');
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new AppError('CSV contains an unfinished quoted field.');
  finish(source.length);
  const rows = records.map(record => record.cells);
  if (rows.length < 2 || rows.length > 101) throw new AppError('Use a CSV header and between 1 and 100 item rows. Larger files need to be split; nothing was truncated.');
  if (rows.some(row => row.length !== rows[0].length)) throw new AppError('Every CSV row must have the same number of columns.');
  return records;
}

export function parseCsv(text: string): string[][] { return csvRecords(text).map(record => record.cells); }

function catalogFromRows(name: string, rows: string[][]): KnowledgeCatalog {
  const headers = rows[0]; const normalized = headers.map(header => slug(header));
  if (new Set(normalized).size !== normalized.length || normalized.some(header => !header)) throw new AppError('Give each CSV column a unique, non-empty name.');
  const nameIndex = normalized.findIndex(header => header === 'name' || header === 'title');
  if (nameIndex < 0) throw new AppError('The catalog needs a Name or Title column.');
  const kindIndex = normalized.findIndex(header => header === 'kind' || header === 'category');
  const descriptionIndex = normalized.findIndex(header => header === 'summary' || header === 'description');
  const idIndex = normalized.indexOf('id');
  const indexes = normalized.map((_, index) => index).filter(index => ![nameIndex, kindIndex, descriptionIndex, idIndex].includes(index));
  if (indexes.length > 24) throw new AppError('Use at most 24 comparable attribute columns.');
  const definitions: AttributeDefinition[] = indexes.map(index => {
    const values = rows.slice(1).map(row => row[index]).filter(Boolean);
    const currency = headers[index].match(/\[([A-Z]{3})\]\s*$/)?.[1];
    const numeric = values.length > 0 && values.every(value => /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value));
    if (currency && values.length && !numeric) throw new AppError(`“${headers[index]}” must contain numeric amounts or blank cells.`);
    const type = currency ? 'money' : numeric ? 'number' : values.length && values.every(value => /^(true|false)$/i.test(value)) ? 'boolean'
      : values.length && values.every(value => /^\d{4}-\d{2}-\d{2}$/.test(value)) ? 'date' : 'text';
    return { id: normalized[index], label: headers[index], type, ...(currency ? { currency } : {}) };
  });
  const entities = rows.slice(1).map((row, index) => ({
    id: slug(idIndex < 0 ? row[nameIndex] : row[idIndex]) || `row-${index + 1}`, kind: kindIndex < 0 ? 'item' : row[kindIndex] || 'item',
    name: row[nameIndex], summary: descriptionIndex < 0 ? '' : row[descriptionIndex],
    attributes: Object.fromEntries(indexes.map((column, index) => [definitions[index].id, !row[column] ? null : definitions[index].type === 'number' || definitions[index].type === 'money' ? Number(row[column]) : definitions[index].type === 'boolean' ? row[column].toLowerCase() === 'true' : row[column]])),
  }));
  if (entities.some(entity => !entity.name)) throw new AppError('Every catalog row needs a name.');
  if (new Set(entities.map(entity => entity.id)).size !== entities.length) throw new AppError('Some catalog items have matching names or IDs. Add a unique ID column to keep their identities separate.');
  return validateCatalog({ schemaVersion: 1, id: randomUUID(), name: name.replace(/\.[^.]+$/, '').slice(0, 160), description: '', attributes: definitions, entities,
    collections: [{ id: 'all', name: 'All items', entityIds: entities.map(entity => entity.id) }], relationships: [],
    jobs: [{ id: 'explore', label: 'Find and compare the right option', attributeIds: definitions.slice(0, 6).map(attribute => attribute.id) }], capabilities: [],
  });
}

type TextBlock = { text: string; start: number; end: number; lineStart: number; lineEnd: number };
function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []; let block: TextBlock | undefined; let number = 1;
  const lines = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (let match = lines.exec(text); match && match[0]; match = lines.exec(text)) {
    const value = match[1];
    if (!value.trim() || /^\s*-{3,}\s*$/.test(value)) { if (block) blocks.push(block); block = undefined; }
    else if (block) { block.end = match.index + value.length; block.lineEnd = number; block.text = text.slice(block.start, block.end); }
    else block = { text: value, start: match.index, end: match.index + value.length, lineStart: number, lineEnd: number };
    number++;
  }
  if (block) blocks.push(block);
  return blocks;
}

function pdfRanges(source: ExtractedSource) {
  if (!source.pageRanges) return undefined;
  let end = 0;
  if (!source.pageRanges.length || source.pageRanges.length > 40 || source.pages !== undefined && source.pages !== source.pageRanges.length) throw new AppError('PDF source page locations are incomplete.');
  for (const [index, page] of source.pageRanges.entries()) {
    if (page.page !== index + 1 || !Number.isInteger(page.start) || !Number.isInteger(page.end) || page.start < end || page.end <= page.start
      || page.end > source.text.length || source.text.slice(page.start, page.end) !== page.text || !page.text.trim() || source.text.slice(end, page.start).trim()) throw new AppError('PDF source page locations do not match the extracted text.');
    end = page.end;
  }
  if (source.text.slice(end).trim()) throw new AppError('PDF source page locations do not cover the extracted text.');
  return source.pageRanges;
}

function blockAnchor(source: ExtractedSource, block: TextBlock): SourceAnchor {
  const excerpt = sourceExcerpt(block.text);
  if (source.format !== 'pdf') return { id: `${source.format}-lines-${block.lineStart}-${block.lineEnd}`, format: source.format, label: block.lineStart === block.lineEnd ? `Line ${block.lineStart}` : `Lines ${block.lineStart}–${block.lineEnd}`, ...excerpt, lineStart: block.lineStart, lineEnd: block.lineEnd };
  const pages = pdfRanges(source)?.filter(page => page.start < block.end && page.end > block.start);
  const pageStart = pages?.[0]?.page; const pageEnd = pages?.at(-1)?.page;
  return { id: `pdf-block-${block.lineStart}-${block.lineEnd}`, format: 'pdf', ...excerpt,
    label: pageStart === undefined ? 'Extracted PDF excerpt · page unavailable' : pageStart === pageEnd ? `Page ${pageStart}` : `Pages ${pageStart}–${pageEnd}`,
    ...(pageStart === undefined ? {} : { pageStart, pageEnd }),
  };
}

function sourceExcerpt(text: string): Pick<SourceAnchor, 'excerpt' | 'truncated'> {
  let end = Math.min(text.length, MAX_SOURCE_EXCERPT);
  // Keep an excerpt a direct substring without cutting a Unicode surrogate pair.
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return { excerpt: text.slice(0, end), ...(end < text.length ? { truncated: true } : {}) };
}

function csvAnchor(record: CsvRecord): SourceAnchor {
  // Logical records include the header and blank records; line ranges count physical source lines.
  return { id: `csv-row-${record.row}`, format: 'csv', label: `CSV record ${record.row} · ${record.lineStart === record.lineEnd ? `line ${record.lineStart}` : `lines ${record.lineStart}–${record.lineEnd}`}`,
    ...sourceExcerpt(record.excerpt), row: record.row, lineStart: record.lineStart, lineEnd: record.lineEnd };
}

function mappedProvenance(catalog: KnowledgeCatalog, rows: string[][], anchors: SourceAnchor[]): SourceProvenance {
  const headers = rows[0].map(slug);
  const name = headers.findIndex(header => header === 'name' || header === 'title');
  const kind = headers.findIndex(header => header === 'kind' || header === 'category');
  const summary = headers.findIndex(header => header === 'summary' || header === 'description');
  const fields = catalog.entities.flatMap((entity, index) => headers.flatMap((header, column) => {
    // Empty/missing cells and generated defaults are not positive source statements.
    if (anchors[index].truncated || header === 'id' || !rows[index + 1][column]?.trim()) return [];
    const field = column === name ? 'name' : column === kind ? 'kind' : column === summary ? 'summary' : `attributes.${header}`;
    return [{ entityId: entity.id, field, anchorIds: [anchors[index].id] }];
  }));
  return validateSourceProvenance({ anchors, fields, facts: (catalog.facts ?? []).flatMap(fact => {
    const reference = fields.find(field => field.entityId === fact.entityId && field.field === fact.field);
    return reference ? [{ targetId: fact.id, anchorIds: reference.anchorIds }] : [];
  }) }, catalog);
}

function xlsxCellAnchor(sheet: string, cell: XlsxCell): SourceAnchor {
  const formula = cell.formula;
  const value = `${cell.ref}: ${cell.value}${formula ? ' (unevaluated expression; cached result ignored)' : ''}`;
  const range = cell.mergedRange ?? cell.ref;
  return { id: xlsxCellAnchorId(sheet, cell.ref), format: 'xlsx', label: `Sheet ${sheet} · cell ${range}`, ...sourceExcerpt(value), sheet, row: cell.row,
    cellRange: range, ...(formula ? { formula } : {}) };
}

function xlsxMappedProvenance(catalog: KnowledgeCatalog, sheet: XlsxSheet): SourceProvenance {
  const cells = new Map(sheet.cells.map(cell => [cell.ref, cell]));
  const headers = sheet.rows[0].map(slug);
  const firstRow = sheet.rowNumbers[0] ?? Math.min(...sheet.cells.map(cell => cell.row));
  const dataRows = sheet.rowNumbers.length === sheet.rows.length ? sheet.rowNumbers.slice(1) : [...new Set(sheet.cells.map(cell => cell.row).filter(row => row !== firstRow))].sort((left, right) => left - right);
  const name = headers.findIndex(header => header === 'name' || header === 'title');
  const kind = headers.findIndex(header => header === 'kind' || header === 'category');
  const summary = headers.findIndex(header => header === 'summary' || header === 'description');
  const anchors = [...cells.values()].filter(cell => cell.value.trim() || cell.formula).map(cell => xlsxCellAnchor(sheet.name, cell));
  const byId = new Map(anchors.map(anchor => [anchor.id, anchor]));
  const fields = catalog.entities.flatMap((entity, index) => headers.flatMap((header, column) => {
    if (header === 'id') return [];
    const cell = cells.get(`${excelColumn(column + 1)}${dataRows[index] ?? index + 2}`); if (!cell || (!cell.value.trim() && !cell.formula)) return [];
    const field = column === name ? 'name' : column === kind ? 'kind' : column === summary ? 'summary' : `attributes.${header}`;
    const anchor = byId.get(xlsxCellAnchorId(sheet.name, cell.ref)); if (!anchor || anchor.truncated) return [];
    const headerAnchor = byId.get(xlsxCellAnchorId(sheet.name, `${excelColumn(column + 1)}${firstRow}`));
    return [{ entityId: entity.id, field, anchorIds: [anchor.id, ...(headerAnchor && !headerAnchor.truncated ? [headerAnchor.id] : [])] }];
  }));
  return validateSourceProvenance({ anchors, fields, facts: (catalog.facts ?? []).flatMap(fact => {
    const reference = fields.find(field => field.entityId === fact.entityId && field.field === fact.field);
    return reference ? [{ targetId: fact.id, anchorIds: reference.anchorIds }] : [];
  }) }, catalog);
}

/** Split at exact character offsets, never silently discard a long paragraph.
 * The source budget is shared across all segments; this does not fan out calls. */
function segmentedAnchors(anchor: SourceAnchor, text: string): SourceAnchor[] {
  if (text.length <= MAX_SOURCE_EXCERPT) return [anchor];
  const result: SourceAnchor[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + MAX_SOURCE_EXCERPT, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const base = { ...anchor }; delete base.truncated;
    const lineStart = anchor.lineStart === undefined ? undefined : anchor.lineStart + (text.slice(0, start).match(/\r\n|\r|\n/g)?.length ?? 0);
    const excerpt = text.slice(start, end);
    result.push({ ...base, id: `${anchor.id.slice(0, 60)}-part-${result.length + 1}`, excerpt,
      label: `${anchor.label.slice(0, 110)} · characters ${start + 1}–${end}`,
      characterStart: start, characterEnd: end,
      ...(lineStart === undefined ? {} : { lineStart, lineEnd: lineStart + (excerpt.match(/\r\n|\r|\n/g)?.length ?? 0) }) });
    start = end;
  }
  return result;
}

/** Source excerpts for a semantic interpretation, without claiming which fields they support. */
export function unlinkedSourceProvenance(source: ExtractedSource): SourceProvenance {
  let anchors: SourceAnchor[];
  if (source.text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError('The source exceeds the shared 60,000 character budget. Nothing was truncated.');
  if (source.format === 'csv') anchors = csvRecords(source.text).flatMap(record => segmentedAnchors(csvAnchor(record), record.excerpt));
  else if (source.format === 'xlsx' && source.xlsxSheets?.length) {
    anchors = source.xlsxSheets.flatMap(sheet => {
      if (sheet.cells.length) return sheet.cells.filter(cell => cell.value.trim() || cell.formula).map(cell => xlsxCellAnchor(sheet.name, cell));
      const fallback: SourceAnchor[] = [];
      const rowNumbers = sheet.rowNumbers.length === sheet.rows.length ? sheet.rowNumbers : sheet.rows.map((_, index) => index + 1);
      sheet.rows.forEach((row, index) => row.forEach((value, column) => {
        if (!value.trim()) return;
        const ref = `${excelColumn(column + 1)}${rowNumbers[index]}`;
        fallback.push({ id: xlsxCellAnchorId(sheet.name, ref), format: 'xlsx', label: `Sheet ${sheet.name} · cell ${ref}`, ...sourceExcerpt(`${ref}: ${value}`), sheet: sheet.name, row: rowNumbers[index], cellRange: ref });
      }));
      return fallback;
    });
  }
  else if (source.format === 'pdf' && source.pageRanges) {
    anchors = pdfRanges(source)!.flatMap(page => segmentedAnchors({ id: `pdf-page-${page.page}`, format: 'pdf', label: `Page ${page.page}`, ...sourceExcerpt(page.text), pageStart: page.page, pageEnd: page.page }, page.text));
  } else {
    // Bound review excerpts without losing or inventing source lines. Small adjacent
    // paragraphs share an anchor; a long block remains one explicitly bounded excerpt.
    const blocks = textBlocks(source.text); const grouped: TextBlock[] = [];
    for (const block of blocks) {
      const previous = grouped.at(-1);
      if (previous && block.end - previous.start <= MAX_SOURCE_EXCERPT) {
        previous.end = block.end; previous.lineEnd = block.lineEnd; previous.text = source.text.slice(previous.start, previous.end);
      } else grouped.push({ ...block });
    }
    anchors = grouped.flatMap(block => segmentedAnchors(blockAnchor(source, block), block.text));
  }
  return validateSourceProvenance({ anchors, fields: [] });
}

export function interpretSourceWithProvenance(name: string, source: ExtractedSource): { catalog: KnowledgeCatalog; provenance: SourceProvenance } | null {
  if (source.format === 'csv') {
    const records = csvRecords(source.text); const rows = records.map(record => record.cells); const catalog = catalogFromRows(name, rows);
    return { catalog, provenance: mappedProvenance(catalog, rows, records.slice(1).map(csvAnchor)) };
  }
  if (source.format === 'xlsx' && source.xlsxSheets && source.xlsxSheets.length > 1) {
    const parts = source.xlsxSheets.filter(sheet => sheet.rows.length).map(sheet => {
      const interpreted = interpretSourceWithProvenance(name, { ...source, xlsxSheets: [sheet] });
      if (!interpreted) throw new AppError(`Sheet “${sheet.name}” is not a supported labeled table. Use the connected interpreter or split the workbook; no sheets were omitted.`);
      const remap = new Map(interpreted.catalog.entities.map(entity => [entity.id, `sheet-${createHash('sha256').update(`${sheet.name}/${entity.id}`).digest('hex').slice(0, 32)}`]));
      return { catalog: { ...interpreted.catalog, entities: interpreted.catalog.entities.map(entity => ({ ...entity, id: remap.get(entity.id)! })),
        facts: interpreted.catalog.facts?.map(fact => ({ ...fact, entityId: remap.get(fact.entityId)! })) },
        provenance: { ...interpreted.provenance, fields: interpreted.provenance.fields.map(field => ({ ...field, entityId: remap.get(field.entityId)! })) } };
    });
    const attributes = new Map<string, AttributeDefinition>();
    for (const part of parts) for (const attribute of part.catalog.attributes) {
      if (attributes.has(attribute.id) && JSON.stringify(attributes.get(attribute.id)) !== JSON.stringify(attribute)) throw new AppError('Workbook sheets disagree on a column type or unit. Export separate sources for review; nothing was omitted.');
      attributes.set(attribute.id, attribute);
    }
    const entities = parts.flatMap(part => part.catalog.entities);
    const catalog = validateCatalog({ ...parts[0].catalog, attributes: [...attributes.values()], entities, facts: parts.flatMap(part => part.catalog.facts ?? []), collections: [{ id: 'all', name: 'All sheets', entityIds: entities.map(entity => entity.id) }] });
    const provenance = validateSourceProvenance({ anchors: parts.flatMap(part => part.provenance.anchors), fields: parts.flatMap(part => part.provenance.fields), facts: parts.flatMap(part => part.provenance.facts ?? []) }, catalog);
    return { catalog, provenance };
  }
  if (source.format === 'xlsx' && source.xlsxSheets?.length === 1) {
    const sheet = source.xlsxSheets[0];
    if (sheet.rows.length >= 2) {
      const rows = sheet.rows.map((row, index) => row.map((value, column) => sheet.cells.some(cell => cell.row === sheet.rowNumbers[index] && cell.column === column + 1 && cell.formula) ? '' : value));
      const catalog = catalogFromRows(name, rows);
      catalog.facts = sheet.cells.filter(cell => cell.formula && cell.row !== sheet.rowNumbers[0]).map(cell => {
        const index = sheet.rowNumbers.indexOf(cell.row) - 1;
        const field = slug(sheet.rows[0][cell.column - 1]);
        if (index < 0 || !Object.hasOwn(catalog.entities[index].attributes, field)) throw new AppError('A formula cannot supply an item name, type, ID or description. Correct the source before importing.');
        return { id: `expression-${createHash('sha256').update(`${sheet.name}/${cell.ref}`).digest('hex').slice(0, 32)}`, entityId: catalog.entities[index].id, field: `attributes.${field}`, value: null, expression: cell.formula };
      });
      return { catalog, provenance: xlsxMappedProvenance(catalog, sheet) };
    }
  }
  // Explicit field blocks can be interpreted honestly without a semantic model.
  const blocks = textBlocks(source.text);
  const records: Record<string, string>[] = [];
  for (const block of blocks) {
    const record: Record<string, string> = Object.create(null);
    for (const line of block.text.split(/\r\n|\r|\n/).filter(line => line.trim())) {
      const match = line.match(/^\s*([^:]{1,80}):\s*(.*?)\s*$/);
      if (!match || !match[1].trim() || Object.hasOwn(record, match[1].trim())) return null;
      record[match[1].trim()] = match[2];
    }
    if (!Object.keys(record).some(key => /^(name|title)$/i.test(key))) return null;
    records.push(record);
  }
  if (!records.length) return null;
  const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
  const rows = [headers, ...records.map(record => headers.map(header => record[header] ?? ''))];
  const catalog = catalogFromRows(name, rows);
  const provenance = source.format === 'pdf' && !source.pageRanges ? unlinkedSourceProvenance(source) : mappedProvenance(catalog, rows, blocks.map(block => blockAnchor(source, block)));
  return { catalog, provenance };
}

export function interpretStructuredSource(name: string, source: ExtractedSource): KnowledgeCatalog | null { return interpretSourceWithProvenance(name, source)?.catalog ?? null; }

export async function extractSource(name: string, mime: string, bytes: Uint8Array, options?: { ocrProvider?: OcrProvider; signal?: AbortSignal }): Promise<ExtractedSource> {
  const byteLimit = mime.startsWith('image/') ? 10 * 1024 * 1024 : ['text/plain', 'text/csv'].includes(mime) ? 256 * 1024 : 2 * 1024 * 1024;
  if (bytes.length > byteLimit || !bytes.length) throw new AppError('Use a non-empty source within the existing upload size limit.');
  if (mime === 'application/pdf') {
    let task: import('pdfjs-dist/types/src/display/api').PDFDocumentLoadingTask;
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      // Native package lookup must stay a filesystem path: Turbopack rewrites
      // require.resolve calls into numeric module IDs, including external JSON.
      const packagePath = findPackageJSON('pdfjs-dist', pathToFileURL(join(process.cwd(), 'package.json')).href);
      if (!packagePath) throw new Error('PDF.js package directory is unavailable.');
      const pdfDirectory = dirname(packagePath);
      // Server parsing resolves worker/font assets locally, never through a CDN or visitor browser.
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(pdfDirectory, 'legacy', 'build', 'pdf.worker.mjs')).href;
      task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, stopAtErrors: true,
        standardFontDataUrl: `${join(pdfDirectory, 'standard_fonts')}/`, cMapUrl: `${join(pdfDirectory, 'cmaps')}/`, cMapPacked: true });
    } catch { throw new AppError('The server’s PDF reader could not initialize. This source was not interpreted. TXT and CSV imports remain available.', 503); }
    const timer = setTimeout(() => { void task.destroy(); }, 15_000);
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 40) throw new AppError('This import supports at most 40 PDF pages. Split the document; nothing was truncated.');
      const pages: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index); const content = await page.getTextContent();
        const text = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('');
        if (!text.trim()) throw new AppError(`PDF page ${index} has no readable text. This may be a scanned or blank page; review it or use OCR before importing. No partial interpretation was saved.`);
        pages.push(text);
        if (pages.join('\n\n').length > MAX_EXTRACTED_CHARACTERS) throw new AppError('The extracted PDF exceeds this pilot’s text limit. Split it into smaller files; nothing was truncated.');
      }
      const text = pages.join('\n\n');
      if (!text) throw new AppError('This PDF has no readable text. Scanned PDFs need OCR, which is not available in this import yet.');
      let start = 0;
      const pageRanges = pages.map((text, index) => { const page = { page: index + 1, text, start, end: start + text.length }; start = page.end + 2; return page; });
      return { text, format: 'pdf', pages: pdf.numPages, pageRanges };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('This PDF could not be read within the import limits. It may be encrypted, damaged or require OCR. The source was not interpreted.');
    } finally { clearTimeout(timer); await task.destroy(); }
  }
  const lowerName = name.toLowerCase();
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
    const text = extractDocxText(bytes);
    if (text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError('The extracted DOCX exceeds the 60,000 character limit. Split the document; nothing was truncated.');
    return { text, format: 'docx' };
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || lowerName.endsWith('.xlsx')) {
    const extracted = extractXlsx(bytes);
    if (extracted.text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError('The extracted XLSX exceeds the 60,000 character limit. Split the workbook; nothing was truncated.');
    return { text: extracted.text, xlsxSheets: extracted.sheets, format: 'xlsx' };
  }
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    let html: string;
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new AppError('HTML sources must use UTF-8 encoding.'); }
    const text = htmlToText(html);
    if (text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError('The extracted webpage exceeds the 60,000 character limit.');
    return { text, format: 'html' };
  }
  if (/^image\/(?:png|jpeg|webp|tiff)$/.test(mime)) {
    const text = await extractOcrText(bytes, mime, options?.ocrProvider, options?.signal);
    return { text, format: 'ocr' };
  }
  if (mime !== 'text/plain' && mime !== 'text/csv' && !lowerName.endsWith('.csv')) throw new AppError('Import a TXT, CSV, DOCX, XLSX, HTML or text-bearing PDF. Other formats are not supported.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new AppError('Text and CSV files must use UTF-8 encoding.'); }
  if (!text.trim() || text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError('Use a non-empty source of at most 60,000 extracted characters. Split longer files; nothing was truncated.');
  return { text, format: mime === 'text/csv' || lowerName.endsWith('.csv') ? 'csv' : 'text' };
}
