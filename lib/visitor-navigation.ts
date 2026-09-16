/** Local navigation must work even when AI is unavailable. Ordinary Back remains contextual. */
export function visitorPageIntent(text: string): 'home' | 'browse' | 'clear' | 'unfocus' | null {
  const value = text.toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:please |can you |could you )+/, '').replace(/ please$/, '');
  if (/^(?:(?:take|bring|send) me |(?:go |return |get )(?:me )?)?(?:back )?(?:to )?(?:the )?(?:home|home page|homepage|main page|main screen|start|beginning|starting page|starting screen)$/.test(value)
    || /^(?:let'?s )?(?:start over|start again|go back to the beginning|reset everything)$/.test(value)) return 'home';
  if (/^(?:show(?: me)?|open|browse|view|take me to) (?:the |a )?(?:full |regular |complete |whole )?(?:website|site|published content)$/.test(value)) return 'browse';
  if (/^(?:(?:take|bring) me |go |return |show(?: me)? )?(?:back )?(?:to )?(?:the |my )?workspace(?: overview)?$/.test(value)
    || /^(?:show(?: me)?|return to) (?:all (?:of )?(?:the )?)?open (?:panels|cards)$/.test(value)) return 'unfocus';
  if (/^(?:clear|empty) (?:the |my |this )?workspace$/.test(value)
    || /^(?:close|dismiss|clear) (?:everything|all(?: (?:of )?the)?(?: (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))? (?:open )?(?:panels|cards|boxes|objects))$/.test(value)) return 'clear';
  return null;
}

/** Only a whole, single navigation request can skip the model's closing reply.
 * Exact labels allow names containing "and" without truncating compound tasks.
 */
export function navigationConfirmation(text: string, kind: string, names: string[] = []): string | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim();
  const request = normalize(text).replace(/^(?:please |can you |could you )+/, '').replace(/ please$/, '');
  const page = visitorPageIntent(text);
  if (page === kind) return ({ home: 'You’re back at the opening.', browse: 'The website is ready to browse.', clear: 'The workspace is clear.', unfocus: 'You’re back in the workspace.' } as const)[page!];
  if (kind === 'back' && ['back', 'go back', 'take me back', 'go back one step'].includes(request)) return 'You’re back in the previous view.';
  const verbs: Record<string, string[]> = { open: ['open', 'open up', 'pull up', 'show', 'show me'], focus: ['open', 'focus', 'focus on'], expand: ['expand', 'enlarge'], close: ['close', 'dismiss'], collapse: ['collapse', 'shrink'] };
  const labels = [...names.flatMap(name => [normalize(name), `the ${normalize(name)}`, `${normalize(name)} panel`, `the ${normalize(name)} panel`]), 'this', 'this panel', 'that panel', 'the panel', 'this card'];
  if (verbs[kind]?.some(verb => labels.some(label => request === `${verb} ${label}`))) {
    return ({ open: 'Opened.', focus: 'Opened.', expand: 'Expanded.', close: 'Closed.', collapse: 'Collapsed.' } as Record<string, string>)[kind];
  }
}
