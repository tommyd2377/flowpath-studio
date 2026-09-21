import type { VisitorMessage } from './visitor-model';

export const MAX_VISITOR_HISTORY_MESSAGES = 32;
export const MAX_VISITOR_MESSAGE_CHARACTERS = 2000;
// Bound serialized UTF-8 too: dialogue shares the 64 KiB voice-start body with SDP and view context.
export const MAX_VISITOR_HISTORY_BYTES = 24_000;
const encoder = new TextEncoder();

export function visitorHistoryText(text: string) {
  return text.slice(0, MAX_VISITOR_MESSAGE_CHARACTERS).replace(/[\uD800-\uDBFF]$/u, '');
}

export function visitorHistoryBytes(history: readonly VisitorMessage[]) {
  return encoder.encode(JSON.stringify(history.map(({ role, text }) => ({ role, text })))).byteLength;
}

/** Keep a contiguous suffix of complete entries; never promote dialogue into verified evidence. */
export function boundVisitorHistory<T extends VisitorMessage>(history: readonly T[]): T[] {
  const retained: T[] = [];
  let bytes = 2; // JSON array brackets.
  for (let index = history.length - 1; index >= Math.max(0, history.length - MAX_VISITOR_HISTORY_MESSAGES); index--) {
    const entry = { ...history[index], text: visitorHistoryText(history[index].text) };
    const entryBytes = encoder.encode(JSON.stringify({ role: entry.role, text: entry.text })).byteLength + (retained.length ? 1 : 0);
    if (bytes + entryBytes > MAX_VISITOR_HISTORY_BYTES) break;
    retained.push(entry); bytes += entryBytes;
  }
  return retained.reverse();
}
