import { createRequire } from 'node:module';

/** The parser bundled with our pinned Next dependency; no browser/script execution. */
export type HtmlNode = { nodeType: number; rawTagName?: string; text: string; rawText: string; innerHTML: string; outerHTML: string; childNodes: HtmlNode[]; parentNode?: HtmlNode;
  attributes: Record<string, string>; getAttribute(name: string): string | undefined; setAttribute(name: string, value: string): void; removeAttribute(name: string): void;
  querySelector(selector: string): HtmlNode | null; querySelectorAll(selector: string): HtmlNode[]; remove(): void; set_content(value: string): void };
const parser = createRequire(import.meta.url)('next/dist/compiled/node-html-parser') as { parse(html: string, options?: Record<string, unknown>): HtmlNode };
export const parseHtml = (html: string) => parser.parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: true } });
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
export function htmlDocument(html: string, stripChrome = true) {
  const root = parseHtml(html), title = root.querySelector('title')?.text.trim() ?? '';
  for (const node of root.querySelectorAll('script,style,noscript,template,svg')) node.remove();
  const rawText = cleanText(nodeText(root));
  const contacts = root.querySelectorAll('a[href]').flatMap(node => /^(?:tel:|mailto:)/i.test(node.getAttribute('href') ?? '') ? [(node.getAttribute('href') ?? '').replace(/^(?:tel:|mailto:)/i, '').split('?')[0]] : []);
  const footerText = root.querySelectorAll('footer,[data-elementor-type="footer"],[role="contentinfo"]').map(node => cleanText(nodeText(node))).join('\n');
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
  if (stripChrome) for (const node of root.querySelectorAll('nav,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[data-elementor-type="header"],[data-elementor-type="footer"]')) node.remove();
  const text = cleanText(nodeText(root));
  return { root, title, text, rawText, contact: [...new Set(contacts)].join(' · ').slice(0, 180), hours };
}
export function textBlocks(text: string) {
  const blocks: { id: string; kind: 'paragraph' | 'heading'; text: string }[] = [];
  for (const line of text.split('\n').map(s => s.trim()).filter(Boolean)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const kind = heading ? 'heading' : 'paragraph'; const value = heading ? heading[2] : line;
    if (blocks.length && blocks.at(-1)!.kind === 'paragraph' && kind === 'paragraph' && blocks.at(-1)!.text.length + value.length < 7900) blocks.at(-1)!.text += `\n${value}`;
    else blocks.push({ id: `block-${blocks.length}`, kind, text: value.slice(0, 8000) });
  }
  // Preserve the remainder in a bounded last paragraph instead of silently losing long documents.
  return blocks.length <= 24 ? blocks : [...blocks.slice(0, 23), { id: 'block-rest', kind: 'paragraph' as const, text: blocks.slice(23).map(b => b.text).join('\n').slice(0, 8000) }];
}
