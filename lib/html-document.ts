import { createRequire } from 'node:module';
import { AppError } from './errors';

/** The parser bundled with our pinned Next dependency; no browser/script execution. */
export type HtmlNode = { nodeType: number; rawTagName?: string; text: string; rawText: string; innerHTML: string; outerHTML: string; childNodes: HtmlNode[]; parentNode?: HtmlNode;
  attributes: Record<string, string>; getAttribute(name: string): string | undefined; setAttribute(name: string, value: string): void; removeAttribute(name: string): void;
  querySelector(selector: string): HtmlNode | null; querySelectorAll(selector: string): HtmlNode[]; remove(): void; set_content(value: string): void };
// Next externalizes explicit compiled JavaScript files. Rebundling this precompiled
// CommonJS package breaks its entity decoder in a production webpack server.
const parser = createRequire(import.meta.url)('next/dist/compiled/node-html-parser/index.js') as { parse(html: string, options?: Record<string, unknown>): HtmlNode };
/** The bundled parser treats declarations as text. Remove only actual leading prolog tokens. */
function withoutDocumentProlog(html: string) {
  const removed: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor < html.length) {
    while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      if (end < 0) break;
      cursor = end + 3; continue;
    }
    const prefix = html.slice(cursor, cursor + 12);
    const xml = /^<\?xml\s/i.test(prefix), doctype = /^<!doctype\s/i.test(prefix);
    if (!xml && !doctype) break;
    let quote = '', subset = 0, end = cursor + (xml ? 5 : 9);
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '<' && !subset) break;
      if (doctype && char === '[') subset++;
      else if (doctype && char === ']') subset = Math.max(0, subset - 1);
      else if (char === '>' && !subset && (!xml || html[end - 1] === '?')) break;
    }
    // Malformed declarations are not permission to consume the following document.
    if (end >= html.length || html[end] !== '>') break;
    removed.push([cursor, end + 1]); cursor = end + 1;
  }
  let start = 0;
  return removed.map(([from, to]) => { const kept = html.slice(start, from); start = to; return kept; }).join('') + html.slice(start);
}
export const parseHtml = (html: string) => parser.parse(withoutDocumentProlog(html), { comment: false, blockTextElements: { script: true, style: true, pre: true } });
const block = /^(?:h[1-6]|p|li|div|section|article|br|tr|address|dt|dd|header|footer|nav)$/;
export function nodeText(node: HtmlNode): string {
  if (node.nodeType === 3) return node.text;
  const tag = node.rawTagName?.toLowerCase() ?? '';
  if (['script', 'style', 'noscript', 'template', 'svg'].includes(tag)) return '';
  const content = node.childNodes.map(nodeText).join('');
  const heading = /^h([1-6])$/.exec(tag);
  if(heading)return `\n${'#'.repeat(Number(heading[1]))} ${content.replace(/\s+/g,' ').trim()}\n`;
  return block.test(tag) ? `\n${heading ? '#'.repeat(Number(heading[1])) + ' ' : ''}${content}\n` : tag === 'td' || tag === 'th' ? `${content}\t` : content;
}
export const cleanText = (value: string) => value.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
const footerSelector = 'footer,[data-elementor-type="footer"],[role="contentinfo"]';
function textOutsideLinks(node: HtmlNode): string {
  if (node.nodeType === 3) return node.text;
  if (/^(?:a|h[1-6])$/i.test(node.rawTagName ?? '')) return '';
  return node.childNodes.map(textOutsideLinks).join('');
}
/** Footer prose is evidence too; remove link-only chrome, not business facts. */
function retainFooterInformation(root: HtmlNode) {
  const footers = root.querySelectorAll(footerSelector), footerSet = new Set(footers);
  for (const footer of footers) {
    let parent = footer.parentNode;
    while (parent && !footerSet.has(parent)) parent = parent.parentNode;
    if (parent) continue;
    for (const node of footer.querySelectorAll('nav,[role="navigation"]')) node.remove();
    const linkGroups = new Set<HtmlNode>();
    for (const link of footer.querySelectorAll('a[href]')) {
      // Retain literal phone/email/address labels, and links embedded in explanatory prose.
      if (/^(?:tel:|mailto:)/i.test(link.getAttribute('href') ?? '') || /\d/.test(link.text)) continue;
      let context = link.parentNode;
      while (context && context !== footer && !block.test(context.rawTagName?.toLowerCase() ?? '')) context = context.parentNode;
      if (!context || context === footer || !cleanText(textOutsideLinks(context))) { link.remove(); if (context && context !== footer) linkGroups.add(context); }
    }
    for (const group of linkGroups) if (!group.querySelector('a[href]') && !cleanText(textOutsideLinks(group))) group.remove();
    const text = cleanText(nodeText(footer)).split('\n').filter(line => !/^(?:©|copyright\s+(?:©|\d)|all rights reserved\b|(?:powered|designed|website) by\b)|\ball rights reserved[.!]?$/i.test(line)).join('\n').trim();
    if (!text) { footer.remove(); continue; }
    // A source boundary prevents the final priced item from absorbing footer policies/hours.
    // Escape before re-parsing: source prose must never become executable markup.
    footer.set_content(`<h1>Website footer</h1>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}`);
  }
}
export function htmlDocument(html: string, stripChrome = true) {
  const root = parseHtml(html), title = root.querySelector('title')?.text.trim() ?? '';
  for (const node of root.querySelectorAll('script,style,noscript,template,svg')) node.remove();
  const rawText = cleanText(nodeText(root));
  const contacts = root.querySelectorAll('a[href]').flatMap(node => /^(?:tel:|mailto:)/i.test(node.getAttribute('href') ?? '') ? [(node.getAttribute('href') ?? '').replace(/^(?:tel:|mailto:)/i, '').split('?')[0]] : []);
  const footerText = root.querySelectorAll(footerSelector).map(node => cleanText(nodeText(node))).join('\n');
  const dayLines = (text:string) => cleanText(text).split('\n').filter(line=>/(?:mon|tues|wednes|thurs|fri|satur|sun)day/i.test(line));
  let hourLines = dayLines(footerText);
  if(!hourLines.length)for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    if(!/^(?:opening |business |store |operating )?hours$/i.test(heading.text.trim()))continue;
    let section=heading.parentNode;
    for(let depth=0;section&&depth<3;depth++,section=section.parentNode){const lines=dayLines(nodeText(section));if(lines.length){hourLines=lines;break;}}
    if(hourLines.length)break;
  }
  const hours = [...new Set(hourLines)].join('; ').slice(0,180);
  for (const node of root.querySelectorAll('title,head,form,select,button,input,textarea,[hidden],[aria-hidden="true"]')) node.remove();
  if (stripChrome) {
    retainFooterInformation(root);
    for (const node of root.querySelectorAll('nav,[role="navigation"]')) node.remove();
    for (const node of root.querySelectorAll('header,[role="banner"],[data-elementor-type="header"]')) {
      // A section/article header is content, including its qualifications and introduction.
      // Only the outer site header is chrome; do not lose a main page's hero prose.
      let parent = node.parentNode;
      while (parent && !/^(?:main|article|section)$/i.test(parent.rawTagName ?? '') && parent.getAttribute('role') !== 'main') parent = parent.parentNode;
      if (node.rawTagName?.toLowerCase() !== 'header' || !parent) node.remove();
    }
  }
  const text = cleanText(nodeText(root));
  return { root, title, text, rawText, contact: [...new Set(contacts)].join(' · ').slice(0, 180), hours };
}
export function textBlocks(text: string) {
  // Match the catalog reading-block bounds without dropping a paragraph's tail.
  const maxCharacters = 8000, maxBlocks = 24;
  type Block = { kind: 'paragraph' | 'heading'; text: string };
  const runs: Block[] = [];
  for (const line of text.split('\n').map(s => s.trim()).filter(Boolean)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const kind = heading ? 'heading' : 'paragraph'; const value = heading ? heading[2] : line;
    if (runs.at(-1)?.kind === 'paragraph' && kind === 'paragraph') runs.at(-1)!.text += `\n${value}`;
    else runs.push({ kind, text: value });
  }
  const chunk = ({ kind, text }: Block, preferBoundaries = true): Block[] => {
    const chunks: Block[] = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + maxCharacters, text.length);
      if (preferBoundaries && end < text.length) {
        // Separate rendered paragraphs should not split ordinary words/prices.
        // Keep enough capacity for the remaining text when near the schema cap.
        const earliestEnd = Math.max(start + 1, text.length - (maxBlocks - chunks.length - 1) * maxCharacters);
        const paragraphEnd = text.lastIndexOf('\n', end - 1) + 1;
        if (paragraphEnd >= earliestEnd) end = paragraphEnd;
        else {
          let wordEnd = end;
          while (wordEnd >= earliestEnd && !/\s/.test(text[wordEnd - 1])) wordEnd--;
          if (wordEnd >= earliestEnd) end = wordEnd;
        }
      }
      // Keep a Unicode surrogate pair together at a chunk boundary.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      chunks.push({ kind, text: text.slice(start, end) });
      start = end;
    }
    return chunks;
  };
  let blocks = runs.flatMap(run => chunk(run));
  // Excess heading boundaries can exceed the block count even for short pages.
  // Compact their complete text into paragraphs, keeping source line boundaries.
  if (blocks.length > maxBlocks) {
    const compact = { kind: 'paragraph' as const, text: runs.map(run => run.text).join('\n') };
    blocks = chunk(compact);
    // Preferred breaks can use capacity needed to keep a later surrogate pair
    // together. Check exact packing before declaring the source too large.
    if (blocks.length > maxBlocks) blocks = chunk(compact, false);
  }
  if (blocks.length > maxBlocks) throw new AppError('This webpage exceeds the 24 reading blocks of 8,000 characters. Split it into smaller pages; no partial text was imported.');
  return blocks.map((block, index) => ({ id: `block-${index}`, ...block }));
}
