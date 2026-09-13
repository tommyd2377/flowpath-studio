import { htmlDocument } from './html-document';
import { crc32, inflateRawSync } from 'node:zlib';
import { AppError } from './errors';
import { fetchWebsiteHtml, type WebsiteTransport } from './website-fetch';
export { assertPublicWebsiteUrl } from './website-fetch';

/** Small, bounded ZIP reader for Office Open XML files. It intentionally supports
 * only the two compression methods used by DOCX/XLSX and rejects unsafe entries. */
const MAX_ENTRIES = 2_000;
const MAX_UNCOMPRESSED = 12 * 1024 * 1024;

function xmlEntities(value: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.toLowerCase().startsWith('#x')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : `&${entity};`;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : `&${entity};`;
    }
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new AppError('This Office document is not a valid ZIP package.');
}

function zipEntries(bytes: Uint8Array) {
  if (bytes.length > 2 * 1024 * 1024) throw new AppError('This Office package exceeds the 2 MB upload limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (!count || count > MAX_ENTRIES || centralOffset + centralSize !== eocd || eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.length
    || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || view.getUint16(eocd + 8, true) !== count) throw new AppError('This Office document exceeds the supported package limits or uses multiple disks.');
  const result = new Map<string, Uint8Array>();
  let offset = centralOffset; let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new AppError('This Office document has an invalid package directory.');
    const method = view.getUint16(offset + 10, true); const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true); const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const flags = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 16, true);
    if (flags & 0x41 || view.getUint16(offset + 34, true) || offset + 46 + nameLength + extraLength + commentLength > eocd) throw new AppError('Encrypted or malformed Office packages are unsupported.');
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name || /[\\\x00:]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..') || result.has(name) || localOffset + 30 > centralOffset) throw new AppError('This Office document contains an unsafe or duplicate package path.');
    if (uncompressedSize > MAX_UNCOMPRESSED || (total += uncompressedSize) > MAX_UNCOMPRESSED) throw new AppError('This Office document is too large to inspect safely.');
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new AppError('This Office document has an invalid package entry.');
    const localNameLength = view.getUint16(localOffset + 26, true); const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > centralOffset || view.getUint16(localOffset + 8, true) !== method || view.getUint16(localOffset + 6, true) !== flags
      || new TextDecoder().decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name) throw new AppError('This Office document has an inconsistent or truncated package entry.');
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    try { data = method === 0 ? new Uint8Array(compressed) : method === 8 ? new Uint8Array(inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED })) : (() => { throw new Error(); })(); }
    catch { throw new AppError('This Office document uses an unsupported or corrupt compression stream.'); }
    if (data.length !== uncompressedSize || crc32(data) !== checksum) throw new AppError('This Office document failed package size or checksum validation.');
    result.set(name, data);
  }
  if (offset !== eocd) throw new AppError('This Office document has an inconsistent package directory.');
  return result;
}

function xmlText(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<w:(?:altChunk|object)\b/i.test(xml)) throw new AppError('Embedded or externally defined DOCX content is unsupported. Export a text document; no partial extraction was saved.');
  if (/<w:(?:del|ins|moveFrom|moveTo|footnoteReference|endnoteReference|drawing|pict|fldSimple|fldChar)\b/i.test(xml)) throw new AppError('DOCX tracked changes, notes, drawings and dynamic fields are unsupported. Accept revisions and export the complete content as text; no partial extraction was saved.');
  xml = xml.replace(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/gi, (_, table: string) => {
    if (/<w:tbl\b/i.test(table)) throw new AppError('Nested DOCX tables are unsupported. Export a flat table; no partial extraction was saved.');
    const rows = [...table.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi)].map(row => [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi)].map(cell => xmlText(cell[1]).replace(/\n/g, ' / ')).join('\t'));
    return `\n[Table]\n${rows.join('\n')}\n[/Table]\n`;
  });
  return xmlEntities(xml.replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t').replace(/<w:br\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<w:pStyle\b[^>]*w:val=["']Heading([1-6])["'][^>]*\/?\s*>/gi, (_, level: string) => `${'#'.repeat(Number(level))} `)
    .replace(/<\/w:tc\s*>/gi, '\t').replace(/<\/w:tr\s*>/gi, '\n')
    .replace(/<\/w:p\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractDocxText(bytes: Uint8Array) {
  const files = zipEntries(bytes);
  const names = [...files.keys()].filter(name => /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b));
  if (!names.length) throw new AppError('This DOCX does not contain readable document content.');
  const text = names.map(name => { const text = xmlText(new TextDecoder('utf-8', { fatal: true }).decode(files.get(name)!)); return text && name !== 'word/document.xml' ? `[Part: ${name}]\n${text}` : text; }).filter(Boolean).join('\n\n');
  if (!text) throw new AppError('This DOCX does not contain readable text.');
  return text;
}

export type XlsxCell = { ref: string; row: number; column: number; value: string; formula?: string; mergedRange?: string };
export type XlsxSheet = { name: string; rows: string[][]; rowNumbers: number[]; cells: XlsxCell[]; mergedRanges: string[] };
const columnNumber = (reference: string) => {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '';
  let value = 0; for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(1, value);
};
function tagText(value: string) { return xmlEntities(value.replace(/<[^>]+>/g, '')); }

function cellCoordinates(reference: string) {
  const match = reference.match(/^([A-Z]{1,3})([1-9]\d{0,4})$/i);
  if (!match) return undefined;
  const column = columnNumber(match[1]); const row = Number(match[2]);
  return column <= 16384 && row <= 60001 ? { column, row } : undefined;
}
function xmlAttribute(tag: string, name: string) {
  return xmlEntities(tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? '');
}

function rangeContainsCell(range: string, reference: string) {
  const [start, end = start] = range.split(':');
  const first = cellCoordinates(start); const last = cellCoordinates(end); const cell = cellCoordinates(reference);
  return !!first && !!last && !!cell && cell.row >= Math.min(first.row, last.row) && cell.row <= Math.max(first.row, last.row)
    && cell.column >= Math.min(first.column, last.column) && cell.column <= Math.max(first.column, last.column);
}

function xlsxValue(attributes: string, body: string, shared: string[]) {
  const formulaMatch = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/i);
  const formula = formulaMatch ? xmlEntities(formulaMatch[1].trim()) : body.match(/<f\b[^>]*\/\s*>/i) ? 'FORMULA' : undefined;
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(match => match[1]).join('');
  // Formula results are deliberately represented as formula source. Excel cached
  // values are untrusted and must never be treated as an evaluated assertion.
  if (formula) {
    if (formula.length > 1000) throw new AppError('An XLSX formula exceeds the 1,000 character expression limit.');
    return { value: `=${formula}`, formula };
  }
  const type = xmlAttribute(attributes, 't');
  if (type === 's' && (!/^\d+$/.test(raw) || shared[Number(raw)] === undefined)) throw new AppError('This XLSX references a missing shared string.');
  if (type === 'b' && !/^[01]$/.test(raw)) throw new AppError('This XLSX contains an invalid boolean cell.');
  if (type === 'e') return { value: '', formula: `Excel error: ${tagText(raw)}` };
  return { value: type === 's' ? shared[Number(raw)] : type === 'b' ? raw === '1' ? 'true' : 'false' : tagText(raw) };
}

export function extractXlsx(bytes: Uint8Array): { text: string; sheets: XlsxSheet[] } {
  const files = zipEntries(bytes); const decoder = new TextDecoder();
  for (const [path, content] of files) if (path.endsWith('.xml') && /<!DOCTYPE|<!ENTITY/i.test(decoder.decode(content))) throw new AppError('Office XML entity declarations are unsupported.');
  const shared = [...(files.get('xl/sharedStrings.xml') ? decoder.decode(files.get('xl/sharedStrings.xml')!) : '').matchAll(/<si\b[\s\S]*?<\/si>/gi)].map(match => tagText(match[0].replace(/<si\b[^>]*>|<\/si>/gi, '')));
  const workbook = files.get('xl/workbook.xml') ? decoder.decode(files.get('xl/workbook.xml')!) : '';
  const styles = files.get('xl/styles.xml') ? decoder.decode(files.get('xl/styles.xml')!) : '';
  const formats = new Map([...styles.matchAll(/<numFmt\b[^>]*>/gi)].map(match => [Number(xmlAttribute(match[0], 'numFmtId')), xmlAttribute(match[0], 'formatCode')]));
  const cellStyles = [...(styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] ?? '').matchAll(/<xf\b[^>]*>/gi)].map(match => Number(xmlAttribute(match[0], 'numFmtId')));
  const relationships = files.get('xl/_rels/workbook.xml.rels') ? decoder.decode(files.get('xl/_rels/workbook.xml.rels')!) : '';
  const rels = new Map([...relationships.matchAll(/<Relationship\b[^>]*>/gi)].map(match => {
    const target = xmlAttribute(match[0], 'Target');
    if (xmlAttribute(match[0], 'TargetMode') === 'External' || target.includes('..') || /[:\\]/.test(target)) throw new AppError('External XLSX workbook relationships are unsupported.');
    return [xmlAttribute(match[0], 'Id'), target.replace(/^\//, '')];
  }));
  const sheetDefs = [...workbook.matchAll(/<sheet\b[^>]*>/gi)];
  const sheets: XlsxSheet[] = [];
  let totalCells = 0;
  for (const match of sheetDefs) {
    const name = xmlAttribute(match[0], 'name'); const targetValue = rels.get(xmlAttribute(match[0], 'r:id'));
    if (!name || name.length > 120 || sheets.some(sheet => sheet.name === name) || !targetValue) throw new AppError('This XLSX has ambiguous or missing sheet metadata.');
    const target = targetValue.startsWith('xl/') ? targetValue : `xl/${targetValue}`;
    if (!files.has(target)) throw new AppError('A declared XLSX sheet is missing. No partial workbook was imported.');
    const xml = decoder.decode(files.get(target)!);
    const mergedRanges = [...xml.matchAll(/<mergeCell\b[^>]*>/gi)].map(match => xmlAttribute(match[0], 'ref').toUpperCase());
    if (mergedRanges.length > 2700 || mergedRanges.some(range => { const ends = range.split(':'); return ends.length !== 2 || ends.some(ref => !cellCoordinates(ref)); })) throw new AppError('This XLSX has invalid or excessive merged ranges.');
    const rows: string[][] = []; const rowNumbers: number[] = []; const cells: XlsxCell[] = [];
    for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gi)) {
      const rowValues: string[] = []; const cellMatches = [...(rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)];
      const declaredRow = Number(xmlAttribute(rowMatch[1], 'r'));
      for (const cell of cellMatches) {
        const ref = xmlAttribute(cell[1], 'r').toUpperCase(); const coordinates = cellCoordinates(ref);
        if (!coordinates || coordinates.row !== declaredRow || cells.some(cell => cell.ref === ref) || ++totalCells > 2700) throw new AppError('This XLSX has invalid, duplicate or excessive cell locations (limit 2,700 cells and row 60,001).');
        const attributes = cell[1]; const body = cell[2] ?? ''; const parsed = xlsxValue(attributes, body, shared);
        const style = xmlAttribute(attributes, 's');
        if (style && (!/^\d+$/.test(style) || cellStyles[Number(style)] === undefined)) throw new AppError('This XLSX references a missing cell style.');
        const formatId = cellStyles[Number(style || 0)];
        const formatCode = (formats.get(formatId) ?? '').replace(/"[^"]*"|\\./g, '');
        if (parsed.value && !parsed.formula && (!xmlAttribute(attributes, 't') || xmlAttribute(attributes, 't') === 'n')
          && (formatId >= 14 && formatId <= 22 || formatId >= 27 && formatId <= 36 || formatId >= 45 && formatId <= 58 || /[ymdhs]/i.test(formatCode))) {
          throw new AppError('Date/time-formatted numeric XLSX cells require an ISO date text export. No serial number was presented as a date and no partial workbook was imported.');
        }
        // Bound allocations before touching a sparse cell's column index.
        if (coordinates.column > 28) throw new AppError('This XLSX exceeds the supported 28-column table width. Split or export a narrower sheet; nothing was omitted.');
        while (rowValues.length < coordinates.column - 1) rowValues.push('');
        rowValues[coordinates.column - 1] = parsed.value;
        const mergedRange = mergedRanges.find(range => rangeContainsCell(range, ref));
        if (mergedRanges.filter(range => rangeContainsCell(range, ref)).length > 1 || mergedRange && ref !== mergedRange.split(':')[0] && parsed.value) throw new AppError('This XLSX contains overlapping or conflicting merged cells.');
        cells.push({ ref, row: coordinates.row, column: coordinates.column, value: parsed.value, ...(parsed.formula ? { formula: parsed.formula } : {}), ...(mergedRange ? { mergedRange } : {}) });
      }
      if (rowValues.some(Boolean)) {
        const rowNumber = declaredRow;
        if (!rowNumber) throw new AppError('This XLSX has a row without a valid physical number.');
        if (rowNumbers.includes(rowNumber) || rowNumbers.at(-1)! > rowNumber) throw new AppError('This XLSX has duplicate or unordered rows.');
        rows.push(rowValues); rowNumbers.push(rowNumber);
      }
    }
    sheets.push({ name, rows, rowNumbers, cells, mergedRanges });
  }
  if (!sheets.length || !sheets.some(sheet => sheet.rows.length)) throw new AppError('This XLSX does not contain readable rows.');
  const sections = sheets.map(sheet => [`[Sheet: ${sheet.name}]`, ...sheet.cells.map(cell => `${cell.ref}${cell.mergedRange ? ` [merged ${cell.mergedRange}]` : ''}: ${cell.value}`)].join('\n'));
  const text = sections.join('\n\n');
  if (!text.trim()) throw new AppError('This XLSX does not contain readable text.');
  return { text, sheets };
}

export function htmlToText(html: string, options: { allowEmpty?: boolean } = {}) {
  const document = htmlDocument(html, false);
  const result = [document.title ? `Title: ${document.title}` : '', document.text].filter(Boolean).join('\n\n');
  if (!result && !options.allowEmpty) throw new AppError('This webpage did not contain readable text.');
  return result;
}

export async function fetchWebsiteText(value: string, io?: WebsiteTransport) {
  const result = await fetchWebsiteHtml(value, io);
  const text = htmlToText(result.html);
  if (text.length > 60_000) throw new AppError('Website text exceeds the 60,000 character limit. Nothing was imported.');
  return { text, url: result.url };
}
