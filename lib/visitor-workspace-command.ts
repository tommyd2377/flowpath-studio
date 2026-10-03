export type WorkspaceControlIntent = 'reset' | 'return' | 'close' | 'expand' | 'collapse' | 'focus' | 'show';

/** Recognize ordinary UI requests without treating words inside a question as commands. */
export function workspaceControlIntent(text: string): WorkspaceControlIntent | null {
  const query = text.toLowerCase().trim().replace(/[.!?]+$/, '').trim()
    .replace(/^please\s+/, '')
    .replace(/^(?:(?:can|could|would|will) you\s+|(?:i would like|i'd like|i want)(?: you)? to\s+)?(?:please\s+)?/, '')
    .replace(/(?:,?\s+please)$/, '');
  if (/^(?:reset(?: the (?:workspace|view))?|start over|clear (?:the )?workspace|close everything)$/.test(query)) return 'reset';
  if (/^(?:(?:go )?back|return)(?: to (?:the )?(?:previous (?:view|card)|workspace))?$/.test(query)) return 'return';
  // Calendar phrases ask about business hours, not the focused object. Match
  // the period as well so "this panel" and a title such as "Next Steps" survive.
  if (/^close\s+(?:this|next|every)\s+(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|(?:day|week(?:day|end)?|month|year|morning|afternoon|evening|night|holiday|spring|summer|autumn|fall|winter)s?|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(query)) return null;
  if (/^(?:close|dismiss)(?:$|\s+(?!to\b|at\b|on\b|by\b|for\b|over\b|until\b|during\b|early\b|late\b|today\b|tomorrow\b|tonight\b).+)/.test(query)
    || /^(?:(?:i am|i'm|im) (?:all )?)?done with (?:this|that|the)\b/.test(query)) return 'close';
  if (/^expand(?:$|\s+(?!on\b|upon\b|about\b).+)/.test(query) || query === 'bigger' || query === 'more context' || /^make\s+.+\s+bigger$/.test(query)) return 'expand';
  if (/^collapse(?:$|\s+)/.test(query) || query === 'smaller' || /^make\s+.+\s+smaller$/.test(query)) return 'collapse';
  if (/^(?:highlight|spotlight|focus on)\s+/.test(query)) return 'show';
  const target = '(?:(?:this|that) one|(?:(?:the|this|that) )?(?:first|second|third|fourth|fifth|sixth|left|right)(?: (?:one|card|panel|object|photo|picture|image|item|result))?|(?:the )?(?:card|panel|object|photo|picture|image) on (?:the )?(?:left|right))';
  if (new RegExp(`^(?:open|show|display|pull up|bring up)(?: me)? ${target}(?: (?:from|in) .+)?$`).test(query)) return 'show';
  if (new RegExp(`^(?:move|focus)(?: to)? ${target}$`).test(query)
    || /^(?:(?:the )?(?:first|second|third|fourth|fifth|sixth)(?: (?:one|card|panel|object|photo|picture|image|item|result))?|(?:the )?(?:left|right) (?:one|card|panel|object|photo|picture|image)|(?:the )?(?:card|panel|object|photo|picture|image) on (?:the )?(?:left|right)|(?:this|that) one)$/.test(query)) return 'focus';
  return null;
}
