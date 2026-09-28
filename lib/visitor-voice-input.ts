import { visitorPageIntent } from './visitor-navigation';

export const isVoiceBackchannel = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/)
  .every(word => /^(?:m+h+m*|m+|u+h+|u+m+|h+m+|huh|uhhuh|aha|oh|ah|ok|okay|yes|yeah|yep|right|sure)?$/.test(word));

/** Caption grouping only. Live decides whether a factual question needs help. */
export const voiceRequestIncomplete = (text: string) => /\b(?:the|a|an|some|my|your|our|their|to|of|and|or|with|about|(?:open|pull|bring|look) up)\s*[.!?,]*$/.test(text.toLowerCase().trim());
export function voiceRequestNeedsHandoff(text: string, hasPendingRequest = false) {
  if (isVoiceBackchannel(text) || ['cancel', 'quiet', 'status', 'continue'].includes(voiceTaskSpeech(text) ?? '')) return false;
  const value = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (voiceRequestIncomplete(value)) return false;
  const request = value.replace(/^(?:(?:okay|ok|well|yeah|yes|alright|please|and|also|then)\s+)+/, '')
    .replace(/^(?:i (?:want|need) (?:you )?to|i'd like (?:you )?to|(?:can|could|would) you|would you mind)\s+/, '').replace(/^please\s+/, '');
  return /^(?:show|open|display|pull|bring|filter|sort|compare|calculate|compute|estimate|search|look up|find|close|clear|add|remove|include|exclude|change|make|use|take me|go back|go home)\b/.test(request)
    || hasPendingRequest && /^(?:only|except|without)\s+\S/.test(request)
    || /\b(?:looking for|do you have|what (?:are|is)|what's|how much|when (?:do|does)|where (?:are|is)|tell me|give me)\b/.test(value);
}

/** Recover a missed action handoff, never force a direct factual answer into a
 * paid backend round. This is a liveness safeguard, not the semantic router;
 * Live can still delegate any question that needs missing facts or reasoning.
 */
export function voiceRequestNeedsRecovery(text: string, hasPendingRequest = false) {
  if (!voiceRequestNeedsHandoff(text, hasPendingRequest)) return false;
  const request = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:okay|ok|well|yeah|yes|alright|please|and|also|then)\s+)+/, '')
    .replace(/^(?:i (?:want|need) (?:you )?to|i'd like (?:you )?to|(?:can|could|would) you|would you mind)\s+/, '').replace(/^please\s+/, '');
  return /^(?:show|open|display|pull|bring|filter|sort|compare|calculate|compute|estimate|search|look up|find|close|clear|add|remove|include|exclude|change|make|use|take me|go back|go home)\b/.test(request)
    || hasPendingRequest && /^(?:only|except|without)\s+\S/.test(request);
}

/** Narrow control hints, never a semantic turn detector or an action executor.
 * Other speech can coexist with work; Live delegates substantive new requests.
 */
export function voiceTaskSpeech(text: string): 'cancel' | 'replace' | 'quiet' | 'status' | 'continue' | null {
  const value = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:please |can you |could you )+/, '').replace(/ please$/, '');
  if (/^(?:stop (?:talking|speaking)|be quiet|quiet please)$/.test(value)) return 'quiet';
  if (/^(?:(?:cancel|stop|abort)(?: (?:that|this|it|the (?:request|task|search)|working(?: on (?:that|this|it))?))?|never mind|nevermind|forget (?:it|that))$/.test(value)) return 'cancel';
  if (/^(?:how(?:'s| is) (?:it|that|the (?:request|task|search)) (?:going|coming)|are you (?:still )?(?:working|there)|(?:any|what(?:'s| is) the) (?:progress|update|status)|(?:is|are) (?:it|you|that) (?:done|finished)(?: yet)?|did you (?:open|show|find|finish)(?: it| that| this)?(?: up)?(?: yet)?)$/.test(value)) return 'status';
  if (/^(?:keep|continue) (?:working|going)(?: on (?:that|it))?(?: while we (?:talk|chat))?$/.test(value)) return 'continue';
  if (visitorPageIntent(text)) return 'replace';
  // A bounded explicit redirection can invalidate old results before the next
  // delegation. A transcript gap or ordinary conversation cannot do so alone.
  if (/\bactually (?:show|open|find|search|use|change|make|go|take|close|cancel|stop)\b/.test(value)
    || /^(?:show|open|find|search|use|change|make|go|take|close)\b.+\binstead$/.test(value)) return 'replace';
  return null;
}
