'use client';

import { useEffect, useState } from 'react';
type Activity = { retained: number; totalRecorded: number; counts: Record<string, number>; events: { id: string; type: string; surface: string; source: string; kind?: string; status?: string; createdAt: number }[] };

export default function RecentActivity({ siteId }: { siteId: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/events`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Activity is unavailable.'); if (!controller.signal.aborted) setActivity(body.activity); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [siteId]);
  return <div className="domain-card"><h3>Recent product activity</h3><p>This view retains up to 200 recent events per site. Preview activity is labeled separately. A display, selection, or link click does not confirm a booking, purchase, or paid conversion.</p>{error && <p role="status">{error}</p>}{activity ? <><div className="usage-line"><span>Retained events</span><strong>{activity.retained}</strong></div><details><summary>Latest activity</summary><ol className="recent-activity">{activity.events.slice().reverse().map(event => <li key={event.id}><strong>{event.type.replaceAll('_', ' ')}</strong><span>{event.surface} · {event.kind || event.status || 'recorded'} · {event.source === 'server' ? 'server recorded' : 'browser observed'}</span></li>)}</ol></details><p>Provider attempts are tracked separately from credit balances. Product activity is not an invoice or a verified billing total.</p></> : !error && <p>Loading activity…</p>}</div>;
}
