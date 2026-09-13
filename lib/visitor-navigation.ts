/** Local navigation must work even when AI is unavailable. Ordinary Back remains contextual. */
export function visitorPageIntent(text: string): 'home' | 'browse' | 'clear' | null {
  const value = text.toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:please |can you |could you )+/, '').replace(/ please$/, '');
  if (/^(?:(?:take|bring|send) me |(?:go |return |get )(?:me )?)?(?:back )?(?:to )?(?:the )?(?:home|home page|homepage|main page|main screen|start|beginning|starting page|starting screen)$/.test(value)
    || /^(?:let'?s )?(?:start over|start again|go back to the beginning|reset everything)$/.test(value)) return 'home';
  if (/^(?:show(?: me)?|open|browse|view|take me to) (?:the |a )?(?:full |regular |complete |whole )?(?:website|site|published content)$/.test(value)) return 'browse';
  if (/^(?:clear|empty) (?:the |my |this )?workspace$/.test(value)
    || /^(?:close|dismiss|clear) (?:everything|all(?: (?:of )?the)?(?: (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))? (?:open )?(?:panels|cards|boxes|objects))$/.test(value)) return 'clear';
  return null;
}
