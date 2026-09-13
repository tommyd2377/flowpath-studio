'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { FocusStage, FocusSurface, ReturnAnchor, VoiceFocusBridge } from './components.js';
import { referenceKey, workspaceRecord, type WorkspaceAuthority, type WorkspaceObject, type WorkspaceOperation, type WorkspaceReference } from './workspace.js';

type Rect = { x: number; y: number; width: number; height: number };
const rectangle = (node: Element): Rect => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
// The same symmetric timing/easing used by ConversationDock. No second motion runtime.
export const workspaceTravel = { duration: .8, ease: [.22, 1, .36, 1] as const };
export type WorkspaceRender = (object: WorkspaceObject, focused: boolean) => ReactNode;
const interactive = 'button, a, input, select, textarea, summary, label, [role="button"], [contenteditable="true"], dialog';
const selectingText = () => Boolean(window.getSelection()?.toString());

function TravelingSurface({ object, name, owner, from, to, render, onOperation, onSettled, style, focusKeyboard, highlightedReference, onHome }: {
  object: WorkspaceObject; name: string; owner: string; from: Rect; to: Rect; render: WorkspaceRender;
  onOperation: (operations: WorkspaceOperation[]) => void; onSettled: () => void; style?: CSSProperties; focusKeyboard: boolean;
  highlightedReference?: WorkspaceReference | null; onHome?: () => void;
}) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = root.current;
    const prior = document.activeElement;
    const frame = requestAnimationFrame(() => {
      if (present && focusKeyboard && document.activeElement === prior) current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [present, focusKeyboard]);
  useLayoutEffect(() => { const scroll = root.current?.querySelector('[data-workspace-scroll]'); if (scroll) scroll.scrollTop = object.scrollTop; }, [object.instanceId, object.scrollTop]);
  return <motion.div ref={root} className="platform-workspace-flight" data-workspace-owner={owner} data-workspace-object={object.instanceId} data-workspace-focused="true"
    data-workspace-highlighted={highlightedReference && object.references.some(ref => referenceKey(ref) === referenceKey(highlightedReference)) ? referenceKey(highlightedReference) : undefined}
    data-workspace-component={object.component} data-workspace-transition={present ? 'entering' : 'returning'} inert={!present || undefined} aria-hidden={!present || undefined}
    style={{ ...style, position: 'fixed', top: 0, left: 0 }} initial={reduced ? false : from} animate={to}
    exit={reduced ? { ...from, opacity: 0 } : from} transition={{ ...workspaceTravel, duration: reduced ? 0 : workspaceTravel.duration }}
    onAnimationComplete={() => { if (root.current && present) root.current.dataset.workspaceTransition = 'settled'; onSettled(); }}
    onClick={event => { if (present && event.target instanceof Element && !event.target.closest(interactive) && !selectingText()) onOperation([{ kind: 'return' }]); }}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onOperation([{ kind: 'return' }]); } }}>
    <FocusSurface managed title={`${name} focused surface`} reference={object.references[0]?.kind === 'entity' || object.references[0]?.kind === 'photo' ? { kind: object.references[0].kind, id: object.references[0].id } : null}>
      <header className="platform-workspace-heading">{onHome && <button type="button" onClick={onHome}>Home</button>}<ReturnAnchor label="Back to workspace" onReturn={() => onOperation([{ kind: 'return' }])}/><button type="button" onClick={() => onOperation([{ kind: 'close', instanceId: object.instanceId }])} aria-label={`Close ${name}`}>Close ×</button></header>
      <div className="platform-workspace-reading" data-workspace-scroll="true" onScroll={event => { event.currentTarget.dataset.scrollTop = String(Math.round(event.currentTarget.scrollTop)); }}>
        <h2 tabIndex={-1}>{name}</h2>{render(object, true)}
      </div>
    </FocusSurface>
  </motion.div>;
}

/** A nonmodal workspace: focus changes emphasis, never the open-object set. */
export function AdaptiveWorkspace({ objects, focusedId, authority, onOperation, render, style, layout = 'balanced', onSettled, focusKeyboard = true, highlightedReference, onHome, carouselIds = [], onCarouselInteract }: {
  objects: WorkspaceObject[]; focusedId: string | null; authority: WorkspaceAuthority;
  onOperation: (operations: WorkspaceOperation[]) => void; render: WorkspaceRender; style?: CSSProperties;
  layout?: 'balanced' | 'editorial' | 'compact'; onSettled?: () => void; focusKeyboard?: boolean;
  highlightedReference?: WorkspaceReference | null; onHome?: () => void;
  carouselIds?: string[]; onCarouselInteract?: () => void;
}) {
  const owner = useId();
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const anchors = useRef(new Map<string, HTMLElement>());
  const origin = useRef(new Map<string, Rect>());
  const returnTarget = useRef<HTMLElement | null>(null);
  const clickedAnchor = useRef<string | null>(null);
  const previousFocused = useRef<WorkspaceObject | undefined>(undefined);
  const nestedReturn = useRef<{ objectId: string; focusKey: string } | null>(null);
  const [geometry, setGeometry] = useState<{ id: string; from: Rect; to: Rect; restoringChild: boolean } | null>(null);
  const [traveling, setTraveling] = useState<string[]>([]);
  const focused = objects.find(object => object.instanceId === focusedId);
  const name = (object: WorkspaceObject) => `${object.component === 'map' ? 'Map · ' : object.component === 'comparison' ? 'Compare · ' : ''}${object.references.map(ref => workspaceRecord(authority, ref)?.name ?? 'Unavailable').filter((name, index, names) => names.indexOf(name) === index).join(' / ')}`.slice(0, 160);
  useLayoutEffect(() => {
    for (const object of objects) {
      const scroll = anchors.current.get(object.instanceId)?.querySelector('[data-workspace-scroll]');
      if (scroll && object.instanceId !== focusedId) scroll.scrollTop = object.scrollTop;
    }
  }, [objects, focusedId]);
  useLayoutEffect(() => {
    const previous = previousFocused.current;
    if (focusKeyboard && focusedId && previous?.instanceId !== focusedId && previous?.origin?.objectId === focusedId) nestedReturn.current = { objectId: focusedId, focusKey: previous.origin.focusKey };
    previousFocused.current = focused;
    if (!focusedId || !root.current) { clickedAnchor.current = null; setGeometry(null); return; }
    const node = root.current;
    const measure = () => {
      const viewport = window.visualViewport;
      const site = node.closest('[data-visitor-site]') ?? node;
      let bounds = { top: viewport?.offsetTop ?? 0, bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight), left: Math.max(0, site.getBoundingClientRect().left), right: Math.min(innerWidth, site.getBoundingClientRect().right) };
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const r = parent.getBoundingClientRect(); bounds = { top: Math.max(bounds.top, r.top), bottom: Math.min(bounds.bottom, r.bottom), left: Math.max(bounds.left, r.left), right: Math.min(bounds.right, r.right) };
        }
      }
      const dock = site.querySelector('.platform-conversation-dock');
      // The composer can still be traveling home when a visitor opens a card.
      // Reserve its actual surface too, not only the smaller sticky placeholder.
      for (const control of [dock, dock?.querySelector('.platform-conversation-surface')]) {
        const rect = control?.getBoundingClientRect();
        if (rect && rect.bottom > bounds.top && rect.top < bounds.bottom) bounds.top = Math.max(bounds.top, rect.bottom + 12);
      }
      const width = Math.max(240, Math.min(900, bounds.right - bounds.left - 32));
      const height = Math.max(180, Math.min(760, bounds.bottom - bounds.top - 32));
      const to = { x: bounds.left + (bounds.right - bounds.left - width) / 2, y: bounds.top + (bounds.bottom - bounds.top - height) / 2, width, height };
      const anchor = anchors.current.get(focusedId);
      const rail = anchor?.closest<HTMLElement>('[data-workspace-carousel-rail]');
      if (anchor && rail) {
        // Move only the horizontal rail; narration must never scroll the page.
        rail.scrollLeft += anchor.getBoundingClientRect().left - rail.getBoundingClientRect().left - (rail.clientWidth - anchor.clientWidth) / 2;
        origin.current.set(focusedId, rectangle(anchor));
      }
      const focusOrigin = objects.find(object => object.instanceId === focusedId)?.origin;
      const parent = [...document.querySelectorAll<HTMLElement>('[data-workspace-focused]')].find(element => element.dataset.workspaceOwner === owner && element.dataset.workspaceObject === focusOrigin?.objectId);
      const opener = clickedAnchor.current !== focusedId && focusOrigin?.focusKey ? [...(parent ?? node.closest('.visitor-workspace'))?.querySelectorAll<HTMLElement>('[data-workspace-content]') ?? []].find(element => element.dataset.workspaceContent === focusOrigin.focusKey) : null;
      const from = origin.current.get(focusedId) ?? (opener ? rectangle(opener) : anchor ? rectangle(anchor) : { ...to, y: to.y + 24, height: Math.min(240, height) });
      if (opener) returnTarget.current = opener;
      origin.current.set(focusedId, from);
      const restoringChild = nestedReturn.current?.objectId === focusedId;
      setGeometry(previous => previous?.id === focusedId && JSON.stringify(previous.to) === JSON.stringify(to) && JSON.stringify(previous.from) === JSON.stringify(from) ? previous : { id: focusedId, from, to, restoringChild });
    };
    const anchor = anchors.current.get(focusedId);
    setTraveling(ids => ids.includes(focusedId) ? ids : [...ids, focusedId]);
    returnTarget.current = anchor?.querySelector('button') ?? root.current.querySelector('button');
    const resize = new ResizeObserver(measure);
    for (const control of node.closest('[data-visitor-site]')?.querySelectorAll('.platform-conversation-dock, .platform-conversation-surface') ?? []) resize.observe(control);
    measure(); window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure);
    return () => { resize.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [focusedId, focused, objects, owner, focusKeyboard]);
  const dispatch = (operations: WorkspaceOperation[]) => {
    const scrollNode = document.querySelector<HTMLElement>(`[data-workspace-owner="${CSS.escape(owner)}"][data-workspace-focused] [data-workspace-scroll]`);
    if (focusedId && scrollNode) operations = [{ kind: 'scroll', instanceId: focusedId, scrollTop: Math.round(scrollNode.scrollTop) }, ...operations];
    onOperation(operations);
  };
  const restore = () => {
    setTraveling(focusedId ? [focusedId] : []);
    const nested = nestedReturn.current;
    if (nested && focusedId === nested.objectId && (!document.activeElement || document.activeElement === document.body || document.activeElement.closest('[data-workspace-focused], [inert]'))) {
      const parent = [...document.querySelectorAll<HTMLElement>('[data-workspace-focused]:not([inert])')].find(element => element.dataset.workspaceOwner === owner && element.dataset.workspaceObject === nested.objectId);
      const target = [...(parent?.querySelectorAll<HTMLElement>('[data-workspace-content]') ?? [])].find(element => element.dataset.workspaceContent === nested.focusKey);
      if (target) { target.focus({ preventScroll: true }); nestedReturn.current = null; }
    }
    if (focusKeyboard && !focusedId && (!document.activeElement || document.activeElement === document.body || document.activeElement.closest('[data-workspace-focused], [inert]'))) {
      const target = returnTarget.current;
      if (target?.isConnected) target.focus({ preventScroll: true }); else root.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }
    onSettled?.();
  };
  useEffect(() => {
    if (!focusedId) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      if (event.target instanceof Element && event.target.closest('.site-wave, [aria-label="End voice conversation"], .platform-conversation-dock')) return;
      event.preventDefault(); dispatch([{ kind: 'return' }]);
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  });
  useEffect(() => {
    if (!focusedId) return;
    const outside = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || selectingText() || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const site = root.current?.closest('[data-visitor-site]') ?? root.current?.parentElement;
      if (site?.contains(event.target) && !event.target.closest(`${interactive}, [data-workspace-focused], .platform-conversation-dock`)) dispatch([{ kind: 'return' }]);
    };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  });
  const focusObject = (object: WorkspaceObject) => {
    const anchor = anchors.current.get(object.instanceId); if (anchor) origin.current.set(object.instanceId, rectangle(anchor));
    clickedAnchor.current = object.instanceId;
    dispatch([{ kind: 'scroll', instanceId: object.instanceId, scrollTop: Math.round(anchor?.querySelector('[data-workspace-scroll]')?.scrollTop ?? object.scrollTop) }, { kind: 'focus', instanceId: object.instanceId }]);
  };
  const card = (object: WorkspaceObject) => <div key={object.instanceId} className="platform-workspace-anchor" ref={(node: HTMLDivElement | null) => { if (node) anchors.current.set(object.instanceId, node); else anchors.current.delete(object.instanceId); }}>
        <motion.article layout={reduced ? false : 'position'} className="platform-workspace-card" data-workspace-object={object.instanceId} data-workspace-component={object.component}
          data-workspace-origin={object.instanceId === focusedId || undefined} data-expanded={object.expanded} data-selected={object.selected}
          data-workspace-highlighted={highlightedReference && object.references.some(ref => referenceKey(ref) === referenceKey(highlightedReference)) ? referenceKey(highlightedReference) : undefined}
          initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: object.instanceId === focusedId || traveling.includes(object.instanceId) ? 0 : 1, y: 0 }} transition={{ ...workspaceTravel, duration: reduced ? 0 : .38 }}
          onClick={event => { if (event.target instanceof Element && !event.target.closest(interactive) && !selectingText()) { event.stopPropagation(); focusObject(object); } }}
          inert={object.instanceId === focusedId || undefined} aria-hidden={object.instanceId === focusedId || undefined}>
          <header className="platform-workspace-heading"><button type="button" data-workspace-open={object.instanceId} onClick={() => focusObject(object)} aria-label={`Open ${name(object)}`}><h2>{name(object)}</h2><span aria-hidden="true">↗</span></button>
          <button type="button" aria-label={`Close ${name(object)}`} onClick={() => dispatch([{ kind: 'close', instanceId: object.instanceId }])}>×</button></header>
          <div className="platform-workspace-card-body" data-workspace-scroll="true">{render(object, false)}</div>
          <footer><button type="button" aria-pressed={object.selected} onClick={() => dispatch([{ kind: 'select', instanceId: object.instanceId, selected: !object.selected }])}>{object.selected ? 'Selected' : 'Select'}</button>
          <button type="button" aria-expanded={object.expanded} onClick={() => dispatch([{ kind: object.expanded ? 'collapse' : 'expand', instanceId: object.instanceId }])}>{object.expanded ? 'Show less' : 'More context'}</button></footer>
        </motion.article>
      </div>;
  const carousel = carouselIds.flatMap(id => objects.find(object => object.instanceId === id) ?? []);
  return <div ref={root} className="platform-workspace" data-workspace-owner={owner} data-workspace-layout={layout} style={style}>
    <VoiceFocusBridge reference={focused && ['entity', 'photo'].includes(focused.references[0].kind) ? { kind: focused.references[0].kind as 'entity' | 'photo', id: focused.references[0].id } : null} status={focused ? `${name(focused)} focused. ${objects.length} objects open.` : `${objects.length} objects open.`}/>
    <FocusStage managed focused={!!focused} label="Open workspace objects" context={<>
      {carousel.length > 0 && <section className="platform-workspace-carousel" role="region" aria-roledescription="carousel" aria-label="Welcome highlights">
        <header><span>Welcome highlights</span><div role="group" aria-label="Choose welcome highlight">{carousel.map((object, index) => <button key={object.instanceId} type="button" aria-label={`Show welcome highlight ${index + 1}: ${name(object)}`} aria-current={focusedId === object.instanceId ? 'true' : undefined} onClick={() => focusObject(object)}>{index + 1}</button>)}</div></header>
        <div className="platform-workspace-carousel-rail" data-workspace-carousel-rail="true" tabIndex={0} aria-label="Scroll welcome highlights"
          onPointerDown={event => { if (event.target instanceof Element && !event.target.closest(interactive)) onCarouselInteract?.(); }} onWheel={onCarouselInteract}
          onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) onCarouselInteract?.(); }}>
          {carousel.map(card)}
        </div>
      </section>}
      <div className="platform-workspace-grid">{objects.filter(object => !carouselIds.includes(object.instanceId)).map(card)}</div>
    </>}/>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence onExitComplete={restore}>
      {focused && geometry?.id === focusedId && <TravelingSurface key={focused.instanceId} owner={owner} object={focused} name={name(focused)} from={geometry.from} to={geometry.to} render={render} onOperation={dispatch} onSettled={() => { if (nestedReturn.current) restore(); else onSettled?.(); }} style={style} focusKeyboard={focusKeyboard && !geometry.restoringChild} highlightedReference={highlightedReference} onHome={onHome}/>}
    </AnimatePresence>, document.body)}
  </div>;
}
