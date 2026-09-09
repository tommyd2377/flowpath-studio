import { randomUUID } from 'node:crypto';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCatalog, type KnowledgeCatalog, type AttributeDefinition } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';

export const MAX_EXTRACTED_CHARACTERS = 60_000;
export type ExtractedSource = { text: string; format: 'csv' | 'text' | 'pdf'; pages?: number };
const slug = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell || closed) throw new AppError('CSV contains a misplaced quotation mark.');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (char !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (char === '\r' && source[i + 1] === '\n') i++; }
    } else {
      if (closed && char.trim()) throw new AppError('CSV contains text after a quoted field.');
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new AppError('CSV contains an unfinished quoted field.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 101) throw new AppError('Use a CSV header and between 1 and 100 item rows. Larger files need to be split; nothing was truncated.');
  if (rows.some(row => row.length !== rows[0].length)) throw new AppError('Every CSV row must have the same number of columns.');
  return rows;
}

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

export function interpretStructuredSource(name: string, source: ExtractedSource): KnowledgeCatalog | null {
  if (source.format === 'csv') return catalogFromRows(name, parseCsv(source.text));
  // Explicit field blocks can be interpreted honestly without a semantic model.
  const blocks = source.text.trim().split(/\n\s*\n|\n\s*---+\s*\n/).filter(Boolean);
  const records: Record<string, string>[] = [];
  for (const block of blocks) {
    const record: Record<string, string> = {};
    for (const line of block.split('\n').filter(line => line.trim())) {
      const match = line.match(/^\s*([^:]{1,80}):\s*(.*?)\s*$/);
      if (!match || !match[1].trim() || Object.hasOwn(record, match[1].trim())) return null;
      record[match[1].trim()] = match[2];
    }
    if (!Object.keys(record).some(key => /^(name|title)$/i.test(key))) return null;
    records.push(record);
  }
  if (!records.length) return null;
  const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
  return catalogFromRows(name, [headers, ...records.map(record => headers.map(header => record[header] ?? ''))]);
}

export async function extractSource(name: string, mime: string, bytes: Uint8Array): Promise<ExtractedSource> {
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
      const text = pages.join('\n\n').trim();
      if (!text) throw new AppError('This PDF has no readable text. Scanned PDFs need OCR, which is not available in this import yet.');
      return { text, format: 'pdf', pages: pdf.numPages };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('This PDF could not be read within the import limits. It may be encrypted, damaged or require OCR. The source was not interpreted.');
    } finally { clearTimeout(timer); await task.destroy(); }
  }
  if (mime !== 'text/plain' && mime !== 'text/csv' && !name.toLowerCase().endsWith('.csv')) throw new AppError('Import a TXT, CSV or text-bearing PDF. Other formats are not supported yet.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new AppError('Text and CSV files must use UTF-8 encoding.'); }
  if (!text.trim() || text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError('Use a non-empty source of at most 60,000 extracted characters. Split longer files; nothing was truncated.');
  return { text, format: mime === 'text/csv' || name.toLowerCase().endsWith('.csv') ? 'csv' : 'text' };
}
