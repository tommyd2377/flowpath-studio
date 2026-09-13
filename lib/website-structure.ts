import { createHash, randomUUID } from 'node:crypto';
import { validateCatalog, type KnowledgeCatalog, type CatalogEntity, type AttributeDefinition } from '@thevoice/platform-ui/contracts';
import type { ExtractedWebsitePage } from './website-import';

const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
/** Explicit price headings/tiers only. No inferred stock, booking or ordering capability. */
export function websiteOfferings(pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[]) {
  const entities: CatalogEntity[] = [], attributes = new Map<string, AttributeDefinition>(), groups = new Map<string, string[]>();
  let pricedLines = 0, unmatched = 0;
  for (const page of pages) {
    const lines = page.text.split('\n').filter(Boolean).flatMap(line=>{const multi=/^(#{1,6})\s+(.+?)\s*~\s*(.+)$/.exec(line);if(!multi||!multi[3].includes('|'))return [line];const variants=multi[3].split('|').map(s=>s.trim());return variants.every(s=>/^[^$£€]+[-–]\s*[$£€]\s*\d+(?:\.\d+)?$/.test(s))?variants.map(s=>`${multi[1]} ${multi[2]} · ${s}`):[line];}), stack: { level: number; title: string; price?: number; currency?: string; literal?: string }[] = [];
    for (let index = 0; index < lines.length; index++) {
      const match = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
      if (!match) { if (/[$£€]\s*\d/.test(lines[index])) { pricedLines++; unmatched++; } continue; }
      const level = match[1].length, title = match[2].trim();
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      const prices = [...title.matchAll(/([$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)/g)];
      if (prices.length) pricedLines++;
      const nextHeading = lines.slice(index + 1).find(line => /^#{1,6}\s/.test(line));
      const tier = prices.length === 1 && !!nextHeading && /^#+/.exec(nextHeading)![0].length > level;
      const inherited = [...stack].reverse().find(item => item.price !== undefined);
      const currency = prices.length === 1 ? ({ '$': 'USD', '£': 'GBP', '€': 'EUR' }[prices[0][1]]!) : inherited?.currency;
      const price = prices.length === 1 ? Number(prices[0][2].replaceAll(',', '')) : !prices.length ? inherited?.price : undefined;
      const category = stack.filter(item => item.price === undefined).map(item => item.title).slice(-2).join(' / ');
      if (tier) { stack.push({ level, title, price, currency, literal: title }); continue; }
      if (price !== undefined && currency && Number.isFinite(price)) {
        if (entities.length >= 70) { unmatched++; continue; }
        const label = prices.length ? title.slice(0, prices[0].index).replace(/[~–—:\-\s]+$/, '').replace(/\b(?:starting at|from)\s*$/i, '').replace(/[~–—:\-\s]+$/, '').trim() : title;
        if (!label) { unmatched++; continue; }
        const name = (/^[\d\W]/.test(label) && category ? `${category.split(' / ').at(-1)} · ${label}` : label).slice(0, 160);
        const priceId = `source_price_${currency.toLowerCase()}`;
        attributes.set(priceId, { id: priceId, label: `Listed price (${currency})`, type: 'money', currency });
        attributes.set('source_category', { id: 'source_category', label: 'Source category', type: 'text' });
        attributes.set('source_price_terms', { id: 'source_price_terms', label: 'Price / size terms', type: 'text' });
        const id = `offering-${key(`${page.url}:${category}:${title}`)}`;
        const priceText = prices.length ? title : inherited!.literal!;
        const following: string[] = [];
        for (let after=index+1; after<lines.length&&!/^#{1,6}\s/.test(lines[after]); after++) if(/available|starting price|additional charges|advance|subject to change/i.test(lines[after])) following.push(lines[after]);
        const footnotes = priceText.includes('*') ? lines.filter(line=>/^\*.*(?:starting price|additional charges)/i.test(line)) : [];
        const literal = [...new Set([priceText,...following,...footnotes])].join(' ').slice(0,1000);
        entities.push({ id, kind: 'offering', name, summary: `${category ? category + '. ' : ''}${literal}. Listed information; availability is not verified.`.slice(0, 1600),
          attributes: { [priceId]: price, source_category: category, source_price_terms: literal },
          identifiers: [{ scheme: 'publisher-id', value: key(`${page.url}:${category}:${title}`) }] });
        const group = category || 'Offerings'; groups.set(group, [...groups.get(group) ?? [], id]);
      } else if (prices.length) unmatched++;
      stack.push({ level, title });
    }
  }
  return { entities: [...new Map(entities.map(e => [e.id,e])).values()], attributes: [...attributes.values()], collections: [...groups].slice(0, 12).map(([name, entityIds]) => ({ id: `offering-group-${key(name)}`, name: name.slice(0, 160), entityIds })),
    notes: [`Source coverage: ${pricedLines} price-bearing lines; ${entities.length} structured offerings; ${unmatched} price-bearing lines need manual review.`,
      ...(unmatched ? ['Some ranges, multiple prices, or prose could not be mapped conservatively. Review the captured source before publishing.'] : [])] };
}

export function addWebsiteOfferings(catalog: KnowledgeCatalog, pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[]) {
  const extracted = websiteOfferings(pages);
  // Provider-owned identities are never name-merged. A scoped deterministic source ID makes repeat repair idempotent.
  const existing = new Set(catalog.entities.map(e => e.id));
  const represented = (e: CatalogEntity) => catalog.entities.some(other => other.name.normalize('NFKC').toLowerCase() === e.name.normalize('NFKC').toLowerCase() && Object.entries(e.attributes).some(([key, value]) => key.startsWith('source_price_') && catalog.attributes.some(def => def.type === 'money' && def.currency === key.slice(-3).toUpperCase() && other.attributes[def.id] === value)));
  const missing = extracted.entities.filter(e => !existing.has(e.id) && !represented(e));
  const additions = missing.slice(0, 100 - catalog.entities.length);
  const ids = new Set([...existing, ...additions.map(e => e.id)]);
  const attributes = [...catalog.attributes, ...extracted.attributes.filter(a => !catalog.attributes.some(b => b.id === a.id))];
  const collections = [...catalog.collections, ...extracted.collections.filter(g => !catalog.collections.some(c => c.id === g.id)).map(g => ({ ...g, entityIds: g.entityIds.filter(id => ids.has(id)) })).filter(g => g.entityIds.length)].slice(0, 24);
  return { catalog: validateCatalog({ ...catalog, id: catalog.id || randomUUID(), entities: [...catalog.entities, ...additions], attributes, collections }),
    notes: [...extracted.notes, ...(additions.length < missing.length ? ['The 100-item catalog limit was reached. Some offerings remain in source evidence only; split or review the import.'] : [])] };
}
