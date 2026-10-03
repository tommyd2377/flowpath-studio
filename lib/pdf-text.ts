import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

function horizontal(item: TextItem) {
  return item.dir === 'ltr' && Array.isArray(item.transform) && item.transform.length === 6
    && item.transform.every(Number.isFinite) && item.transform[0] > 0 && item.transform[3] > 0
    && item.transform[1] === 0 && item.transform[2] === 0
    && Number.isFinite(item.width) && item.width >= 0 && Number.isFinite(item.height) && item.height > 0;
}

/** Preserve wide horizontal gaps as whitespace hints, without inferring columns or reading order. */
export function pdfTextFromItems(items: readonly (TextItem | TextMarkedContent)[]): string {
  const text = items.filter((item): item is TextItem => 'str' in item), gaps = new Set<number>();
  for (let index = 0; index < text.length; index++) {
    const left = text[index];
    if (!left.str.trim() || left.hasEOL || /[\r\n\t]/.test(left.str) || !horizontal(left)) continue;
    let next = index + 1;
    // PDF.js can emit an explicit space item between positioned text runs.
    // Never cross a line break or an existing tab to seek another run.
    while (next < text.length && /^[ \u00a0]*$/.test(text[next].str) && !text[next].hasEOL) next++;
    const right = text[next];
    if (!right?.str.trim() || /[\r\n\t]/.test(right.str) || !horizontal(right)) continue;
    const gap = right.transform[4] - left.transform[4] - left.width;
    if (Number.isFinite(gap) && Math.abs(right.transform[5] - left.transform[5]) <= Math.min(left.height, right.height) * 0.1
      && gap >= Math.max(left.height, right.height) * 4) gaps.add(index);
  }
  // Only the inserted separator changes. Original strings, hasEOL and item
  // order remain exact, including gaps occupied by non-text graphics.
  return text.map((item, index) => `${item.str}${item.hasEOL ? '\n' : gaps.has(index) ? '\t' : ' '}`).join('');
}
