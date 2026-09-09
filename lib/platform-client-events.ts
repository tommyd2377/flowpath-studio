'use client';

import type { PlatformEventInput } from './platform-events';

const pending = new Map<string, PlatformEventInput[]>();
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function flush() {
  clearTimeout(timer); timer = undefined;
  for (const [endpoint, events] of pending) {
    pending.delete(endpoint);
    // Navigation may finish first; observations are best-effort and never block the interface.
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ events: events.slice(-10) }) }).catch(() => undefined);
  }
}

export function observePlatformEvent(endpoint: string, event: PlatformEventInput) {
  if (!listening) { window.addEventListener('pagehide', flush); listening = true; }
  const events = pending.get(endpoint) ?? [];
  events.push({ ...event, eventId: crypto.randomUUID() });
  pending.set(endpoint, events.slice(-10));
  if (!timer) timer = setTimeout(flush, 750);
}
