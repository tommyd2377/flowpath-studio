import type { VisitorMessage } from './visitor-model';
import { boundVisitorHistory, visitorHistoryText } from './visitor-conversation-bounds';

type Transcript = VisitorMessage & { id: string; revision: number };
type Entry = VisitorMessage & { transcriptId?: string; transcriptRevision?: number };

/** Conversation context only; captions and prior answers never establish factual authority. */
export class VisitorConversationHistory {
  private entries: Entry[] = [];
  private connection = 0;
  private revision = 0;
  // Keep only IDs for evicted captions, so a late correction cannot resurrect old text.
  private seenTranscripts = new Set<string>();
  private completedAnswers = new Set<number>();

  snapshot(): VisitorMessage[] { return this.entries.map(({ role, text }) => ({ role, text })); }
  checkpoint() { return this.revision; }
  invalidatePending() { this.revision++; }

  append(additions: VisitorMessage[], revision = this.revision, signal?: AbortSignal) {
    if (revision !== this.revision || signal?.aborted) return false;
    this.entries = boundVisitorHistory([...this.entries, ...additions.map(({ role, text }) => ({ role, text }))]);
    return true;
  }

  beginVoice() { this.endVoice(); return this.connection; }
  endVoice() {
    this.connection++;
    this.seenTranscripts.clear();
    this.completedAnswers.clear();
    this.entries = this.snapshot();
    this.invalidatePending();
  }

  answer(connection: number, event: { text: string; revision: number }) {
    if (connection !== this.connection || this.completedAnswers.has(event.revision) || !event.text.trim()) return false;
    this.completedAnswers.add(event.revision);
    return this.append([{ role: 'assistant', text: event.text }]);
  }

  transcript(connection: number, event: Transcript) {
    // Output captions do not prove a complete or heard answer. Only accepted
    // backend completions enter assistant history through answer().
    if (connection !== this.connection || event.role !== 'user' || !event.text.trim()) return false;
    if (this.seenTranscripts.has(event.id)) {
      const entry = this.entries.find(item => item.transcriptId === event.id);
      if (!entry || event.revision < entry.transcriptRevision!) return false;
      entry.text = visitorHistoryText(event.text); entry.transcriptRevision = event.revision;
      this.entries = boundVisitorHistory(this.entries);
    } else {
      this.seenTranscripts.add(event.id);
      this.entries = boundVisitorHistory([...this.entries, { role: event.role, text: event.text, transcriptId: event.id, transcriptRevision: event.revision }]);
    }
    return true;
  }
}
