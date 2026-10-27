'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import BrandLoader from './BrandLoader';

const subscribe = () => () => {};
const ready = () => true;
const starting = () => false;

/** Server-visible startup feedback, removed as soon as the app hydrates. */
export default function AppStartup({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(subscribe, ready, starting);
  return <>
    {!hydrated && <div className="app-startup"><BrandLoader variant="screen" label="Loading FlowPath…" /></div>}
    <div className="app-content" data-ready={hydrated} inert={!hydrated}>{children}</div>
  </>;
}
