import { visitorPageIntent } from './visitor-navigation';

export const isVoiceBackchannel = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/)
  .every(word => /^(?:m+h+m*|m+|u+h+|u+m+|h+m+|huh|uhhuh|aha|oh|ah|ok|okay|yes|yeah|yep|right|sure)?$/.test(word));

/** Narrow control hints, never a semantic turn detector or an action executor.
 * Other speech can coexist with work; Live delegates substantive new requests.
 */
export function voiceTaskSpeech(text: string): 'cancel' | 'replace' | 'quiet' | 'status' | 'continue' | null {
  const value = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:please |can you |could you )+/, '').replace(/ please$/, '');
  if (/^(?:stop (?:talking|speaking)|be quiet|quiet please)$/.test(value)) return 'quiet';
  if (/^(?:(?:cancel|stop|abort)(?: (?:that|this|it|the (?:request|task|search)|working(?: on (?:that|this|it))?))?|never mind|nevermind|forget (?:it|that))$/.test(value)) return 'cancel';
  if (/^(?:how(?:'s| is) (?:it|that|the (?:request|task|search)) (?:going|coming)|are you (?:still )?(?:working|there)|(?:any|what(?:'s| is) the) (?:progress|update|status)|(?:is|are) (?:it|you|that) (?:done|finished)(?: yet)?)$/.test(value)) return 'status';
  if (/^(?:keep|continue) (?:working|going)(?: on (?:that|it))?(?: while we (?:talk|chat))?$/.test(value)) return 'continue';
  if (visitorPageIntent(text)) return 'replace';
  // A bounded explicit redirection can invalidate old results before the next
  // delegation. A transcript gap or ordinary conversation cannot do so alone.
  if (/\bactually (?:show|open|find|search|use|change|make|go|take|close|cancel|stop)\b/.test(value)
    || /^(?:show|open|find|search|use|change|make|go|take|close)\b.+\binstead$/.test(value)) return 'replace';
  return null;
}
