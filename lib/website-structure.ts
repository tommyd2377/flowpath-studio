import { createHash, randomUUID } from 'node:crypto';
import { validateCatalog, type KnowledgeCatalog, type CatalogEntity, type AttributeDefinition } from '@thevoice/platform-ui/contracts';
import type { ExtractedWebsitePage } from './website-import';
import { AppError } from './errors';

const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const currencyCode = (symbol: string) => ({ '$': 'USD', '£': 'GBP', '€': 'EUR' }[symbol]!);
type ListedPrice = { price: number; currency: string; unit?: string };
/** Only a complete, immediately adjacent price line establishes an item's prices. */
function adjacentPrices(line: string): ListedPrice[] {
  const labeled = /([\p{L}\p{N}][\p{L}\p{N} /()-]{0,31}?)\s*:\s*([$£€])\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gu;
  const matches = [...line.matchAll(labeled)];
  if (matches.length && !line.replace(labeled, '').replace(/[\s,;|*]/g, '')) {
    const prices = matches.map(match => ({ price: Number(match[3].replaceAll(',', '')), currency: currencyCode(match[2]), unit: match[1].trim() }));
    // Repeated unit labels or malformed numbers are ambiguous, even when their amounts agree.
    return new Set(prices.map(price => price.unit.toLowerCase())).size === prices.length && prices.every(price => Number.isFinite(price.price)) ? prices : [];
  }
  const single = /^(?:(?:starting at|from)\s+)?([$£€])\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*\*|\s+(?:plus|per)\s+[^$£€]+)?$/i.exec(line);
  return single ? [{ price: Number(single[2].replaceAll(',', '')), currency: currencyCode(single[1]) }] : [];
}
const priceField = (price: ListedPrice) => `source_price_${price.unit ? `${key(price.unit.toLowerCase())}_` : ''}${price.currency.toLowerCase()}`;
export type WebsiteOfferingEvidence = { entityId: string; pageUrl: string; fields: { field: string; lineStart: number; lineEnd: number; excerpt: string }[] };
type OfferingOptions = { strict?: boolean };
/** Explicit price headings/tiers and adjacent prices only. No inferred stock, booking or ordering capability. */
export function websiteOfferings(pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[], options: OfferingOptions = {}) {
  const entities: CatalogEntity[] = [], attributes = new Map<string, AttributeDefinition>(), groups = new Map<string, string[]>();
  const evidence: WebsiteOfferingEvidence[] = [], issues: string[] = [];
  const limit = (message: string) => { if (options.strict) throw new AppError(message); if (!issues.includes(message)) issues.push(message); };
  let pricedLines = 0, unmatched = 0;
  for (const page of pages) {
    const sourceLines = page.text.split('\n');
    const records = sourceLines.flatMap((raw, sourceIndex) => {
      const line = raw.trim(); if (!line) return [];
      const multi = /^(#{1,6})\s+(.+?)\s*~\s*(.+)$/.exec(line);
      const variants = multi?.[3].split('|').map(s => s.trim());
      const values = multi && variants && variants.length > 1 && variants.every(s => /^[^$£€]+[-–]\s*[$£€]\s*\d+(?:\.\d+)?$/.test(s)) ? variants.map(s => `${multi[1]} ${multi[2]} · ${s}`) : [line];
      return values.map(text => ({ text, sourceIndex }));
    });
    const lines = records.map(record => record.text), stack: { level: number; title: string; index: number; price?: number; currency?: string; literal?: string }[] = [];
    const sourceField = (field: string, start: number, end = start) => ({ field, lineStart: records[start].sourceIndex + 1, lineEnd: records[end].sourceIndex + 1, excerpt: sourceLines.slice(records[start].sourceIndex, records[end].sourceIndex + 1).join('\n') });
    const capturedPriceLines = new Set<number>();
    for (let index = 0; index < lines.length; index++) {
      const match = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
      if (!match) { if (/[$£€]\s*\d/.test(lines[index]) && !capturedPriceLines.has(index)) { pricedLines++; unmatched++; } continue; }
      const level = match[1].length, title = match[2].trim();
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      const prices = [...title.matchAll(/([$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)/g)];
      if (prices.length) pricedLines++;
      const adjacent = !prices.length && lines[index + 1] && !/^#{1,6}\s/.test(lines[index + 1]) ? adjacentPrices(lines[index + 1]) : [];
      if (adjacent.length) {
        const category = stack.filter(item => item.price === undefined).map(item => item.title).slice(-2).join(' / ');
        const fields: AttributeDefinition[] = adjacent.map(price => ({ id: priceField(price), label: `Listed ${price.unit ? price.unit + ' ' : ''}price (${price.currency})`, type: 'money', currency: price.currency, ...(price.unit ? { unit: price.unit } : {}) }));
        if (entities.length < 70 && new Set([...attributes.keys(), 'source_category', 'source_price_terms', ...fields.map(field => field.id)]).size <= 24) {
          const following: string[] = [];
          for (let after = index + 2; after < lines.length && !/^#{1,6}\s/.test(lines[after]); after++) following.push(lines[after]);
          const footnoteIndexes = lines[index + 1].includes('*') ? lines.flatMap((line, at) => /^\*.*(?:starting price|additional charges)/i.test(line) ? [at] : []) : [];
          const literal = [...new Set([title, lines[index + 1], ...following, ...footnoteIndexes.map(at => lines[at])])].join(' ');
          if (literal.length > 1000 || title.length > 160 || category.length > 400) { limit('Some offering names or descriptions exceed the catalog field limits. Split or review the import; no truncated offering was accepted.'); stack.push({ level, title, index }); continue; }
          for (const field of fields) attributes.set(field.id, field);
          attributes.set('source_category', { id: 'source_category', label: 'Source category', type: 'text' });
          attributes.set('source_price_terms', { id: 'source_price_terms', label: 'Price / size terms', type: 'text' });
          const id = `offering-${key(`${page.url}:${category}:${title}`)}`;
          entities.push({ id, kind: 'offering', name: title.slice(0, 160), summary: `${category ? category + '. ' : ''}${literal}${/[.!?]$/.test(literal) ? '' : '.'} Listed information; availability is not verified.`.slice(0, 1600),
            attributes: { ...Object.fromEntries(adjacent.map(price => [priceField(price), price.price])), source_category: category, source_price_terms: literal },
            identifiers: [{ scheme: 'publisher-id', value: key(`${page.url}:${category}:${title}`) }] });
          const group = category || 'Offerings'; groups.set(group, [...groups.get(group) ?? [], id]);
          evidence.push({ entityId: id, pageUrl: page.url, fields: [sourceField('name', index), ...fields.map(field => sourceField(`attributes.${field.id}`, index + 1)),
            ...stack.filter(item => item.price === undefined).slice(-2).map(item => sourceField('attributes.source_category', item.index)),
            sourceField('attributes.source_price_terms', index, index + 1 + following.length), ...footnoteIndexes.map(at => sourceField('attributes.source_price_terms', at))] });
          capturedPriceLines.add(index + 1); pricedLines++;
        } else limit('The structured offering or attribute limit was reached. Split or review the import; some offerings remain in source evidence only.');
        stack.push({ level, title, index });
        continue;
      }
      const nextHeading = lines.slice(index + 1).find(line => /^#{1,6}\s/.test(line));
      const tier = prices.length === 1 && !!nextHeading && /^#+/.exec(nextHeading)![0].length > level;
      const inherited = [...stack].reverse().find(item => item.price !== undefined);
      const currency = prices.length === 1 ? currencyCode(prices[0][1]) : inherited?.currency;
      const price = prices.length === 1 ? Number(prices[0][2].replaceAll(',', '')) : !prices.length ? inherited?.price : undefined;
      const category = stack.filter(item => item.price === undefined).map(item => item.title).slice(-2).join(' / ');
      if (tier) { stack.push({ level, title, index, price, currency, literal: title }); continue; }
      if (price !== undefined && currency && Number.isFinite(price)) {
        if (entities.length >= 70) { limit('The 70-item structured offering limit was reached. Split or review the import.'); unmatched++; continue; }
        const label = prices.length ? title.slice(0, prices[0].index).replace(/[~–—:\-\s]+$/, '').replace(/\b(?:starting at|from)\s*$/i, '').replace(/[~–—:\-\s]+$/, '').trim() : title;
        if (!label) { unmatched++; continue; }
        const name = /^[\d\W]/.test(label) && category ? `${category.split(' / ').at(-1)} · ${label}` : label;
        const priceId = `source_price_${currency.toLowerCase()}`;
        if (new Set([...attributes.keys(), 'source_category', 'source_price_terms', priceId]).size > 24) { limit('The 24-field structured offering limit was reached. Split or review the import.'); unmatched++; continue; }
        attributes.set(priceId, { id: priceId, label: `Listed price (${currency})`, type: 'money', currency });
        attributes.set('source_category', { id: 'source_category', label: 'Source category', type: 'text' });
        attributes.set('source_price_terms', { id: 'source_price_terms', label: 'Price / size terms', type: 'text' });
        const id = `offering-${key(`${page.url}:${category}:${title}`)}`;
        const priceText = prices.length ? title : inherited!.literal!;
        const followingIndexes: number[] = [];
        for (let after=index+1; after<lines.length&&!/^#{1,6}\s/.test(lines[after]); after++) followingIndexes.push(after);
        const footnoteIndexes = priceText.includes('*') ? lines.flatMap((line, at) => /^\*.*(?:starting price|additional charges)/i.test(line) ? [at] : []) : [];
        const literal = [...new Set([priceText,...followingIndexes.map(at => lines[at]),...footnoteIndexes.map(at => lines[at])])].join(' ');
        if (literal.length > 1000 || name.length > 160 || category.length > 400) { limit('Some offering names or descriptions exceed the catalog field limits. Split or review the import; no truncated offering was accepted.'); unmatched++; continue; }
        entities.push({ id, kind: 'offering', name, summary: `${category ? category + '. ' : ''}${literal}. Listed information; availability is not verified.`.slice(0, 1600),
          attributes: { [priceId]: price, source_category: category, source_price_terms: literal },
          identifiers: [{ scheme: 'publisher-id', value: key(`${page.url}:${category}:${title}`) }] });
        const group = category || 'Offerings'; groups.set(group, [...groups.get(group) ?? [], id]);
        const priceIndex = prices.length ? index : inherited!.index;
        evidence.push({ entityId: id, pageUrl: page.url, fields: [sourceField('name', index), sourceField(`attributes.${priceId}`, priceIndex),
          ...stack.filter(item => item.price === undefined).slice(-2).map(item => sourceField('attributes.source_category', item.index)),
          ...[priceIndex, ...followingIndexes, ...footnoteIndexes].map(at => sourceField('attributes.source_price_terms', at))] });
      } else if (prices.length) unmatched++;
      stack.push({ level, title, index });
    }
  }
  const unique = new Map<string, CatalogEntity>(), conflicts = new Set<string>();
  for (const entity of entities) {
    if (unique.has(entity.id) && JSON.stringify(unique.get(entity.id)) !== JSON.stringify(entity)) { limit('Conflicting source entries share an offering name and category. Review them before import; no price was selected automatically.'); conflicts.add(entity.id); }
    else unique.set(entity.id, entity);
  }
  for (const id of conflicts) { unique.delete(id); unmatched++; }
  if (groups.size > 12) limit('The 12-category structured offering limit was reached. Split or review the import.');
  return { entities: [...unique.values()], attributes: [...attributes.values()], evidence: evidence.filter(item => unique.has(item.entityId)), collections: [...groups].slice(0, 12).map(([name, entityIds]) => ({ id: `offering-group-${key(name)}`, name: name.slice(0, 160), entityIds: [...new Set(entityIds)].filter(id => unique.has(id)) })).filter(group => group.entityIds.length),
    notes: [`Source coverage: ${pricedLines} price-bearing lines; ${unique.size} structured offerings; ${unmatched} price-bearing lines need manual review.`, ...issues,
      ...(unmatched ? ['Some ranges, multiple prices, or prose could not be mapped conservatively. Review the captured source before publishing.'] : [])] };
}

export function addWebsiteOfferings(catalog: KnowledgeCatalog, pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[], options: OfferingOptions = {}) {
  const extracted = websiteOfferings(pages, options);
  // Provider-owned identities are never name-merged. A scoped deterministic source ID makes repeat repair idempotent.
  const existing = new Set(catalog.entities.map(e => e.id));
  const retainsSourceFields = (source: CatalogEntity, other: CatalogEntity) => other.name === source.name && other.kind === source.kind && other.summary === source.summary
    && Object.entries(source.attributes).every(([field, value]) => other.attributes[field] === value);
  if (options.strict) {
    for (const source of extracted.entities) {
      const collision = catalog.entities.find(entity => entity.id === source.id);
      if (collision && !retainsSourceFields(source, collision)) throw new AppError('Interpretation changed a reserved source offering ID. Source prices, descriptions and qualifications must remain intact.');
    }
    for (const source of extracted.attributes) {
      const collision = catalog.attributes.find(field => field.id === source.id);
      if (collision && (collision.type !== source.type || collision.currency !== source.currency || (collision.unit ?? '').toLowerCase() !== (source.unit ?? '').toLowerCase())) {
        throw new AppError('Interpretation changed a reserved source attribute definition. Source price currencies, units and field types must remain intact.');
      }
    }
  }
  const represented = (e: CatalogEntity) => catalog.entities.some(other => other.name.normalize('NFKC').toLowerCase() === e.name.normalize('NFKC').toLowerCase()
    && (!options.strict || retainsSourceFields(e, other))
    && extracted.attributes.filter(def => def.type === 'money' && e.attributes[def.id] !== undefined).every(price => catalog.attributes.some(def => def.type === 'money' && def.currency === price.currency
      && (def.unit ?? '').toLowerCase() === (price.unit ?? '').toLowerCase() && other.attributes[def.id] === e.attributes[price.id])));
  const missing = extracted.entities.filter(e => !existing.has(e.id) && !represented(e));
  if (options.strict && missing.length + catalog.entities.length > 100) throw new AppError('The combined website exceeds the 100-item catalog limit. Split the import; no offerings were dropped.');
  const additions = missing.slice(0, 100 - catalog.entities.length);
  const ids = new Set([...existing, ...additions.map(e => e.id)]);
  const attributes = [...catalog.attributes, ...extracted.attributes.filter(a => !catalog.attributes.some(b => b.id === a.id))];
  const allCollections = [...catalog.collections, ...extracted.collections.filter(g => !catalog.collections.some(c => c.id === g.id)).map(g => ({ ...g, entityIds: g.entityIds.filter(id => ids.has(id)) })).filter(g => g.entityIds.length)];
  if (options.strict && (attributes.length > 24 || allCollections.length > 24)) throw new AppError('The combined website exceeds the catalog attribute or collection limit. Split the import; no fields or collections were dropped.');
  const collections = allCollections.slice(0, 24);
  return { catalog: validateCatalog({ ...catalog, id: catalog.id || randomUUID(), entities: [...catalog.entities, ...additions], attributes, collections }),
    notes: [...extracted.notes, ...(additions.length < missing.length ? ['The 100-item catalog limit was reached. Some offerings remain in source evidence only; split or review the import.'] : [])] };
}
