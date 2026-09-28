/** Skip the catalog shortcut only for requests that need assistant interpretation.
 * This does not interpret or execute a task; the published query remains authoritative.
 */
export function websiteCommandCandidate(text: string): boolean {
  const value = normalizedWebsiteCommand(text);
  if (/\b(?:compar(?:e|ing|ison|isons)|versus|vs)\b/.test(value)) return false;
  if (/^(?:(?:now|okay|ok|alright)[, ]+)?(?:what|when|where|why|how|who|does|do|is|are|can|could|tell|explain|estimate|calculate|compute|convert|make|build)\b/.test(value)) return false;
  if (/^(?:search(?:\s+for)?|find)\s+(?:(?:some|a|an|the)\s+)?(?:(?:web|online)\s+)?(?:images?|pictures?|photos?|photographs?|videos?|maps?)\b/.test(value)
    || /\b(?:on|from|across)\s+(?:the\s+)?(?:web|internet)\b/.test(value)) return false;
  if (/[?;]|\.\s|\b(?:and then|then)\b|\band\s+(?:show|tell|explain|display|list|include|their|its)\b/.test(value)) return false;
  if (/(?:\b(?:and|also|plus|while|as well as)\s+|,\s*)(?:(?:then|also|please|can you|could you|would you)\s+)*(?:calculate|compute|estimate|total|sum|add up|work out|figure out|apply|explain|summari[sz]e|compare|research|search|look up|find out|annotate|enrich|convert|give|tell|show|make|set|change|remove|clear|keep|leave|replace|swap)\b/.test(value)) return false;
  // A bound plus ordering is a compound task, never a sort-only shortcut.
  if (/\b(?:under|below|over|above|at least|at most|less than|greater than|limit)\b/.test(value)
    && /\b(?:sort|ascending|descending|cheapest|most expensive|lowest|highest|low to high|high to low)\b/.test(value)) return false;
  return true;
}

export function normalizedWebsiteCommand(text: string): string {
  return text.toLowerCase().trim().replace(/[.!?]+$/, '').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?=(?:show|open|bring up|browse)\b)/, '').replace(/\s+please$/, '');
}

// Shared with the server parser: these predicates can occur after any wording,
// including publication-specific field names unavailable in the browser view.
export const websiteCommandFieldPredicate = /\b(under|below|over|above|at least|at most|less than|greater than|larger than|smaller than|before|after|equals?|is|includes? all of|includes? any of|contains|includes?)\s+(.*)$/;
export const websiteCommandSortPattern = /\b(sort|ascending|descending|cheapest|most expensive|low to high|high to low|highest|lowest|largest|smallest|larger|smaller)\b/;
export const websiteCommandFieldState = /\b(unknown|not published|missing|known|conflicting|conditional|stale)\b/;

/** A syntax-only superset of the server shortcut, not another intent parser.
 * Skip impossible probes; keep ambiguous matches for full publication validation.
 */
export function websiteCommandCanMatch(text: string): boolean {
  if (!websiteCommandCandidate(text)) return false;
  const value = normalizedWebsiteCommand(text);
  return /^(?:show|open|bring (?:up|back)|restore|browse|find|search|only|include|filter|remove|clear|reset|undo|back|go back|exclude)\b/.test(value)
    || /^(?:at any price|no price limit)$/.test(value)
    || websiteCommandFieldPredicate.test(value)
    || websiteCommandSortPattern.test(value)
    || websiteCommandFieldState.test(value);
}

/** Eligibility only: the model must also explicitly choose display completion.
 * Questions, enrichment and dependent business work keep their synthesis round.
 */
export function queryDisplayOnlyRequest(text: string): boolean {
  const value = normalizedWebsiteCommand(text).replace(/^(?:(?:now|okay|ok|alright)[, ]+)+/, '')
    .replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?=(?:show|find|list|filter|narrow|sort|order|only|include|exclude|keep|remove|clear|reset)\b)/, '');
  if (!/^(?:show|find|list|filter|narrow|sort|order|only|include|exclude|keep|remove|clear|reset)\b/.test(value)) return false;
  if (/[?;]|\.\s|\b(?:then|also|why|how|what|which|explain|tell|recommend|best|safest|safe|allerg\w*|compare|comparison|versus|vs|calculate|compute|estimate|basket|cart|tax\w*|total|sum|average|difference|convert|add|buy|book|order\s+for|research|search|look\s+up|web|internet|online)\b/.test(value)) return false;
  // A media noun can itself be the requested filtered collection. A second
  // display/retrieval action still needs its own outcome, not a prose shortcut.
  if (/(?:\b(?:and|plus|while|as well as)\s+|,\s*)(?:please\s+)?(?:show|open|display|include|give|find|summari[sz]e|annotate|enrich)\b/.test(value)) return false;
  return true;
}

/** A comparison table may finish an explicit compare-only request. The model
 * still opts in; any requested prose, reasoning or dependent work continues.
 */
export function comparisonDisplayOnlyRequest(text: string): boolean {
  const value = normalizedWebsiteCommand(text).replace(/^(?:(?:now|okay|ok|alright)[, ]+)+/, '')
    .replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?=compare\b)/, '');
  // A comparison table does not fulfill media/enrichment, even when the
  // visitor names it as a noun phrase ("with prices and published photos").
  if (!/^compare\b/.test(value) || /\b(?:describe|discuss|reason\w*|advise|suggest|analy[sz]e|summari[sz]e|assess|evaluate|tradeoffs?|pros|cons|photos?|pictures?|images?|galler(?:y|ies)|videos?|maps?|charts?|graphs?|illustrations?|media|annotations?)\b/.test(value)) return false;
  return queryDisplayOnlyRequest(value.replace(/^compare\b/, 'show'));
}
