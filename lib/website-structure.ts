import { createHash, randomUUID } from 'node:crypto';
import { validateCatalog, type KnowledgeCatalog, type CatalogEntity, type AttributeDefinition } from '@thevoice/platform-ui/contracts';
import type { ExtractedWebsitePage } from './website-import';
import { AppError } from './errors';
import { textBlocks } from './html-document';

const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const currencyCodes = 'USD|CAD|AUD|GBP|EUR';
const knownCurrencyToken = `(?:${currencyCodes.split('|').map(code => [...code].map(letter => `[${letter}${letter.toLowerCase()}]`).join('')).join('|')})`;
// Capture unsupported uppercase markers too, so a nearby code can never fall through to a scoped currency.
const currencyToken = `(?:(?!(?:PER|PLUS|EACH|APIECE)\\b)[A-Z]{2,}|${knownCurrencyToken})`;
const amountPattern = '\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?(?!\\d|[.,]\\d)';
const pricePattern = `(?:(?<![\\p{L}])${currencyToken}\\s*)?[$£€]\\s*${amountPattern}(?:\\s+${currencyToken}\\b)?|(?<![\\p{L}])${knownCurrencyToken}\\s*${amountPattern}(?:\\s+${currencyToken}\\b)?`;
type CurrencyScope = { currency?: string; indexes: number[] };
type ListedPrice = { price: number; currency?: string; unit?: string; literal: string; currencyIndexes: number[] };
function listedPrice(literal: string, scope?: CurrencyScope): ListedPrice {
  const symbol = new RegExp(`^(?:(${currencyToken})\\s*)?([$£€])\\s*(${amountPattern})(?:\\s+(${currencyToken}))?$`, 'u').exec(literal);
  const coded = new RegExp(`^(${knownCurrencyToken})\\s*(${amountPattern})(?:\\s+(${currencyToken}))?$`, 'u').exec(literal);
  const codes = [...new Set([symbol?.[1], symbol?.[4], coded?.[1], coded?.[3]].filter(Boolean).map(code => code!.toUpperCase()))];
  const marker = symbol?.[2];
  const compatible = (code: string) => currencyCodes.split('|').includes(code) && (marker === '$' ? ['USD', 'CAD', 'AUD'].includes(code) : marker === '£' ? code === 'GBP' : marker === '€' ? code === 'EUR' : true);
  const scoped = !codes.length && marker === '$';
  const currency = codes.length ? codes.length === 1 && compatible(codes[0]) ? codes[0] : undefined
    : scoped ? scope?.currency && compatible(scope.currency) ? scope.currency : undefined : marker === '£' ? 'GBP' : 'EUR';
  return { price: Number((symbol?.[3] ?? coded![2]).replaceAll(',', '')), currency, literal,
    currencyIndexes: scoped ? scope?.indexes ?? [] : [] };
}
/** Currency declarations belong to their heading subtree; conflicting/unsupported declarations block inheritance. */
function currencyScopes(lines: string[]): (CurrencyScope | undefined)[] {
  type Scope = { parent?: Scope; declarations: { currency?: string; index: number }[]; level: number };
  const root: Scope = { declarations: [], level: 0 }, stack = [root];
  const owners: Scope[] = [];
  for (const [index, line] of lines.entries()) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      while (stack.at(-1)!.level >= heading[1].length) stack.pop();
      stack.push({ parent: stack.at(-1), declarations: [], level: heading[1].length });
    }
    const owner = stack.at(-1)!; owners.push(owner);
    const text = heading?.[2] ?? line;
    const declaration = /^(?:(?:all\s+)?prices?\s*(?:are\s+)?(?:(?:shown|listed|quoted)\s+)?(?:in\s+|:\s*|\(\s*)|currency\s*:\s*)(.+?)\)?[.!]?$/i.exec(text);
    if (declaration && !/[$£€\d]/.test(declaration[1])) {
      const currency = new RegExp(`^(${currencyCodes})$`, 'i').exec(declaration[1].trim())?.[1].toUpperCase();
      owner.declarations.push({ currency, index });
    }
  }
  return owners.map(owner => {
    for (let scope: Scope | undefined = owner; scope; scope = scope.parent) {
      if (!scope.declarations.length) continue;
      const currencies = new Set(scope.declarations.map(item => item.currency));
      return { currency: currencies.size === 1 ? scope.declarations[0].currency : undefined, indexes: scope.declarations.map(item => item.index) };
    }
    return undefined;
  });
}
/** Only a complete, immediately adjacent price line establishes an item's prices. */
function adjacentPrices(line: string, scope?: CurrencyScope): ListedPrice[] {
  const labeled = new RegExp(`([\\p{L}\\p{N}][\\p{L}\\p{N} /()-]{0,31}?)\\s*:\\s*(${pricePattern})`, 'gu');
  const matches = [...line.matchAll(labeled)];
  if (matches.length && !line.replace(labeled, '').replace(/[\s,;|*]/g, '')) {
    const prices = matches.map(match => ({ ...listedPrice(match[2], scope), unit: match[1].trim() }));
    // Repeated unit labels or malformed numbers are ambiguous, even when their amounts agree.
    return new Set(prices.map(price => price.unit.toLowerCase())).size === prices.length && prices.every(price => Number.isFinite(price.price)) ? prices : [];
  }
  const single = new RegExp(`^(${pricePattern})(?:\\s*\\*|\\s+(?:[pP][lL][uU][sS]|[pP][eE][rR])\\s+[^$£€]+)?$`, 'u').exec(line.replace(/^(?:starting at|from)\s+/i, ''));
  return single ? [listedPrice(single[1], scope)] : [];
}
const priceField = (price: ListedPrice) => `source_price_${price.unit ? `${key(price.unit.toLowerCase())}_` : ''}${price.currency?.toLowerCase() ?? 'unknown'}`;
const priceValue = (price: ListedPrice) => price.currency ? price.price : `${price.unit ? price.unit + ': ' : ''}${price.literal}`;
const priceDefinition = (price: ListedPrice): AttributeDefinition => ({ id: priceField(price),
  label: `Listed ${price.unit ? price.unit + ' ' : ''}price (${price.currency ?? 'currency unconfirmed'})`,
  ...(price.currency ? { type: 'money' as const, currency: price.currency, ...(price.unit ? { unit: price.unit } : {}) } : { type: 'text' as const }) });
export type WebsiteOfferingEvidence = { entityId: string; pageUrl: string; fields: { field: string; lineStart: number; lineEnd: number; excerpt: string }[] };
type OfferingOptions = { strict?: boolean };
/** Zero can be a storefront default or an issuance fee, not the card's value.
 * Only an item-specific free-card statement resolves an unqualified zero price. */
function ambiguousZeroGiftCard(name: string, prices: ListedPrice[], description: string[]) {
  const item = /\bgift[ -]?(?:card|certificate|voucher)s?(?:\s*\([^)]*\))?(?:\s+[–—-]\s+[^\n]+)?$/i;
  const accessory = /\bgift[ -]?(?:card|certificate|voucher)s?\s+(?:[–—-]\s+)?(?:holder|sleeve|envelope|wallet|display|stand|box|packaging)\b/i;
  const fee = /^(?:activation|issuance|delivery|shipping|replacement)(?: fee)?$/i;
  if (!item.test(name) || accessory.test(name) || !prices.some(price => price.price === 0 && !(price.unit && fee.test(price.unit)))) return false;
  const card = '(?:(?:digital|electronic|e)[ -]*)?gift[ -]?(?:card|certificate|voucher)s?';
  const freeTitle = new RegExp(`^(?:free|complimentary)\\s+${card}\\b`, 'i').test(name);
  const freeStatement = new RegExp(`^(?:this|the)\\s+${card}\\s+(?:is|are)\\s+(?:free|complimentary)(?:[.!?]|$|\\s+(?:with|when|for)\\b)`, 'i');
  const notFree = new RegExp(`\\b(?:this|the)\\s+${card}\\s+(?:(?:is|are)\\s+(?:not|never)|(?:isn|aren)['’]t)\\s+(?:free|complimentary)\\b`, 'i');
  return description.some(line => notFree.test(line)) || !(freeTitle || description.some(line => freeStatement.test(line)));
}
// Comparison fields stay compact; a long source description belongs in the
// reader. Never truncate its later qualifications to fit a displayed price.
function offeringTerms(literal: string, name: string, category: string) {
  const extended = literal.length > 1000;
  const terms = extended ? 'Price and conditions require review. Read the complete source terms in the item details.' : literal;
  return { terms,
    summary: `${category ? category + '. ' : ''}${extended ? name + '. ' : ''}${terms}${/[.!?]$/.test(terms) ? '' : '.'} Listed information; availability is not verified.`,
    ...(extended ? { blocks: textBlocks(literal) } : {}) };
}
/** Explicit price headings/tiers and adjacent prices only. No inferred stock, booking or ordering capability. */
export function websiteOfferings(pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[], options: OfferingOptions = {}) {
  const entities: CatalogEntity[] = [], attributes = new Map<string, AttributeDefinition>(), groups = new Map<string, string[]>();
  const evidence: WebsiteOfferingEvidence[] = [], issues: string[] = [];
  const limit = (message: string) => { if (options.strict) throw new AppError(message); if (!issues.includes(message)) issues.push(message); };
  let pricedLines = 0, unmatched = 0, unconfirmedCurrency = 0, unresolvedGiftCards = 0;
  for (const page of pages) {
    const sourceLines = page.text.split('\n');
    const records = sourceLines.flatMap((raw, sourceIndex) => {
      const line = raw.trim(); if (!line) return [];
      const multi = /^(#{1,6})\s+(.+?)\s*~\s*(.+)$/.exec(line);
      const variants = multi?.[3].split('|').map(s => s.trim());
      const values = multi && variants && variants.length > 1 && variants.every(s => /^[^$£€]+[-–]\s*[$£€]\s*\d+(?:\.\d+)?$/.test(s)) ? variants.map(s => `${multi[1]} ${multi[2]} · ${s}`) : [line];
      return values.map(text => ({ text, sourceIndex }));
    });
    const lines = records.map(record => record.text), scopes = currencyScopes(lines);
    const stack: { level: number; title: string; index: number; price?: ListedPrice; literal?: string }[] = [];
    const sourceField = (field: string, start: number, end = start) => ({ field, lineStart: records[start].sourceIndex + 1, lineEnd: records[end].sourceIndex + 1, excerpt: sourceLines.slice(records[start].sourceIndex, records[end].sourceIndex + 1).join('\n') });
    const priceEvidence = (price: ListedPrice, index: number) => [index, ...price.currencyIndexes].map(at => sourceField(`attributes.${priceField(price)}`, at));
    const capturedPriceLines = new Set<number>();
    for (let index = 0; index < lines.length; index++) {
      const match = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
      if (!match) { if (new RegExp(pricePattern, 'u').test(lines[index]) && !capturedPriceLines.has(index)) { pricedLines++; unmatched++; } continue; }
      const level = match[1].length, title = match[2].trim();
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      // Descendant headings are still part of this item's source description.
      // Retain their qualifications until the next sibling/ancestor boundary.
      const followingIndexes: number[] = [];
      for (let after = index + 1; after < lines.length; after++) {
        const heading = /^(#{1,6})\s/.exec(lines[after]);
        if (heading && heading[1].length <= level) break;
        followingIndexes.push(after);
      }
      const prices = [...title.matchAll(new RegExp(pricePattern, 'gu'))];
      if (prices.length) pricedLines++;
      const adjacent = !prices.length && lines[index + 1] && !/^#{1,6}\s/.test(lines[index + 1]) ? adjacentPrices(lines[index + 1], scopes[index]) : [];
      if (adjacent.length) {
        if (ambiguousZeroGiftCard(title, adjacent, followingIndexes.slice(1).map(at => lines[at]))) {
          unresolvedGiftCards++; stack.push({ level, title, index }); continue;
        }
        const category = stack.filter(item => item.price === undefined).map(item => item.title).slice(-2).join(' / ');
        const fields = adjacent.map(priceDefinition);
        if (entities.length < 70 && new Set([...attributes.keys(), 'source_category', 'source_price_terms', ...fields.map(field => field.id)]).size <= 24) {
          const following = followingIndexes.slice(1).map(at => lines[at]);
          const footnoteIndexes = lines[index + 1].includes('*') ? lines.flatMap((line, at) => /^\*.*(?:starting price|additional charges)/i.test(line) ? [at] : []) : [];
          const currencyIndexes = [...new Set(adjacent.flatMap(price => price.currencyIndexes))];
          const literal = [...new Set([title, lines[index + 1], ...following, ...footnoteIndexes.map(at => lines[at]), ...currencyIndexes.map(at => lines[at])])].join(' ');
          if (title.length > 160 || category.length > 400) { limit('Some offering names or categories exceed the catalog field limits. Split or review the import; no truncated offering was accepted.'); stack.push({ level, title, index }); continue; }
          const details = offeringTerms(literal, title, category);
          for (const field of fields) attributes.set(field.id, field);
          attributes.set('source_category', { id: 'source_category', label: 'Source category', type: 'text' });
          attributes.set('source_price_terms', { id: 'source_price_terms', label: 'Price / size terms', type: 'text' });
          const id = `offering-${key(`${page.url}:${category}:${title}`)}`;
          entities.push({ id, kind: 'offering', name: title, summary: details.summary, ...(details.blocks ? { blocks: details.blocks } : {}),
            attributes: { ...Object.fromEntries(adjacent.map(price => [priceField(price), priceValue(price)])), source_category: category, source_price_terms: details.terms },
            identifiers: [{ scheme: 'publisher-id', value: key(`${page.url}:${category}:${title}`) }] });
          const group = category || 'Offerings'; groups.set(group, [...groups.get(group) ?? [], id]);
          evidence.push({ entityId: id, pageUrl: page.url, fields: [sourceField('name', index), ...adjacent.flatMap(price => priceEvidence(price, index + 1)),
            ...stack.filter(item => item.price === undefined).slice(-2).map(item => sourceField('attributes.source_category', item.index)),
            sourceField('attributes.source_price_terms', index, index + 1 + following.length), ...[...footnoteIndexes, ...currencyIndexes].map(at => sourceField('attributes.source_price_terms', at))] });
          capturedPriceLines.add(index + 1); pricedLines++;
          if (adjacent.some(price => !price.currency)) { unconfirmedCurrency++; unmatched++; }
        } else limit('The structured offering or attribute limit was reached. Split or review the import; some offerings remain in source evidence only.');
        stack.push({ level, title, index });
        continue;
      }
      const nextHeading = lines.slice(index + 1).find(line => /^#{1,6}\s/.test(line));
      const hasChildren = !!nextHeading && /^#+/.exec(nextHeading)![0].length > level;
      // A hierarchy alone cannot distinguish priced items from instructions.
      // Only an explicit per-item price immediately introducing child headings
      // establishes a shared tier; ambiguous branches remain source evidence.
      const perItemPrice = prices.length === 1 && /^(?:\s*\*)?\s+(?:each|apiece)\b/i.test(title.slice(prices[0].index! + prices[0][0].length));
      const tier = perItemPrice && hasChildren && /^#{1,6}\s/.test(lines[index + 1] ?? '');
      if (prices.length === 1 && hasChildren && !tier) {
        unmatched++;
        stack.push({ level, title, index });
        continue;
      }
      // A tier applies to its direct children, never through a named item to
      // deeper headings such as that item's instructions or specifications.
      const inherited = stack.at(-1);
      const price = prices.length === 1 ? listedPrice(prices[0][0], scopes[index]) : !prices.length ? inherited?.price : undefined;
      const category = stack.filter(item => item.price === undefined).map(item => item.title).slice(-2).join(' / ');
      if (tier) { stack.push({ level, title, index, price, literal: title }); if (price && !price.currency) { unconfirmedCurrency++; unmatched++; } continue; }
      if (price && Number.isFinite(price.price)) {
        if (entities.length >= 70) { limit('The 70-item structured offering limit was reached. Split or review the import.'); unmatched++; stack.push({ level, title, index }); continue; }
        let labelEnd = prices[0]?.index;
        const unknownPrefix = /^([A-Z]{2,})\s*[$£€]/.exec(price.literal)?.[1];
        // An unfamiliar uppercase word may be part of the item name. Retain it unless a price separator scopes it.
        if (labelEnd !== undefined && unknownPrefix && !currencyCodes.split('|').includes(unknownPrefix) && !/[~–—:\-]\s*$/.test(title.slice(0, labelEnd))) labelEnd += unknownPrefix.length;
        const label = prices.length ? title.slice(0, labelEnd).replace(/[~–—:\-\s]+$/, '').replace(/\b(?:starting at|from)\s*$/i, '').replace(/[~–—:\-\s]+$/, '').trim() : title;
        if (!label) { unmatched++; stack.push({ level, title, index }); continue; }
        const name = /^[\d\W]/.test(label) && category ? `${category.split(' / ').at(-1)} · ${label}` : label;
        if (ambiguousZeroGiftCard(name, [price], followingIndexes.map(at => lines[at]))) {
          unresolvedGiftCards++; unmatched++; stack.push({ level, title, index }); continue;
        }
        const priceId = priceField(price);
        if (new Set([...attributes.keys(), 'source_category', 'source_price_terms', priceId]).size > 24) { limit('The 24-field structured offering limit was reached. Split or review the import.'); unmatched++; stack.push({ level, title, index }); continue; }
        attributes.set(priceId, priceDefinition(price));
        attributes.set('source_category', { id: 'source_category', label: 'Source category', type: 'text' });
        attributes.set('source_price_terms', { id: 'source_price_terms', label: 'Price / size terms', type: 'text' });
        const id = `offering-${key(`${page.url}:${category}:${title}`)}`;
        const priceText = prices.length ? title : inherited!.literal!;
        const footnoteIndexes = priceText.includes('*') ? lines.flatMap((line, at) => /^\*.*(?:starting price|additional charges)/i.test(line) ? [at] : []) : [];
        const literal = [...new Set([priceText,...followingIndexes.map(at => lines[at]),...footnoteIndexes.map(at => lines[at]),...price.currencyIndexes.map(at => lines[at])])].join(' ');
        if (name.length > 160 || category.length > 400) { limit('Some offering names or categories exceed the catalog field limits. Split or review the import; no truncated offering was accepted.'); unmatched++; stack.push({ level, title, index }); continue; }
        const details = offeringTerms(literal, name, category);
        entities.push({ id, kind: 'offering', name, summary: details.summary, ...(details.blocks ? { blocks: details.blocks } : {}),
          attributes: { [priceId]: priceValue(price), source_category: category, source_price_terms: details.terms },
          identifiers: [{ scheme: 'publisher-id', value: key(`${page.url}:${category}:${title}`) }] });
        const group = category || 'Offerings'; groups.set(group, [...groups.get(group) ?? [], id]);
        const priceIndex = prices.length ? index : inherited!.index;
        evidence.push({ entityId: id, pageUrl: page.url, fields: [sourceField('name', index), ...priceEvidence(price, priceIndex),
          ...stack.filter(item => item.price === undefined).slice(-2).map(item => sourceField('attributes.source_category', item.index)),
          ...[priceIndex, ...followingIndexes, ...footnoteIndexes, ...price.currencyIndexes].map(at => sourceField('attributes.source_price_terms', at))] });
        if (prices.length && !price.currency) { unconfirmedCurrency++; unmatched++; }
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
      ...(unresolvedGiftCards ? [`${unresolvedGiftCards} zero-priced gift-card entries need manual review. No free card or stored value was inferred; their source text and restrictions remain available.`] : []),
      ...(unconfirmedCurrency ? [`${unconfirmedCurrency} price-bearing lines have an unconfirmed currency. Literal prices were retained as text; no currency or conversion was inferred. Review the captured source before publishing.`] : []),
      ...(unmatched > unconfirmedCurrency ? ['Some ranges, multiple prices, or prose could not be mapped conservatively. Review the captured source before publishing.'] : [])] };
}

export function addWebsiteOfferings(catalog: KnowledgeCatalog, pages: Pick<ExtractedWebsitePage, 'url' | 'text'>[], options: OfferingOptions = {}) {
  const extracted = websiteOfferings(pages, options);
  // Provider-owned identities are never name-merged. A scoped deterministic source ID makes repeat repair idempotent.
  const existing = new Set(catalog.entities.map(e => e.id));
  const retainsSourceFields = (source: CatalogEntity, other: CatalogEntity) => other.name === source.name && other.kind === source.kind && other.summary === source.summary
    && JSON.stringify(other.blocks ?? []) === JSON.stringify(source.blocks ?? [])
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
    && extracted.attributes.filter(def => def.id.startsWith('source_price_') && def.id !== 'source_price_terms' && e.attributes[def.id] !== undefined).every(price => catalog.attributes.some(def => def.type === price.type && def.currency === price.currency && (price.type !== 'text' || def.id === price.id)
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
