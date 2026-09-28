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
  if (!available && !state.phone) return null;
  return <aside className={styles.controls} aria-label="Local test recorder" data-test-recorder>
    <details>
      <summary>{state.active ? '● Recording test session' : 'Local test recorder'}</summary>
      <p>Opt-in local transcripts, model inputs, actions and screen state. No audio or hidden reasoning. Old recordings are cleaned up when you next use the recorder.</p>
      <p>Recording attaches to an existing voice connection without restarting it. Earlier unrecorded speech cannot be recovered.</p>
      {state.phone && <p>{state.pairing ? 'Your Mac has paired this page. Start recording only when you are ready to share this test conversation with the local timeline.' : state.active ? `Paired phone capture ends by ${new Date(state.expiresAt!).toLocaleTimeString()}. Stop any time below.` : 'Phone capture is stopped. Create a new pairing on your Mac for another test.'}</p>}
      {state.active && <p role="status">{state.voiceCapture === 'attached' ? 'Voice server capture attached: subsequent transcript events, model activity and context are recorded.' : state.voiceCapture === 'attaching' ? 'Attaching voice server capture…' : state.voiceCapture === 'unavailable' ? 'Incomplete capture: the active voice server could not attach. Start a new voice connection while recording; earlier speech is unavailable.' : 'Browser capture active. Voice server capture will attach when you start voice.'}</p>}
      {(available || state.active || state.pairing) && <button disabled={state.busy} onClick={() => void (state.active ? stopTestRecording() : startTestRecording())}>{state.active ? 'Stop recording' : state.phone ? 'Start paired recording' : 'Record test session'}</button>}
      {state.active && <label>Problem note (optional)<input value={note} maxLength={1000} onChange={event => setNote(event.target.value)}/></label>}
      {state.dropped > 0 && <p role="status">{state.dropped} browser events dropped. The recording is incomplete.</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.phone ? <p>The timeline and exports are available only on your Mac.</p> : <a href={`/dev/recordings${state.id ? `?id=${state.id}` : ''}`} target="_blank" rel="noreferrer">Open test timeline ↗</a>}
    </details>
    {state.active && <button disabled={state.busy} className={styles.marker} onClick={() => void markTestProblem(note).then(saved => { if (saved) { setMarked(`Marked at ${new Date().toLocaleTimeString()}`); setNote(''); } })}>Mark a problem</button>}
    <span role="status">{marked}</span>
  </aside>;
}
