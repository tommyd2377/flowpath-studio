'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { emptyTestRecordingSnapshot, localTestRecordingAvailable, markTestProblem, resumeTestRecording, startTestRecording, stopTestRecording, subscribeTestRecording, testRecordingSnapshot } from '@/lib/visitor-test-recording-client';
import styles from './VisitorTestRecorder.module.css';
const subscribeAvailability = () => () => {};

export default function VisitorTestRecorder() {
  const state = useSyncExternalStore(subscribeTestRecording, testRecordingSnapshot, emptyTestRecordingSnapshot);
  const available = useSyncExternalStore(subscribeAvailability, localTestRecordingAvailable, () => false);
  const [note, setNote] = useState(''), [marked, setMarked] = useState('');
  useEffect(() => { void resumeTestRecording(); }, []);
  if (!available) return null;
  return <aside className={styles.controls} aria-label="Local test recorder" data-test-recorder>
    <details>
      <summary>{state.active ? '● Recording test session' : 'Local test recorder'}</summary>
      <p>Opt-in local transcripts, model inputs, actions and screen state. No audio or hidden reasoning. Old recordings are cleaned up when you next use the recorder.</p>
      <p>Start recording before starting voice. Reconnect an existing voice call to capture its server context.</p>
      <button disabled={state.busy} onClick={() => void (state.active ? stopTestRecording() : startTestRecording())}>{state.active ? 'Stop recording' : 'Record test session'}</button>
      {state.active && <label>Problem note (optional)<input value={note} maxLength={1000} onChange={event => setNote(event.target.value)}/></label>}
      {state.dropped > 0 && <p role="status">{state.dropped} browser events dropped. The recording is incomplete.</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <a href={`/dev/recordings${state.id ? `?id=${state.id}` : ''}`} target="_blank" rel="noreferrer">Open test timeline ↗</a>
    </details>
    {state.active && <button disabled={state.busy} className={styles.marker} onClick={() => void markTestProblem(note).then(saved => { if (saved) { setMarked(`Marked at ${new Date().toLocaleTimeString()}`); setNote(''); } })}>Mark a problem</button>}
    <span role="status">{marked}</span>
  </aside>;
}
