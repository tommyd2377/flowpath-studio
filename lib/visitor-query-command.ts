import 'server-only';
import { randomUUID } from 'node:crypto';
import { patchQuery, expressionNodes, type Expression, type FieldDescriptor, type QueryPatch } from '@thevoice/platform-ui/query';
import type { CapabilityContext } from './visitor-capabilities';
import { publishedOfferingScope } from './catalog-query';
import { normalizedWebsiteCommand, websiteCommandCanMatch, websiteCommandFieldPredicate, websiteCommandFieldState, websiteCommandSortPattern } from './visitor-command-intent';

export type WebsiteCommand = { capabilityId: string; input: unknown };
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (value: string) => normalized(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const singular = (value: string) => value.length > 3 && value.endsWith('s') && !value.endsWith('ss') ? value.slice(0, -1) : value;
const phrase = (text: string, label: string) => ` ${words(text).map(singular).join(' ')} `.includes(` ${words(label).map(singular).join(' ')} `);
const fieldLabels = (field: FieldDescriptor) => [field.id, field.label, ...field.aliases,
  ...field.type === 'money' && field.basis ? ['price', 'cost', 'rate', 'fee'].map(label => `${field.basis} ${label}`) : []];
const clarify = (question: string): WebsiteCommand => ({ capabilityId: 'task.clarify', input: { question, options: [] } });

/** A conservative, publication-driven shortcut. Unhandled prose stays with the assistant.
 * Every recognized command becomes an ordinary validated capability and needs its display receipt.
 */
export function websiteQueryCommand(text: string, context: Pick<CapabilityContext, 'index' | 'session'>): WebsiteCommand | null {
  if (!websiteCommandCanMatch(text)) return null;
  const { index, session } = context;
  const history = session.queries.find(item => item.current.queryId === session.activeQueryId) ?? session.queries[0];
  if (!history) return null;
  const query = history.current, fields = index.space.fields;
  const value = normalizedWebsiteCommand(text);
  // Reopening is a view action, not a request to rebuild quantities or research.
  // Added qualifications (for example "including tax") stay with the assistant.
  if (/^(?:show(?: me)?|open|bring back|restore) (?:my |the |current |saved )*(?:estimate|basket)(?: again)?$/.test(value)) {
    return { capabilityId: 'estimate.show', input: {} };
  }
  const explicitAll = /^(?:show(?: me)?|find|search(?: for)?|browse)\s+all(?: of)?\s+/.test(value);
  const patch = (operations: QueryPatch['operations']): WebsiteCommand => {
    if (/\bat any price$/.test(value)) {
      const projected = patchQuery(history, { queryId: query.queryId, baseRevision: query.revision, operations });
      operations = [...operations, ...expressionNodes(projected.current.where).filter(node => 'fieldId' in node && fields.find(field => field.id === node.fieldId)?.type === 'money').map(node => ({ op: 'removeConstraint' as const, nodeId: node.id }))];
    }
    return { capabilityId: 'query.patch', input: { queryId: query.queryId, baseRevision: query.revision, operations } };
  };
  const nodes = expressionNodes(query.where);
  const all = (children: Expression[]): Expression => ({ kind: 'all', id: randomUUID(), children });
  const replaceRoot = (where: Expression): QueryPatch['operations'][number] => ({ op: 'replaceConstraint', nodeId: query.where.id, expression: where });
  if (/^(?:show(?: me)? (?:everything|all)(?: again)?|clear (?:all )?filters|remove (?:all )?filters)$/.test(value)) return { capabilityId: 'view.reset', input: {} };
  if (/^(?:go )?back(?: to (?:those |the )?results)?$/.test(value)) return { capabilityId: 'view.back', input: { target: value.includes('results') ? 'results' : 'previous' } };
  if (/^undo(?: (?:that|the last (?:change|filter)))?$/.test(value)) return history.past.length ? patch([{ op: 'undo' }]) : clarify('There is no earlier filter to restore.');
  if (/^(?:clear|remove|reset) (?:the )?(?:sort|sorting|order)$/.test(value)) return patch([{ op: 'setSort', order: [] }]);
  if (/^(?:clear|remove) (?:the )?(?:search|search terms|text filter)$/.test(value)) return patch([{ op: 'setSearch', text: '' }, ...nodes.filter(node => node.kind === 'search').map(node => ({ op: 'removeConstraint' as const, nodeId: node.id }))]);
  if (/^(?:include|search|show) (?:all )?(?:subcollections|nested collections)$/.test(value)) return patch([{ op: 'setScope', scope: { ...query.scope, traversal: 'descendants', include: undefined } }]);
  if (/^(?:exclude subcollections|only (?:this|the current) collection)$/.test(value)) return patch([{ op: 'setScope', scope: { ...query.scope, traversal: 'direct', include: undefined } }]);
  if (/^(?:search|show) (?:the )?(?:whole (?:site|website)|all collections)$/.test(value)) return patch([{ op: 'setScope', scope: { collectionId: index.space.rootId, path: [index.space.rootId], traversal: 'descendants' } }]);

  if (/^(?:show(?: me)?|open(?: up)?|bring up|browse) (?:the |your |our |full |complete |entire |all (?:of )?(?:the |your )?)*menu(?: again)?$/.test(value)) {
    const scope = publishedOfferingScope(index, 'menu');
    const reset = /\b(?:full|complete|entire|all)\b/.test(value);
    if (scope) return patch([{ op: 'setScope', scope }, { op: 'setSearch', text: '' }, ...reset ? [replaceRoot(all([])), { op: 'setSort' as const, order: [] }, { op: 'setPreferences' as const, preferences: [] }] : nodes.filter(node => node.kind === 'search').map(node => ({ op: 'removeConstraint' as const, nodeId: node.id }))]);
  }

  const scopeName = value.match(/^(?:show(?: me)?|browse)\s+(?:(?:your|the|all)\s+)?(.+)$/)?.[1].replace(/,?\s*at any price$/, '').replace(/\s+instead,?$/, '').trim();
  const sameWords = (left: string, right: string) => words(left).map(singular).join(' ') === words(right).map(singular).join(' ');
  const exactScope = scopeName && index.space.collections.filter(collection => sameWords(collection.name, scopeName));
  if (exactScope && exactScope.length === 1) {
    const target = exactScope[0];
    const pathTo = (id: string): string[] => {
      if (id === index.space.rootId) return [id];
      for (const edge of index.space.edges.filter(edge => edge.childId === id)) { const path = pathTo(edge.parentId); if (path.length) return [...path, id]; } return [];
    };
    return patch([{ op: 'setScope', scope: { collectionId: target.id, path: pathTo(target.id), traversal: 'descendants' } }, { op: 'setSearch', text: '' }, ...explicitAll ? [replaceRoot(all([])), { op: 'setSort' as const, order: [] }, { op: 'setPreferences' as const, preferences: [] }] : nodes.filter(node => node.kind === 'search').map(node => ({ op: 'removeConstraint' as const, nodeId: node.id }))]);
  }

  const openName = value.match(/^open(?:\s+up)?\s+(?:the\s+)?(.+)$/)?.[1];
  const showName = value.match(/^show(?: me)?\s+(?:(?:your|the)\s+)?(.+)$/)?.[1];
  if (openName || showName) {
    const nameKey = (name: string) => words(name.replace(/&/g, ' and ')).join(' ');
    const requested = nameKey(openName ?? showName!);
    const exact = index.space.records.filter(record => [record.name, ...record.aliases].some(name => nameKey(name) === requested));
    if (exact.length === 1) return { capabilityId: 'record.detail', input: { recordId: exact[0].id } };
    if (openName) {
      const matches = index.space.records.filter(record => [record.name, ...record.aliases].some(name => words(requested).every(word => nameKey(name).split(' ').includes(word))));
      // Partial names need the whole dialogue and scene. Let the assistant
      // resolve them before deciding that a clarification is necessary.
      return matches.length === 1 ? { capabilityId: 'record.detail', input: { recordId: matches[0].id } } : null;
    }
  }

  // Exact published identities win above. Composed display/media requests need
  // semantic projection or associations, not keyword predicates for every word.
  const display = value.match(/\b(?:with|along with|including|plus)\s+(.+)$/), displayClause = display?.[1];
  const displayBound = displayClause?.match(websiteCommandFieldPredicate);
  const predicateField = displayBound ? words(displayClause!.slice(0, displayBound.index).replace(/^(?:a|an|the)\s+/, '')).map(singular).join(' ') : '';
  const currentFieldFilter = displayBound && /^(?:only(?: show)?|show(?: me)?|filter)(?: only)? (?:those|these|them)$/.test(value.slice(0, display!.index).trim())
    && (/^(?:price|cost|rate|fee)$/.test(predicateField) || fields.some(field => fieldLabels(field).some(label => words(label).map(singular).join(' ') === predicateField)));
  if (displayClause && !currentFieldFilter && (/^(?:their|its|the|listed|published)\b/.test(displayClause)
    || /\b(?:prices?|costs?|rates?|fees?)\b/.test(displayClause)
    || fields.some(field => fieldLabels(field).some(label => phrase(displayClause, label))))) return null;
  const mediaSubject = value.match(/^(?:show(?: me)?|browse)\s+(.+)$/)?.[1].replace(/^(?:all(?: of)?\s+)?(?:(?:the|your|our)\s+)?/, '').replace(/\s+(?:again|please)$/, '');
  if (mediaSubject && /\b(?:photos?|pictures?|images?|photographs?|videos?|gallery|galleries)\b/.test(mediaSubject)
    && !/^(?:photos?|pictures?|images?|photographs?|videos?|gallery|galleries)(?: (?:of|photos?|pictures?|images?|photographs?|videos?|gallery|galleries))*$/.test(mediaSubject)) return null;

  const named = fields.map(field => ({ field, score: Math.max(0, ...fieldLabels(field).filter(label => phrase(value.replace(/[,:]/g, ' '), label)).map(label => normalized(label).length)) }));
  const best = Math.max(0, ...named.map(item => item.score));
  let candidates = named.filter(item => item.score && item.score === best).map(item => item.field);
  if ((!candidates.length || best <= 5 && candidates.every(field => field.type === 'money')) && (/\bprice|\bcost|\bcheapest|\bexpensive/.test(value) || value.includes('$'))) candidates = fields.filter(field => field.type === 'money');
  // Prefer a populated published basis only when the visitor did not name an exact field.
  if (candidates.length > 1 || !best) {
    const populated = candidates.filter(field => index.space.records.some(record => record.assertions.some(assertion => assertion.fieldId === field.id && assertion.value !== null)));
    if (populated.length) candidates = populated;
  }
  const field = candidates.length === 1 ? candidates[0] : undefined;
  if (/^(?:remove|clear)\b/.test(value) || /^(?:at any price|no price limit)$/.test(value)) {
    const priceLimit = /^(?:at any price|no price limit)$/.test(value);
    const subject = value.replace(/^(?:remove|clear)\s+(?:the\s+)?/, '').replace(/\s+(?:filter|limit|constraint)$/, '');
    // "Remove the item" may edit a basket or another surface. Only a whole
    // published field name (or an explicit filter request) belongs to this shortcut.
    if (!priceLimit && !/\b(?:filter|limit|constraint)\b/.test(value)
      && !candidates.some(candidate => fieldLabels(candidate).some(label => sameWords(subject, label)))) return null;
    if (priceLimit) candidates = fields.filter(field => field.type === 'money');
    const removed = nodes.filter(node => 'fieldId' in node && candidates.some(field => field.id === node.fieldId));
    return removed.length ? patch(removed.map(node => ({ op: 'removeConstraint', nodeId: node.id }))) : clarify('Which filter should I remove? Name its attribute, or say “show everything again”.');
  }
  if (websiteCommandSortPattern.test(value) && !/\b(?:larger|smaller) than\b/.test(value)) {
    // This shortcut can perform one sort, not interpret a compound request.
    // Preserve the entire category + limit + ordering request for the model.
    // Merely finding "cheapest" previously discarded the visitor's other criteria.
    let remainder = value;
    for (const label of field ? fieldLabels(field).sort((a, b) => b.length - a.length) : []) {
      const escaped = normalized(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      remainder = normalized(remainder).replace(new RegExp(`\\b${escaped}\\b`, 'g'), ' ');
    }
    remainder = remainder.replace(/\b(?:sort|ascending|descending|cheapest|most expensive|low to high|high to low|highest|lowest|largest|smallest|larger|smaller|show|me|by|price|cost|first|please|the|these|those|them|items|results|options)\b/g, '').trim();
    if (remainder) return null;
    if (!field?.sort) return clarify(`Which published attribute should I sort by?${fields.filter(field => field.sort && field.coverage.known).length ? ` You can use ${fields.filter(field => field.sort && field.coverage.known).map(field => field.label).slice(0, 5).join(', ')}.` : ''}`);
    return patch([{ op: 'setSort', order: [{ fieldId: field.id, direction: /descending|highest|largest|larger|high to low|most expensive/.test(value) ? 'desc' : 'asc' }] }]);
  }
  const bound = value.match(websiteCommandFieldPredicate);
  const explicitlyTyped = /^(?:only|filter|where)\b/.test(value) || best > 0 || !!bound && /\d/.test(bound[2]);
  let expression: Expression | undefined;
  if (field && websiteCommandFieldState.test(value)) {
    const state = value.match(websiteCommandFieldState)![1];
    expression = { kind: 'state', id: randomUUID(), fieldId: field.id, state: state === 'missing' || state === 'not published' ? 'unknown' : state as 'known' };
  } else if (bound && explicitlyTyped) {
    if (!field) return clarify('Which published attribute or price basis should I use? Name the field with your limit.');
    const op: Extract<Expression, { kind: 'field' }>['op'] = ({ under: 'lt', below: 'lt', 'less than': 'lt', 'smaller than': 'lt', over: 'gt', above: 'gt', 'greater than': 'gt', 'larger than': 'gt', 'at least': 'gte', 'at most': 'lte', before: 'lt', after: 'gt', equals: 'eq', equal: 'eq', is: 'eq', contains: 'contains', include: 'contains', includes: 'contains', 'include all of': 'all', 'includes all of': 'all', 'include any of': 'any', 'includes any of': 'any' } as Record<string, Extract<Expression, { kind: 'field' }>['op']>)[bound[1]];
    const raw = bound[2].replace(/\s+(?:please|too)$/, '').replace(/^['"]|['"]$/g, '').trim();
    const scalar = (input: string): string | number | boolean => {
      if (field.type === 'number' || field.type === 'money') {
        // Currency markers must agree with the published field before stripping them.
        return Number(field.type === 'money' && field.currency === 'USD' ? input.replace(/^\$/, '').replace(/\s+(?:usd|dollars?)$/, '') : input);
      }
      return field.type === 'boolean' ? /^(true|yes)$/.test(input) : input;
    };
    const data = op === 'any' || op === 'all' ? raw.split(/\s*,\s*/).map(scalar) : scalar(raw);
    if (typeof data === 'number' && !Number.isFinite(data) && /^[a-z ]+$/.test(raw)) return null; // Let the assistant interpret written-out quantities.
    if (!field.operations.includes(op) || typeof data === 'number' && !Number.isFinite(data) || field.type === 'boolean' && !/^(true|false|yes|no)$/.test(raw) || field.type === 'geo') return clarify(`Use a supported ${field.label} value: ${field.operations.join(', ')}${field.unit ? `, measured in ${field.unit}` : ''}.`);
    expression = { kind: 'field', id: randomUUID(), fieldId: field.id, op, value: { type: field.type, value: data, ...(field.unit ? { unit: field.unit } : {}), ...(field.currency ? { currency: field.currency } : {}), ...(field.basis ? { basis: field.basis } : {}) } };
  }
  // An unparsed predicate is still an instruction. Do not let a recognized
  // category/value turn its remaining criteria into literal search words.
  if (!expression && websiteCommandFieldPredicate.test(value.replace(/^include\s+/, ''))) return null;
  // Short requests can name reviewed enum/text values without spelling out the field.
  if (!expression && /^(?:show|find|only|include|filter|search)\b/.test(value)) {
    const matches: { field: FieldDescriptor; values: string[] }[] = [];
    for (const field of fields.filter(field => field.filter && ['text', 'enum'].includes(field.type))) {
      const values = [...new Set(index.space.records.flatMap(record => record.assertions.filter(assertion => assertion.fieldId === field.id && assertion.polarity === 'affirmed' && !assertion.conditions.length && assertion.value).flatMap(assertion => assertion.value!.value)).filter((item): item is string => typeof item === 'string' && item.length > 1 && phrase(value, item)))];
      if (values.length && values.length <= 12) matches.push({ field, values });
    }
    if (matches.length === 1) {
      const { field, values } = matches[0];
      const leaves: Expression[] = values.map(value => ({ kind: 'field', id: randomUUID(), fieldId: field.id, op: field.cardinality === 'many' ? 'any' : 'eq', value: { type: field.type, value: field.cardinality === 'many' ? [value] : value } }));
      expression = leaves.length === 1 ? leaves[0] : { kind: 'any', id: randomUUID(), children: leaves };
    }
  }
  if (expression) {
    const ids = new Set(expressionNodes(expression).flatMap(node => 'fieldId' in node ? [node.fieldId] : []));
    const prior = nodes.find(node => node.kind === 'any' && node.children.length && node.children.every(child => 'fieldId' in child && ids.has(child.fieldId))) ?? nodes.find(node => 'fieldId' in node && ids.has(node.fieldId));
    if (prior) return patch([{ op: 'replaceConstraint', nodeId: prior.id, expression: /^include\b/.test(value) ? { kind: 'any', id: randomUUID(), children: [...prior.kind === 'any' ? prior.children : [prior], expression] } : expression }]);
    return patch([replaceRoot(query.where.kind === 'all' ? { ...query.where, children: [...query.where.children, expression] } : all([query.where, expression]))]);
  }
  if (!/^(?:show(?: me)?|find|search(?: for)?|include)\s+/.test(value)) return null;
  if (/\b(web|online|internet|map|annotate|compare|how|why|who|when)\b/.test(value)) return null;
  let subject = value.replace(/^(?:show(?: me)?|find|search(?: for)?|include)\s+/, '').replace(/^all(?: of)?\s+/, '').replace(/^(?:your|the|our)\s+/, '').replace(/\s+(?:instead|too|again|please)$/, '').replace(/,?\s*at any price$/, '').trim();
  if (!subject || subject.length > 160) return null;
  const terms = words(subject).map(singular);
  const scopes = index.space.collections.filter(collection => collection.id !== index.space.rootId).map(collection => {
    const full = words(collection.name).map(singular);
    // Imported categories can retain a qualified name such as "Retail / Cakes".
    // A request for the reviewed leaf category should use its memberships,
    // not unrelated records that merely mention that word in a policy.
    const leaf = words(collection.name.split(/\s*(?:\/|>|→)\s*/).at(-1) ?? '').map(singular);
    return { collection, terms: full.every(term => terms.includes(term)) ? full : leaf };
  }).filter(item => item.terms.length && item.terms.every(term => terms.includes(term)));
  const longest = Math.max(0, ...scopes.map(item => item.terms.length));
  const matches = longest ? scopes.filter(item => item.terms.length === longest) : /^(?:photos?|pictures?|images?|photographs?|gallery)$/.test(subject) ? index.space.collections.filter(collection => collection.view === 'gallery' && [...index.direct.get(collection.id) ?? []].some(id => index.records.get(id)?.type === 'published-photo')).map(collection => ({ collection, terms: words(subject).map(singular) })) : [];
  // Descendant traversal already includes child albums/categories. Keep union
  // members disjoint instead of proposing an invalid ancestor/child union.
  const chosen = matches.filter(child => !matches.some(parent => parent !== child && index.descendants.get(parent.collection.id)?.has(child.collection.id)));
  const operations: QueryPatch['operations'] = [];
  if (chosen.length) {
    const pathTo = (id: string, seen = new Set<string>()): string[] => {
      if (id === index.space.rootId) return [id]; if (seen.has(id)) return []; seen.add(id);
      for (const edge of index.space.edges.filter(edge => edge.childId === id)) { const path = pathTo(edge.parentId, seen); if (path.length) return [...path, id]; } return [];
    };
    operations.push({ op: 'setScope', scope: chosen.length === 1 ? { collectionId: chosen[0].collection.id, traversal: 'descendants', path: pathTo(chosen[0].collection.id) } : { collectionId: chosen[0].collection.id, traversal: 'explicitUnion', include: chosen.slice(1, 25).map(item => item.collection.id), path: pathTo(chosen[0].collection.id) } });
    subject = words(subject).filter(word => !chosen[0].terms.includes(singular(word))).join(' ');
    // A resolved category plus a presentation noun requests its members, not
    // records containing that noun. Exact record/category names already won
    // above. Preserve genuine qualifiers (e.g. "winter menu") for retrieval.
    if (/^(?:(?:a|the|your|our) )?(?:menu|list|catalog|catalogue|gallery|collection|selection|options)(?: of)?$/.test(subject)) subject = '';
  } else if (/\b(?:menu|list|catalog|catalogue|gallery|collection|selection|options)\b/.test(subject)) return null;
  // Tokens are resolved against the complete publication, including full reading text.
  // Singular/plural equivalence is allowed only when that exact alternate token is published.
  const search = (input: string): Expression => ({ kind: 'search', id: randomUUID(), text: words(input).filter(word => !['the', 'your', 'our', 'options', 'instead', 'please'].includes(word)).map(word => index.tokens.has(word) ? word : index.tokens.has(singular(word)) ? singular(word) : index.tokens.has(`${word}s`) ? `${word}s` : word).join(' ') });
  const parts = subject.split(/\s+(?:or|and)\s+/).map(search).filter(node => node.kind === 'search' && node.text);
  // Resolving a collection does not explain the rest of a display request.
  // Any remaining qualifier needs a published member name/alias; prose such as
  // "all six ... in this guide" must reach the assistant intact, not become
  // literal search terms. Explicit searches still retain their keyword intent.
  if (/^show\b/.test(value) && (subject || !chosen.length)) {
    const members = chosen.length ? new Set(chosen.flatMap(item => [...index.descendants.get(item.collection.id) ?? []].flatMap(id => [...index.direct.get(id) ?? []]))) : null;
    if (!parts.length || !parts.every(part => part.kind === 'search'
      && index.space.records.some(record => (!members || members.has(record.id)) && [record.name, ...record.aliases].some(name =>
        words(part.text).every(term => words(name).map(singular).includes(singular(term))))))) return null;
  }
  const next = parts.length > 1 ? { kind: 'any' as const, id: randomUUID(), children: parts } : parts[0];
  const previousSearch = nodes.find(node => node.kind === 'search' || node.kind === 'any' && node.children.every(child => child.kind === 'search'));
  if (/^include\b/.test(value) && next) {
    const prior = previousSearch ?? (query.searchText ? search(query.searchText) : null);
    if (!prior) return clarify('What should I include those alongside? Name the current group or start a new search.');
    const broadened: Expression = { kind: 'any', id: randomUUID(), children: prior.kind === 'any' ? [...prior.children, next] : [prior, next] };
    operations.push({ op: 'setSearch', text: '' }, previousSearch ? { op: 'replaceConstraint', nodeId: previousSearch.id, expression: broadened } : replaceRoot(query.where.kind === 'all' ? { ...query.where, children: [...query.where.children, broadened] } : all([query.where, broadened])));
  } else {
    const withoutSearch = (node: Expression): Expression | null => {
      if (node.kind === 'search') return null;
      if ('children' in node) { const children = node.children.map(withoutSearch).filter((child): child is Expression => !!child); return children.length ? { ...node, children } : null; }
      return node;
    };
    // Explicitly asking for every member of a resolved collection starts its
    // full view. Prior offering prices must not silently exclude its photos.
    // Ordinary refinements and qualified requests still keep their constraints.
    const resetCriteria = explicitAll && chosen.length > 0 && !subject;
    const retained = resetCriteria ? null : withoutSearch(query.where);
    if (resetCriteria) operations.push({ op: 'setSort', order: [] }, { op: 'setPreferences', preferences: [] });
    // Plain keyword searches have one owner. Boolean alternatives remain
    // explicit predicates, so broadening preserves typed constraints.
    operations.push({ op: 'setSearch', text: next?.kind === 'search' ? next.text : '' }, replaceRoot(all([...(retained?.kind === 'all' ? retained.children : retained ? [retained] : []), ...next && next.kind !== 'search' ? [next] : []])));
  }
  return patch(operations);
}
