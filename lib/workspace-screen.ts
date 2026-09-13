import { referenceKey, workspaceRecord, type WorkspaceAuthority, type WorkspaceScene, type WorkspaceState } from '@thevoice/platform-ui/workspace';

const clamp = (value: number, max = 10000000) => Math.max(0, Math.min(max, Math.round(value)));
export function workspaceElementVisible(element: HTMLElement) {
  if (document.visibilityState !== 'visible' || !element.isConnected || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return false;
  const rect = element.getBoundingClientRect();
  let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom), left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (parent.hidden || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true' || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    if (parent !== element && /(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    if (parent !== element && /(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
  }
  let area = Math.max(0, bottom - top) * Math.max(0, right - left);
  for (const portal of document.querySelectorAll<HTMLElement>('[data-workspace-focused]:not([inert])')) {
    if (portal.contains(element) || element.contains(portal)) continue;
    const p = portal.getBoundingClientRect();
    area -= Math.max(0, Math.min(right, p.right) - Math.max(left, p.left)) * Math.max(0, Math.min(bottom, p.bottom) - Math.max(top, p.top));
  }
  return area > 1;
}
/** Bounded structural observations, not the model's proposed layout and not a screenshot. */
export function captureWorkspaceScene(root: HTMLElement | null, state: WorkspaceState, authority: WorkspaceAuthority, previous?: WorkspaceScene): WorkspaceScene {
  const owner = root?.querySelector<HTMLElement>('[data-workspace-owner]')?.dataset.workspaceOwner;
  const portals = owner ? [...document.querySelectorAll<HTMLElement>('[data-workspace-focused]')].filter(node => node.dataset.workspaceOwner === owner) : [];
  const nodes = [...(root?.querySelectorAll<HTMLElement>('[data-workspace-object]') ?? []), ...portals];
  const highlighted = [...(root?.querySelectorAll<HTMLElement>('[data-workspace-highlighted]') ?? []), ...portals.filter(portal => portal.hasAttribute('data-workspace-highlighted')), ...portals.flatMap(portal => [...portal.querySelectorAll<HTMLElement>('[data-workspace-highlighted]')])].find(workspaceElementVisible);
  const modal = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
  let remainingItems = 24;
  const objects: WorkspaceScene['objects'] = state.objects.map((object, index) => {
    const matching = nodes.filter(node => node.dataset.workspaceObject === object.instanceId);
    const node = matching.find(node => !node.closest('[inert], [aria-hidden="true"]')) ?? matching[0];
    const scroll = node?.querySelector<HTMLElement>('[data-workspace-scroll]');
    const rect = node?.getBoundingClientRect();
    let hidden = document.visibilityState !== 'visible', obscured = Boolean(modal && !modal.contains(node ?? null));
    let top = Math.max(0, rect?.top ?? 0), left = Math.max(0, rect?.left ?? 0), bottom = Math.min(innerHeight, rect?.bottom ?? 0), right = Math.min(innerWidth, rect?.right ?? 0);
    for (let parent: HTMLElement | null | undefined = node; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0 || parent.hidden) hidden = true;
      if (parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true') obscured = true;
      if (parent !== node && /(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      if (parent !== node && /(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    }
    // Nonmodal focused surfaces can obscure only part of a background object.
    let overlap = 0;
    if (rect && !node?.dataset.workspaceFocused) for (const portal of portals.filter(item => !item.hasAttribute('inert'))) {
      const p = portal.getBoundingClientRect();
      overlap += Math.max(0, Math.min(right, p.right) - Math.max(left, p.left)) * Math.max(0, Math.min(bottom, p.bottom) - Math.max(top, p.top));
    }
    const area = Math.max(0, right - left) * Math.max(0, bottom - top);
    const visible = area - overlap;
    const visibility = !node ? 'unmounted' : hidden ? 'hidden' : obscured || overlap > 0 && visible <= 1 ? 'obscured' : !rect?.width || !rect.height || area <= 1 ? 'offscreen'
      : overlap > 0 || top > rect.top + 1 || bottom < rect.bottom - 1 || left > rect.left + 1 || right < rect.right - 1 ? 'partial' : 'full';
    const bounds = root?.getBoundingClientRect();
    const center = rect ? (rect.left + rect.right) / 2 : 0, midpoint = bounds ? (bounds.left + bounds.right) / 2 : innerWidth / 2;
    const name = `${object.component === 'map' ? 'Map · ' : object.component === 'comparison' ? 'Compare · ' : ''}${object.references.map(ref => workspaceRecord(authority, ref)?.name ?? 'Unavailable').join(' / ')}`.slice(0, 160);
    return { instanceId: object.instanceId, order: index + 1, references: object.references, name, open: true, mounted: !!node, visibility,
      position: Math.abs(center - midpoint) < 48 ? 'center' : center < midpoint ? 'left' : 'right',
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: clamp(rect.width, 100000), height: clamp(rect.height, 100000) } : null,
      selected: object.selected, expanded: object.expanded,
      sections: object.expanded ? ['Published facts and related context'] : [],
      items: [...(node?.querySelectorAll<HTMLElement>('[data-workspace-content]') ?? [])].slice(0, remainingItems).flatMap((element, index) => {
        const record = authority.records.find(record => `${record.reference.kind}:${record.reference.revisionId}:${record.reference.id}` === element.dataset.workspaceContent);
        const r = element.getBoundingClientRect();
        let itemTop = Math.max(top, r.top), itemBottom = Math.min(bottom, r.bottom), itemLeft = Math.max(left, r.left), itemRight = Math.min(right, r.right);
        let itemHidden = hidden || obscured;
        // A child can be clipped by the object's reading container even while
        // its rectangle intersects the outer card (for example behind its header).
        for (let parent: HTMLElement | null = element; parent && parent !== node; parent = parent.parentElement) {
          const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0 || parent.hidden || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true') itemHidden = true;
          if (parent !== element && /(auto|scroll|hidden|clip)/.test(css.overflowY)) { itemTop = Math.max(itemTop, bounds.top); itemBottom = Math.min(itemBottom, bounds.bottom); }
          if (parent !== element && /(auto|scroll|hidden|clip)/.test(css.overflowX)) { itemLeft = Math.max(itemLeft, bounds.left); itemRight = Math.min(itemRight, bounds.right); }
        }
        let itemArea = Math.max(0, itemRight - itemLeft) * Math.max(0, itemBottom - itemTop);
        if (!node?.dataset.workspaceFocused) for (const portal of portals.filter(item => !item.hasAttribute('inert'))) {
          const p = portal.getBoundingClientRect();
          itemArea -= Math.max(0, Math.min(itemRight, p.right) - Math.max(itemLeft, p.left)) * Math.max(0, Math.min(itemBottom, p.bottom) - Math.max(itemTop, p.top));
        }
        if (record) remainingItems--;
        return record ? [{ reference: record.reference, order: index + 1, visible: !itemHidden && itemArea > 1 }] : [];
      }),
      controls: [state.focusedId === object.instanceId ? 'return' : 'focus', object.expanded ? 'collapse' : 'expand', 'close', 'select', ...(object.component === 'photo' ? ['lightbox' as const] : []), ...(scroll && scroll.scrollHeight > scroll.clientHeight ? ['scroll' as const] : [])],
      scroll: scroll ? { top: clamp(scroll.scrollTop), height: clamp(scroll.scrollHeight), viewport: clamp(scroll.clientHeight, 100000) } : null };
  });
  const photo = modal?.getAttribute('data-workspace-photo'), revisionId = modal?.getAttribute('data-workspace-media');
  const browsing = root?.dataset.browsing === 'true';
  const browseItems = browsing ? [...new Map([...(root?.querySelectorAll<HTMLElement>('[data-published-website] [data-workspace-content]') ?? [])]
    .filter(workspaceElementVisible).flatMap(element => {
      const record = authority.records.find(record => referenceKey(record.reference) === element.dataset.workspaceContent);
      return record ? [[referenceKey(record.reference), record.reference] as const] : [];
    })).values()].slice(0, 24).map((reference, index) => ({ reference, order: index + 1 })) : [];
  const next: WorkspaceScene = { page: browsing ? 'browse' : state.objects.length ? 'workspace' : 'home', browseItems, revision: previous?.revision ?? 0, workspaceRevision: state.revision, visibility: document.visibilityState === 'visible' ? 'visible' : 'hidden', focusedId: state.focusedId, objects,
    highlightedReference: authority.records.find(record => referenceKey(record.reference) === highlighted?.dataset.workspaceHighlighted)?.reference ?? null,
    keyboardFocusId: state.objects.find(object => object.instanceId === document.activeElement?.closest<HTMLElement>('[data-workspace-object]')?.dataset.workspaceObject)?.instanceId ?? null,
    pageScroll: { x: clamp(window.scrollX), y: clamp(window.scrollY) },
    modal: photo && revisionId && authority.records.some(record => record.reference.kind === 'photo' && record.reference.id === photo && record.reference.revisionId === revisionId) ? { kind: 'photo', reference: { kind: 'photo', id: photo, revisionId }, selectedId: photo }
      : modal?.getAttribute('data-workspace-external') && authority.records.some(record => record.reference.kind === 'external' && record.reference.id === modal.getAttribute('data-workspace-external'))
        ? { kind: 'external', reference: { kind: 'external', id: modal.getAttribute('data-workspace-external')!, revisionId: modal.getAttribute('data-workspace-external')! }, selectedId: (modal.getAttribute('data-workspace-image') ?? modal.getAttribute('data-workspace-source'))! } : null };
  if (!previous || JSON.stringify({ ...next, revision: 0 }) !== JSON.stringify({ ...previous, revision: 0 })) next.revision++;
  return next;
}

/** Wait for committed DOM and settled geometry. Hidden/expired requests terminate without retries. */
export async function acknowledgeWorkspace(root: HTMLElement | null, state: () => WorkspaceState, authority: WorkspaceAuthority, expectedRevision: number, signal?: AbortSignal, requiredIds: string[] = []) {
  const start = performance.now(); let previous = '', stable = 0;
  return new Promise<'applied' | 'failed' | 'cancelled'>(resolve => {
    let frame = 0;
    let finished = false;
    const timeout = setTimeout(() => finish('failed'), 2500);
    const finish = (result: 'applied' | 'failed' | 'cancelled') => { if (finished) return; finished = true; clearTimeout(timeout); cancelAnimationFrame(frame); signal?.removeEventListener('abort', abort); resolve(result); };
    const abort = () => finish('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const tick = () => {
      if (signal?.aborted || state().revision !== expectedRevision) return finish('cancelled');
      if (!root?.isConnected || document.visibilityState !== 'visible') return finish('failed');
      const scene = captureWorkspaceScene(root, state(), authority);
      const geometry = JSON.stringify(scene.objects.map(object => [object.instanceId, object.rect, object.visibility]));
      stable = geometry === previous ? stable + 1 : 0; previous = geometry;
      const focused = scene.objects.find(object => object.instanceId === state().focusedId);
      const owner = root.querySelector<HTMLElement>('[data-workspace-owner]')?.dataset.workspaceOwner;
      const unavailable = [...document.querySelectorAll<HTMLElement>('[data-workspace-unavailable]')].some(node => {
        const object = node.closest<HTMLElement>('[data-workspace-object]');
        return object?.closest<HTMLElement>('[data-workspace-owner]')?.dataset.workspaceOwner === owner
          && (object?.dataset.workspaceObject === scene.focusedId || requiredIds.includes(object?.dataset.workspaceObject ?? ''));
      });
      const returning = [...document.querySelectorAll<HTMLElement>('[data-workspace-transition="returning"]')].some(node => node.dataset.workspaceOwner === owner);
      const focusedModal = scene.modal && focused?.references.some(ref => ref.kind === scene.modal!.reference.kind && ref.id === scene.modal!.reference.id && ref.revisionId === scene.modal!.reference.revisionId);
      if (stable >= 5 && performance.now() - start > 120 && scene.objects.every(object => object.mounted)
        && scene.objects.filter(object => requiredIds.includes(object.instanceId)).every(object => !['hidden', 'unmounted'].includes(object.visibility))
        && !returning && (!focused || focusedModal || ['full', 'partial'].includes(focused.visibility))) return finish(unavailable ? 'failed' : 'applied');
      if (performance.now() - start > 2500) return finish('failed');
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}
