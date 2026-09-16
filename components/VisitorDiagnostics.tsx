'use client';
import { useSyncExternalStore } from 'react';
import { clearVisitorDiagnostics, emptyVisitorDiagnostics, subscribeVisitorDiagnostics, visitorDiagnostics } from '@/lib/visitor-diagnostics';
import VisitorTestRecorder from './VisitorTestRecorder';

export default function VisitorDiagnostics() {
  const events = useSyncExternalStore(subscribeVisitorDiagnostics, visitorDiagnostics, emptyVisitorDiagnostics);
  return <><details data-visitor-diagnostics style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 1500, maxWidth: 'min(650px, 95vw)', background: '#151a23', color: '#eef2fa', padding: 8, borderRadius: 8, font: '12px/1.5 monospace' }}>
    <summary>Developer diagnostics · {events.length}</summary>
    <p>Operational timings and outcomes only. Content is recorded separately only when the local test recorder is enabled.</p>
    <button type="button" onClick={clearVisitorDiagnostics}>Clear diagnostics</button>
    <pre style={{ maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(events, null, 2)}</pre>
  </details>{process.env.NODE_ENV === 'development' && <VisitorTestRecorder/>}</>;
}
