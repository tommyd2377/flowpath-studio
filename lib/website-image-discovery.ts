import { assertPublicWebsiteUrl } from './website-fetch';
import { htmlToText } from './source-adapters';
import { parseHtml } from './html-document';
import { WEBSITE_LIMITS, type WebsiteImage } from './website-import-model';

const asciiWhitespace = /[\t\n\f\r ]/;
/** URL tokens can contain commas; only trailing commas and descriptor separators
 * delimit candidates. Keep malformed descriptor groups out of discovery.
 * https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute */
function responsiveCandidates(input: string): { url: string; rank: number }[] {
  const candidates: { url: string; rank: number }[] = [];
  let position = 0;
  while (position < input.length) {
    while (position < input.length && (asciiWhitespace.test(input[position]) || input[position] === ',')) position++;
    const start = position;
    while (position < input.length && !asciiWhitespace.test(input[position])) position++;
    let url = input.slice(start, position);
    if (!url) break;
    const descriptors: string[] = [];
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      let descriptor = '', inParens = false;
      while (position < input.length) {
        const character = input[position++];
        if (!inParens && (asciiWhitespace.test(character) || character === ',')) {
          if (descriptor) descriptors.push(descriptor);
          descriptor = '';
          if (character === ',') break;
        } else {
          descriptor += character;
          if (character === '(') inParens = true;
          else if (character === ')') inParens = false;
        }
      }
      if (descriptor) descriptors.push(descriptor);
    }
    let width: number | undefined, density: number | undefined, height: number | undefined, invalid = false;
    for (const descriptor of descriptors) {
      const integer = /^(\d+)([wh])$/.exec(descriptor);
      const floating = /^(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)x$/.exec(descriptor);
      if (integer) {
        const value = Number(integer[1]);
        if (!Number.isFinite(value) || value <= 0 || density !== undefined) invalid = true;
        if (integer[2] === 'w') { if (width !== undefined) invalid = true; width = value; }
        else { if (height !== undefined) invalid = true; height = value; }
      } else if (floating) {
        const value = Number(floating[1]);
        if (!Number.isFinite(value) || value < 0 || width !== undefined || height !== undefined || density !== undefined) invalid = true;
        density = value;
      } else invalid = true;
    }
    if (height !== undefined && width === undefined) invalid = true;
    if (url && !invalid) candidates.push({ url, rank: width ?? density ?? 1 });
  }
  return candidates;
}

/** Bounded original candidates for common builders; download validation decides what exists. */
export function originalImageCandidates(value: string, pageUrl: string): string[] {
  const url = new URL(value), candidates: string[] = [];
  if (url.hostname.endsWith('.wixstatic.com') && url.pathname.includes('/v1/')) {
    const original = new URL(url); original.pathname = original.pathname.split('/v1/')[0]; original.search = ''; candidates.push(original.toString());
  }
  if (url.hostname.endsWith('.squarespace-cdn.com') || url.hostname.endsWith('.assetcdn.net')) {
    const original = new URL(url);
    for (const key of ['format', 'width', 'height', 'w', 'h', 'quality', 'lossy', 'strip', 'webp', 'fit', 'crop']) original.searchParams.delete(key);
    if (original.toString() !== value) candidates.push(original.toString());
  }
  const wordpress = url.pathname.indexOf('/wp-content/uploads/');
  if (wordpress >= 0) {
    const original = new URL(url.pathname.slice(wordpress), new URL(pageUrl).origin);
    original.pathname = original.pathname.replace(/-\d+x\d+(?=\.(?:png|jpe?g|webp)$)/i, '');
    if (original.toString() !== value) candidates.unshift(original.toString());
  }
  return candidates;
}

/** Static references only: never execute scripts or follow external stylesheets. */
export function extractWebsiteImages(html: string, pageUrl: string): WebsiteImage[] {
  const images = new Map<string, WebsiteImage>();
  const text = (value: string) => htmlToText(value, { allowEmpty: true }).trim();
  const add = (value: string, alt = '', alternatives: string[] = []) => {
    try {
      if (!value.trim() || images.size >= WEBSITE_LIMITS.images) return;
      const url = assertPublicWebsiteUrl(new URL(text(value), pageUrl).toString()).toString();
      const variants = [...new Set([url, ...alternatives.flatMap(value => {
        try { return value.trim() ? [assertPublicWebsiteUrl(new URL(text(value), pageUrl).toString()).toString()] : []; } catch { return []; }
      })])].slice(0, 8);
      if (!images.has(url)) images.set(url, { url, pageUrl, alt: alt.slice(0, 1000), variants });
    } catch { /* Unsupported URLs are not fetch candidates. */ }
  };
  const document = parseHtml(html);
  for (const node of document.querySelectorAll('script,template')) node.remove();
  for (const node of document.querySelectorAll('img,source,meta')) {
    const a = node.attributes;
    if (node.rawTagName?.toLowerCase() === 'meta') { if (['og:image', 'og:image:url', 'twitter:image'].includes(a.property || a.name)) add(a.content || ''); continue; }
    const hiddenPixel = node.rawTagName?.toLowerCase() === 'img' && /^0*1$/.test(a.width?.trim() ?? '') && /^0*1$/.test(a.height?.trim() ?? '')
      && (a.hidden !== undefined || a['aria-hidden']?.toLowerCase() === 'true' || /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/i.test(a.style ?? ''));
    if (hiddenPixel) continue;
    const responsive = [a['data-srcset'], a.srcset].filter(Boolean).flatMap(responsiveCandidates)
      .filter(entry => { try { assertPublicWebsiteUrl(new URL(text(entry.url), pageUrl).toString()); return true; } catch { return false; } })
      .sort((a, b) => b.rank - a.rank).map(entry => entry.url);
    // Explicit originals first; reserve room for src/lazy URLs whose true dimensions may exceed srcset.
    const variants = [...new Set([a['data-original'], a['data-full-src'], a['data-src'], a['data-lazy-src'], a.src, ...responsive.slice(0, 3)].filter(Boolean))];
    const preferred = a['data-original'] || a['data-full-src'] || responsive[0] || a['data-src'] || a['data-lazy-src'] || a.src || '';
    add(preferred, a.alt || '', variants);

  }
  for (const match of document.innerHTML.matchAll(/background(?:-image)?\s*:[^;}<>]*?url\(\s*(['"]?)(.*?)\1\s*\)/gi)) add(match[2]);
  return [...images.values()];
}
