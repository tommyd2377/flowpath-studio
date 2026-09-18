'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { TestEvent } from '@/lib/visitor-test-events';
import { recordingApi } from '@/lib/visitor-test-recording-client';
import styles from './VisitorTestRecorder.module.css';
type Session = { id: string; startedAt: number; label: string; active: boolean; dropped: number; bytes: number; error?: string };
async function loadTimeline(selected?: string) {
  const { sessions }: { sessions: Session[] } = await (await recordingApi({ action: 'list' })).json();
  const id = selected ?? new URLSearchParams(location.search).get('id') ?? sessions[0]?.id ?? '';
  const events: TestEvent[] = id ? (await (await recordingApi({ action: 'read', id })).json()).events : [];
  return { sessions, id, events };
}
export default function VisitorTestTimeline() {
  const [sessions, setSessions] = useState<Session[]>([]), [id, setId] = useState(''), [events, setEvents] = useState<TestEvent[]>([]);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [error, setError] = useState(''), [busy, setBusy] = useState(true), [limit, setLimit] = useState(100);
  const refresh = useCallback(async (selected?: string) => {
    try {
      const result = await loadTimeline(selected); setSessions(result.sessions); setId(result.id); setEvents(result.events); setError('');
    } catch { setError('Could not load local recordings. Keep the development server running.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let current = true;
    void loadTimeline().then(result => { if (current) { setSessions(result.sessions); setId(result.id); setEvents(result.events); } })
      .catch(() => { if (current) setError('Could not load local recordings. Keep the development server running.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, []);
  const selected = sessions.find(session => session.id === id);
  const rows = useMemo(() => events.filter(event => (filter === 'all' || filter === 'problems' && event.type === 'problem.marked' || filter === 'errors' && /fail|error|cancel|reject/.test(JSON.stringify(event.data)) || filter === 'conversation' && /transcript|chat.submitted|chat.reply/.test(`${event.type} ${(event.data as { type?: string } | null)?.type ?? ''}`) || filter === 'models' && /model|voice.sent|voice.config/.test(event.type))
    && `${new Date(event.at).toLocaleTimeString()} ${new Date(event.at).toISOString()} ${JSON.stringify(event)}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.at - b.at || a.sequence - b.sequence), [events, filter, query]);
  async function exportRecording() {
    setError('');
    try { const response = await recordingApi({ action: 'export', id }); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `flowpath-test-${id}.jsonl`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setError('Could not export this recording.'); }
  }
  return <main className={styles.viewer}>
    <header><h1>Local test timeline</h1><p>Recorded observations from your visitor tests. Model inputs show what was supplied, not hidden reasoning. Transcript output does not prove speech was heard.</p><Link href="/">Back to Studio</Link></header>
    <div className={styles.toolbar}>
      <label>Test session<select value={id} disabled={busy} onChange={event => { setBusy(true); setLimit(100); void refresh(event.target.value); }}><option value="">Choose a recording</option>{sessions.map(session => <option key={session.id} value={session.id}>{new Date(session.startedAt).toLocaleString()} · {session.label}{session.active ? ' · Recording' : ''}</option>)}</select></label>
      <button disabled={busy} onClick={() => { setBusy(true); void refresh(id || undefined); }}>{busy ? 'Loading…' : 'Refresh timeline'}</button>
      <button disabled={!id || busy} onClick={() => void exportRecording()}>Export recording</button>
      <button disabled={!id || busy} onClick={() => { if (confirm('Delete this local recording permanently?')) void recordingApi({ action: 'delete', id }).then(() => { history.replaceState(null, '', '/dev/recordings'); return refresh(''); }).catch(() => setError('Could not delete recording.')); }}>Delete recording</button>
    </div>
    {selected && <p>{selected.active ? 'Recording is active. Refresh to see new events.' : 'Recording is stopped.'} {events.length} events · {(selected.bytes / 1_000_000).toFixed(2)} MB · {selected.dropped} dropped. {selected.error}</p>}
    {events.some(event => event.type === 'voice.capture_attached') && <p>Voice capture attached during the connection. Earlier unrecorded speech and model activity are unavailable; attachment snapshots describe application state, not reconstructed model history.</p>}
    {events.some(event => event.type.startsWith('voice.')) && !events.some(event => event.type === 'voice.config' || event.type === 'voice.capture_attached') && <p role="alert">Incomplete voice capture: this recording has no confirmed server attachment. Assistant speech and model context may be missing.</p>}
    {events.some(event => event.truncated) && <p>Some events exceeded capture limits and are marked incomplete.</p>}
    <div className={styles.toolbar}>
      <label>Search time, text, request ID<input value={query} onChange={event => { setQuery(event.target.value); setLimit(100); }} placeholder="10:42 or photo gallery"/></label>
      <label>Show<select value={filter} onChange={event => { setFilter(event.target.value); setLimit(100); }}><option value="all">All events</option><option value="problems">Problem markers</option><option value="errors">Failures and cancellations</option><option value="conversation">Conversation</option><option value="models">Model inputs and outputs</option></select></label>
    </div>
    <p className={styles.muted}>Clock times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Browser and server monotonic clocks have separate origins; use request IDs, turn numbers and acknowledgments to follow causality. Starting or listing recordings removes files older than 7 days and keeps at most 10 sessions.</p>
    {error && <p role="alert">{error}</p>}<p role="status">{rows.length} matching events</p>
    <ol className={styles.events}>{rows.slice(0, limit).map(event => <li className={`${styles.event} ${event.type === 'problem.marked' ? styles.problem : ''}`} key={event.sequence}>
      <details><summary><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], { hour12: false })}.{String(event.at % 1000).padStart(3, '0')}</time> · {event.source} · <strong>{event.type}</strong>{event.turn !== undefined ? ` · turn ${event.turn}` : ''}{event.truncated ? ' · INCOMPLETE' : ''}{event.redacted ? ' · redacted' : ''}</summary>
        {event.traceId && <p>Request: {event.traceId}</p>}<pre>{JSON.stringify(event.data, null, 2)}</pre>
      </details>
    </li>)}</ol>
    {rows.length > limit && <button onClick={() => setLimit(limit + 100)}>Show 100 more events</button>}
  </main>;
}
