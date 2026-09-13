import { workspaceElementVisible } from './workspace-screen';
import type { VisitorContext } from './visitor-request';

type Screen = NonNullable<VisitorContext['screen']>;
const components = new Set<Screen['visibleComponentTypes'][number]>(['collection', 'criteria', 'detail', 'comparison', 'selection', 'relationships', 'actions', 'gallery']);
const bounded = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));

function scrollSurface(root: HTMLElement) {
  for (let node: HTMLElement | null = root; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

function visible(element: Element) {
  if (element instanceof HTMLElement && !workspaceElementVisible(element)) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  const dock = document.querySelector('[data-voice-dock="true"]')?.getBoundingClientRect();
  let top = Math.max(rect.top, dock && dock.top <= 1 ? dock.bottom : 0), left = Math.max(rect.left, 0), bottom = Math.min(rect.bottom, innerHeight), right = Math.min(rect.right, innerWidth);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
  }
  return bottom - top >= Math.min(12, rect.height) && right - left >= Math.min(12, rect.width) && rect.width > 0 && rect.height > 0;
}

/** Only published identifiers and bounded geometry leave the browser. */
export function captureVisitorContext(root: HTMLElement | null, base: VisitorContext, entityIds: Set<string>, sourceIds: Set<string>): VisitorContext {
  if (!root) return base;
  const scope = [...root.querySelectorAll<HTMLElement>('[data-entity-id], [data-source-id], [data-platform-slot], [data-visitor-component]')];
  const owner = root.querySelector<HTMLElement>('[data-workspace-owner]')?.dataset.workspaceOwner;
  const portals = [...document.querySelectorAll<HTMLElement>('[data-workspace-focused]:not([inert])')].filter(element => !!owner && element.dataset.workspaceOwner === owner);
  for (const portal of portals) scope.push(portal, ...portal.querySelectorAll<HTMLElement>('[data-entity-id], [data-source-id], [data-platform-slot], [data-visitor-component]'));
  // Media lightboxes are portalled outside the site, but markers still must be published.
  document.querySelectorAll<HTMLElement>('[role="dialog"] [data-source-id]').forEach(element => scope.push(element));
  const seen = scope.filter(visible).sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.top - y.top || x.left - y.left; });
  const collect = (nodes: HTMLElement[], key: string, allowed: Set<string>) => [...new Set(nodes.map(node => node.getAttribute(key)).filter((id): id is string => !!id && allowed.has(id)))].slice(0, 100);
  const focused = document.activeElement instanceof Element ? document.activeElement : null;
  const focusId = (key: string, allowed: Set<string>) => { const id = focused?.closest(`[${key}]`)?.getAttribute(key); return id && allowed.has(id) ? id : null; };
  // A focused surface remains the authoritative UI focus even when a visitor
  // moves focus to the voice control or return anchor inside it.
  const focusMarker = [...root.querySelectorAll<HTMLElement>('[data-focus-surface="true"], [data-voice-focus-bridge="true"]')].find(element => {
    if (element instanceof HTMLElement && !workspaceElementVisible(element)) return false;
    const kind = element.dataset.focusReferenceKind ?? element.dataset.voiceFocusKind;
    const id = element.dataset.focusReferenceId ?? element.dataset.voiceFocusId;
    return (element.dataset.voiceFocusBridge !== undefined ? element.dataset.voiceFocusOpen === 'true' : true) && !!kind && !!id;
  });
  const foreground = base.scene?.objects.find(object => object.instanceId === base.scene?.focusedId && ['full', 'partial'].includes(object.visibility));
  const foregroundRef = foreground?.references[0];
  const markerKind = focusMarker?.dataset.focusReferenceKind ?? focusMarker?.dataset.voiceFocusKind;
  const markerId = focusMarker?.dataset.focusReferenceId ?? focusMarker?.dataset.voiceFocusId;
  const markerEntityId = markerKind === 'entity' && markerId && entityIds.has(markerId) ? markerId : null;
  const markerSourceId = markerKind === 'photo' && markerId ? `photo:${markerId}` : null;
  const visibleComponentTypes = [...new Set(seen.map(node => node.getAttribute('data-platform-slot') || node.getAttribute('data-visitor-component')).filter((kind): kind is Screen['visibleComponentTypes'][number] => components.has(kind as Screen['visibleComponentTypes'][number])))].slice(0, 8);
  const visibleControls = [...new Set([...root.querySelectorAll<HTMLElement>('button, a[href]')].filter(visible).map(node => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()).filter(label => label.length > 0 && label.length <= 160))].slice(0, 60);
  const surface = scrollSurface(root);
  return { ...base, expandedSourceIds: collect(scope.filter(node => node.dataset.sourceExpanded === 'true' && !node.closest('[inert], [aria-hidden="true"]')), 'data-source-id', sourceIds), screen: {
    viewportWidth: bounded(surface?.clientWidth ?? innerWidth, 20000), viewportHeight: bounded(surface?.clientHeight ?? innerHeight, 20000), scrollY: bounded(surface?.scrollTop ?? scrollY, 10000000), documentHeight: bounded(surface?.scrollHeight ?? document.documentElement.scrollHeight, 10000000),
    fullyVisibleEntityIds: collect(seen.filter(node => { const rect = node.getBoundingClientRect(); const bounds = surface?.getBoundingClientRect(); return rect.top >= (bounds?.top ?? 0) && rect.bottom <= (bounds?.bottom ?? innerHeight); }), 'data-entity-id', entityIds),
    expandedEntityIds: collect(seen.filter(node => node.dataset.expanded === 'true' || node.matches('.platform-detail')), 'data-entity-id', entityIds),
    primaryEntityId: collect([...seen].sort((a, b) => { const coverage = (node: HTMLElement) => { const r = node.getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); }; return coverage(b) - coverage(a); }), 'data-entity-id', entityIds)[0] ?? null,
    visibleEntityIds: collect(seen, 'data-entity-id', entityIds), visibleSourceIds: collect(seen, 'data-source-id', sourceIds), visibleComponentTypes, visibleControls,
    focusedEntityId: (foregroundRef?.kind === 'entity' && entityIds.has(foregroundRef.id) ? foregroundRef.id : null) ?? markerEntityId ?? focusId('data-entity-id', entityIds), focusedSourceId: foregroundRef?.kind === 'source' && sourceIds.has(foregroundRef.id) ? foregroundRef.id : markerSourceId && sourceIds.has(markerSourceId) ? markerSourceId : focusId('data-source-id', sourceIds),
  } };
}

type NavigationTarget = { kind: 'top' | 'bottom' | 'entity' | 'source' | 'up' | 'down' | 'next_section' | 'previous_section' | 'current'; id?: string };
/** Navigation has no focus side effects and yields to any subsequent user input. */
export async function navigateVisitorView(root: HTMLElement | null, target: NavigationTarget, signal: AbortSignal, interrupt: () => void): Promise<'applied' | 'unavailable'> {
  if (!root || signal.aborted) return 'unavailable';
  let element: HTMLElement | undefined;
  if (target.kind === 'entity' || target.kind === 'source') {
    const attribute = target.kind === 'entity' ? 'data-entity-id' : 'data-source-id';
    element = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(node => node.getAttribute(attribute) === target.id && !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length > 0);
    if (!element) return 'unavailable';
  }
  if (target.kind === 'next_section' || target.kind === 'previous_section') {
    const sections = [...root.querySelectorAll<HTMLElement>('[data-platform-slot], [data-source-id]')].filter(node => !node.closest('[inert], [aria-hidden="true"]'));
    const edge = (scrollSurface(root)?.getBoundingClientRect().top ?? 0) + 32;
    element = target.kind === 'next_section' ? sections.find(node => node.getBoundingClientRect().top > edge) : sections.filter(node => node.getBoundingClientRect().top < edge - 32).at(-1);
    if (!element) return 'unavailable';
  }
  // FocusStage owns placement for an open entity or photo. Its fixed surface
  // is already the destination; scrolling the document would undo the shared
  // card choreography and make the voice acknowledgement describe the wrong
  // page position.
  if (element?.closest('[data-focus-layer="true"]')) return signal.aborted ? 'unavailable' : 'applied';
  const surface = scrollSurface(root);
  const position = () => surface?.scrollTop ?? scrollY;
  const height = () => surface?.scrollHeight ?? document.documentElement.scrollHeight;
  const viewport = () => surface?.clientHeight ?? innerHeight;
  const scroll = (top: number, behavior: ScrollBehavior) => surface ? surface.scrollTo({ top, behavior }) : window.scrollTo({ top, behavior });
  return new Promise(resolve => {
    let frame = 0, settled = 0, previous = '', moved = false, done = false;
    const started = performance.now();
    const cleanup = () => { cancelAnimationFrame(frame); signal.removeEventListener('abort', cancel); ['wheel', 'pointerdown', 'touchstart', 'keydown'].forEach(type => window.removeEventListener(type, manual, true)); };
    const finish = (status: 'applied' | 'unavailable') => { if (done) return; done = true; cleanup(); resolve(status); };
    const cancel = () => { if (moved) scroll(position(), 'instant'); finish('unavailable'); };
    const manual = () => { interrupt(); cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    ['wheel', 'pointerdown', 'touchstart', 'keydown'].forEach(type => window.addEventListener(type, manual, { capture: true, passive: true }));
    const tick = () => {
      if (signal.aborted) { cancel(); return; }
      const rect = element?.getBoundingClientRect();
      const geometry = `${Math.round(position())}:${Math.round(rect?.top ?? 0)}:${Math.round(rect?.height ?? 0)}:${height()}`;
      settled = geometry === previous ? settled + 1 : 0; previous = geometry;
      const elapsed = performance.now() - started;
      const moving = root.getAnimations({ subtree: true }).some(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
      if (!moved && settled >= 4 && elapsed >= 200 && !moving) {
        const top = target.kind === 'top' ? 0 : target.kind === 'bottom' ? height() : target.kind === 'up' ? position() - viewport() * .8 : target.kind === 'down' ? position() + viewport() * .8 : position() + (rect?.top ?? 0) - (surface ? surface.getBoundingClientRect().top + surface.clientTop : 0) - 16 - (root.querySelector('[data-voice-dock="true"]')?.getBoundingClientRect().height ?? 0);
        if (target.kind !== 'current') scroll(top, matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'); moved = true; settled = 0;
      } else if (moved && settled >= 6 && elapsed >= 400) {
        const maximum = Math.max(0, height() - viewport());
        const applied = target.kind === 'top' ? position() <= 2 : target.kind === 'bottom' ? Math.abs(position() - maximum) <= 2 : target.kind === 'up' || target.kind === 'down' || target.kind === 'current' ? true : !!element && visible(element);
        finish(applied ? 'applied' : 'unavailable'); return;
      }
      if (elapsed > 4500) { finish('unavailable'); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}
