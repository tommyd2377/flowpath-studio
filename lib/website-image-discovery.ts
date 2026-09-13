import { assertPublicWebsiteUrl } from './website-fetch';
import { htmlToText } from './source-adapters';
import { parseHtml } from './html-document';
import { WEBSITE_LIMITS, type WebsiteImage } from './website-import-model';

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
    const responsive = [a['data-srcset'], a.srcset].filter(Boolean).flatMap(value => value.split(',').map(entry => entry.trim().split(/\s+/)))
      .filter(entry => entry[0] && !entry[0].startsWith('data:'))
      .sort((a, b) => parseFloat(b[1] || '1') - parseFloat(a[1] || '1')).map(entry => entry[0]);
    // Explicit originals first; reserve room for src/lazy URLs whose true dimensions may exceed srcset.
    const variants = [...new Set([a['data-original'], a['data-full-src'], a['data-src'], a['data-lazy-src'], a.src, ...responsive.slice(0, 3)].filter(Boolean))];
    const preferred = a['data-original'] || a['data-full-src'] || responsive[0] || a['data-src'] || a['data-lazy-src'] || a.src || '';
    add(preferred, a.alt || '', variants);

  }
  for (const match of document.innerHTML.matchAll(/background(?:-image)?\s*:[^;}<>]*?url\(\s*(['"]?)(.*?)\1\s*\)/gi)) add(match[2]);
  return [...images.values()];
}
