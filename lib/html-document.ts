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
/** Webflow puts alternate form results beside the form, not inside it. Only
 * remove its exact direct-child state panels beside an actual form. */
function removeFormFeedback(root: HtmlNode) {
  for (const wrapper of root.querySelectorAll('.w-form')) {
    if (!wrapper.childNodes.some(node => node.rawTagName?.toLowerCase() === 'form')) continue;
    for (const node of [...wrapper.childNodes]) {
      if (node.nodeType !== 1) continue;
      const classes = (node.getAttribute('class') ?? '').split(/\s+/);
      if (classes.includes('w-form-done') || classes.includes('w-form-fail')) node.remove();
    }
  }
}
const assistiveClasses = new Set(['sr-only', 'visually-hidden', 'screen-reader-text', 'screen-reader-only']);
const classTokens = (node: HtmlNode) => (node.getAttribute('class') ?? '').split(/\s+/);
const assistiveOnly = (node: HtmlNode) => classTokens(node).some(value => assistiveClasses.has(value));
/** Headline eligibility is separate from evidence retention: visually hidden
 * qualifications still belong in the text, even when they are not a hero. */
function visiblePageHeading(root: HtmlNode) {
  const main = root.querySelector('main,[role="main"]');
  const eligible = (node: HtmlNode) => {
    for (let current: HtmlNode | undefined = node; current; current = current.parentNode) {
      if (assistiveOnly(current) || current.getAttribute('hidden') !== undefined || current.getAttribute('aria-hidden') === 'true'
        || /^(?:nav|aside|footer|form|button|template|pre|code|blockquote)$/i.test(current.rawTagName ?? '')
        || /^(?:navigation|contentinfo|button)$/i.test(current.getAttribute('role') ?? '')
        || current.getAttribute('data-elementor-type') === 'footer'
        || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(current.getAttribute('style') ?? '')) return false;
    }
    return Boolean(cleanText(nodeText(node)).replace(/^#{1,6}\s*/, '').trim());
  };
  const scope = main ?? root;
  const heading = scope.querySelectorAll('h1').find(eligible)
    ?? (main ? scope.querySelectorAll('h2,h3,h4,h5,h6').find(eligible) : undefined);
  return heading ? cleanText(nodeText(heading)).replace(/^#{1,6}\s*/, '').trim() : '';
}
function skipLinkTargets(root: HtmlNode) {
  return new Set(root.querySelectorAll('a[href]').flatMap(link => {
    const href = link.getAttribute('href') ?? '';
    const label = (link.getAttribute('aria-label') || link.text).trim();
    if (!href.startsWith('#') || !/^skip (?:to )?(?:the )?(?:main )?content$/i.test(label)) return [];
    try { return [decodeURIComponent(href.slice(1))]; } catch { return []; }
  }));
}
/** Remove only complete, explicitly assistive interface labels. Never delete a
 * whole accessibility class, gallery, caption, or a label with qualifications. */
function removeAccessibleChrome(root: HtmlNode, skipTargets: Set<string>) {
  const main = root.querySelector('main,[role="main"]');
  if (main && visiblePageHeading(root)) {
    for (const heading of main.childNodes) {
      if (heading.rawTagName?.toLowerCase() === 'h1' && assistiveOnly(heading) && /^(?:home|homepage)$/i.test(heading.text.trim())) heading.remove();
    }
  }
  for (const node of root.querySelectorAll('span')) {
    if (!assistiveOnly(node) || node.childNodes.some(child => child.nodeType === 1)) continue;
    const label = node.text.trim().replace(/\s+/g, ' ');
    if (skipTargets.has(node.getAttribute('id') ?? '') && /^main content starts here, tab to start navigating\.?$/i.test(label)) {
      node.remove(); continue;
    }
    const counter = /^slide ([1-9]\d*) of ([1-9]\d*)$/i.exec(label);
    if (!counter || Number(counter[1]) > Number(counter[2])) continue;
    for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
      if (classTokens(ancestor).some(value => ['gallery', 'carousel', 'slideshow'].includes(value))
        || /^(?:gallery|carousel|slideshow)$/i.test(ancestor.getAttribute('aria-roledescription') ?? '')) {
        node.remove(); break;
      }
    }
  }
}
const footerSelector = 'footer,[data-elementor-type="footer"],[role="contentinfo"]';
const genericMetadataHeading = /^(?:(?:(?:opening|business|store|operating) )?hours|contact(?: us)?|find us|visit(?: us)?|about this site|search|quick links)$/i;
/** A nearby named heading may be a location. Keep its values out of a flattened
 * combined summary rather than assuming they describe the same location. */
function scopedMetadata(node: HtmlNode) {
  for (let child: HtmlNode = node; child.parentNode; child = child.parentNode) {
    const siblings = child.parentNode.childNodes;
    for (const sibling of siblings.slice(0, siblings.indexOf(child)).reverse()) {
      const heading = /^h[2-6]$/i.test(sibling.rawTagName ?? '') ? sibling
        : sibling.rawTagName?.toLowerCase() === 'header' ? sibling.querySelector('h2,h3,h4,h5,h6') : null;
      if (heading) {
        const label = heading.text.trim().replace(/:$/, '');
        if (!genericMetadataHeading.test(label)) return true;
      }
    }
    if (/^(?:section|article|footer)$/i.test(child.parentNode.rawTagName ?? '')) break;
  }
  return false;
}
/** Only explicit labels in one visible authored block. Do not scan neighboring
 * prose for numbers/days or detach a qualifier from its phone/schedule. */
function inlineContactHours(root: HtmlNode) {
  const phones = new Set<string>(), schedules = new Set<string>();
  let scopedPhone = false, scopedSchedule = false;
  const eligible = (node: HtmlNode) => {
    for (let current: HtmlNode | undefined = node; current; current = current.parentNode) {
      if (current.getAttribute('hidden') !== undefined || current.getAttribute('aria-hidden') === 'true'
        || /^(?:form|nav|select|button|input|textarea|pre|code|blockquote)$/i.test(current.rawTagName ?? '')
        || current.getAttribute('role') === 'navigation') return false;
    }
    return !node.querySelector('p,div,section,article,li,address,h1,h2,h3,h4,h5,h6,[hidden],[aria-hidden="true"],form,nav,select,button,input,textarea,pre,code,blockquote,[role="navigation"]');
  };
  for (const node of root.querySelectorAll('p,div,li,address')) {
    if (!eligible(node)) continue;
    const lines = cleanText(nodeText(node)).split('\n');
    const phone = /^(?:tel(?:ephone)?|phone)(?: number)?\s*:\s*(.*)$/i.exec(lines[0]);
    if (phone) {
      const value = [phone[1], ...lines.slice(1)].filter(Boolean).join(' ');
      const number = /^(\+?[\d(][\d(). -]{5,}\d)(?:\b|\s|$)/.exec(value)?.[1];
      const anotherLabel = lines.slice(1).some(line => /^(?:(?:(?:opening|business|store|operating) )?hours|tel(?:ephone)?|phone|email|address)\s*:/i.test(line));
      if (!anotherLabel && number && number.replace(/\D/g, '').length >= 7 && number.replace(/\D/g, '').length <= 15) { phones.add(value); scopedPhone ||= scopedMetadata(node); }
    }
    const label = /^(?:(?:opening|business|store|operating) )?hours(?:\s*:\s*(.*))?$/i.exec(lines[0]);
    if (!label) continue;
    // Footer schedules already participate in the legacy path. Counting them
    // again as a second inline location would hide an otherwise useful summary.
    let ancestor: HtmlNode | undefined = node;
    while (ancestor && ancestor.rawTagName?.toLowerCase() !== 'footer' && ancestor.getAttribute('role') !== 'contentinfo' && ancestor.getAttribute('data-elementor-type') !== 'footer') ancestor = ancestor.parentNode;
    if (ancestor) continue;
    const schedule = [label[1], ...lines.slice(1)].filter((line): line is string => Boolean(line));
    const days = /\b(?:weekdays?|weekends?|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)\b/i;
    const timing = /\b(?:closed|open|appointment)\b|\d\s*(?:am|pm)\b|\d\s*[-–—]\s*\d|\d{1,2}:\d{2}/i;
    // Another label/heading in this block is a boundary, not permission to
    // silently cut the schedule or its later qualifications.
    if (schedule.some(line => /^(?:#{1,6}\s|(?:tel(?:ephone)?|phone|email|address)\s*:)/i.test(line))) continue;
    if (schedule.some(line => days.test(line) && timing.test(line))) { schedules.add(schedule.join('; ')); scopedSchedule ||= scopedMetadata(node); }
  }
  return { phones: [...phones], schedules: [...schedules], scopedPhone, scopedSchedule };
}
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
  removeFormFeedback(root);
  const contacts = root.querySelectorAll('a[href]').flatMap(node => /^(?:tel:|mailto:)/i.test(node.getAttribute('href') ?? '') ? [(node.getAttribute('href') ?? '').replace(/^(?:tel:|mailto:)/i, '').split('?')[0]] : []);
  const scopedLink = root.querySelectorAll('a[href]').some(node => /^(?:tel:|mailto:)/i.test(node.getAttribute('href') ?? '') && scopedMetadata(node));
  const inline = inlineContactHours(root);
  const footerText = root.querySelectorAll(footerSelector).map(node => cleanText(nodeText(node))).join('\n');
  const dayLines = (text:string) => cleanText(text).split('\n').filter(line=>/(?:mon|tues|wednes|thurs|fri|satur|sun)day/i.test(line));
  let hourLines = dayLines(footerText);
  let scopedHours = root.querySelectorAll(footerSelector).some(footer => footer.querySelectorAll('h2,h3,h4,h5,h6').some(heading => !genericMetadataHeading.test(heading.text.trim().replace(/:$/, ''))));
  if(!hourLines.length)for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    if(!/^(?:opening |business |store |operating )?hours$/i.test(heading.text.trim()))continue;
    let section=heading.parentNode;
    for(let depth=0;section&&depth<3;depth++,section=section.parentNode){const lines=dayLines(nodeText(section));if(lines.length){hourLines=lines;scopedHours=scopedMetadata(heading);break;}}
    if(hourLines.length)break;
  }
  const legacyHours = [...new Set(hourLines)].join('; ').slice(0,180);
  // Keep the existing heading/footer path. An inline schedule adds complete
  // literal evidence, including closed days, without resolving conflicts.
  const combinedHours = [...new Set([...hourLines, ...inline.schedules])].join('; ');
  const inlineHourLines = new Set(inline.schedules.flatMap(schedule => schedule.split('; ')));
  const distinctHours = hourLines.some(line => !inlineHourLines.has(line.replace(/^(?:(?:opening|business|store|operating) )?hours\s*:\s*/i, '')));
  const mixedHoursScope = distinctHours && (inline.scopedSchedule || scopedHours);
  const hours = inline.schedules.length ? inline.schedules.length === 1 && !mixedHoursScope && combinedHours.length <= 180 ? combinedHours : '' : legacyHours;
  const barePhone = (value: string) => /^[+\d(). -]+$/.test(value) ? value.replace(/[(). -]/g, '') : value;
  const additionalPhones = inline.phones.filter(phone => !contacts.some(contact => barePhone(contact) === barePhone(phone)));
  const combinedContacts = [...new Set([...contacts, ...additionalPhones])].join(' · ');
  const mixedContactScope = contacts.length > 0 && additionalPhones.length > 0 && (inline.scopedPhone || scopedLink);
  const contact = inline.phones.length ? inline.phones.length === 1 && !mixedContactScope && combinedContacts.length <= 180 ? combinedContacts : '' : [...new Set(contacts)].join(' · ').slice(0,180);
  for (const node of root.querySelectorAll('title,head,form,select,button,input,textarea,[hidden],[aria-hidden="true"]')) node.remove();
  if (stripChrome) {
    const skipTargets = skipLinkTargets(root);
    retainFooterInformation(root);
    for (const node of root.querySelectorAll('nav,[role="navigation"]')) node.remove();
    for (const node of root.querySelectorAll('header,[role="banner"],[data-elementor-type="header"]')) {
      // A section/article header is content, including its qualifications and introduction.
      // Only the outer site header is chrome; do not lose a main page's hero prose.
      let parent = node.parentNode;
      while (parent && !/^(?:main|article|section)$/i.test(parent.rawTagName ?? '') && parent.getAttribute('role') !== 'main') parent = parent.parentNode;
      if (node.rawTagName?.toLowerCase() !== 'header' || !parent) node.remove();
    }
    removeAccessibleChrome(root, skipTargets);
  }
  const text = cleanText(nodeText(root));
  return { root, title, text, rawText, contact, hours, headline: visiblePageHeading(root) };
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
