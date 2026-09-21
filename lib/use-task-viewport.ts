'use client';
import { workspaceElementVisible } from './workspace-screen';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { displayedTaskRecordIds, type VisitorTaskView } from '@thevoice/platform-ui/task-view';

/** Track current visible records independently of one-time action completion. */
export function useTaskViewport(root: RefObject<HTMLElement | null>, open: boolean, nextSceneRevision: () => number, request: (input: unknown, signal?: AbortSignal) => Promise<unknown>) {
  const accepted = useRef<VisitorTaskView | null>(null), pending = useRef<Promise<void>>(Promise.resolve());
  const transport = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), dirty = useRef(false), failure = useRef<unknown>(null), last = useRef('');
  const recordIds = useCallback((view = accepted.current) => {
    if (!root.current || root.current.dataset.carouselActive === 'false' || document.visibilityState !== 'visible') return [];
    const viewport = window.visualViewport, top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
    const bottom = top + (viewport?.height ?? innerHeight), right = left + (viewport?.width ?? innerWidth);
    const allowed = new Set(view ? displayedTaskRecordIds(view) : []);
    const records = [...root.current.querySelectorAll<HTMLElement>('[data-task-record]')].flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (!allowed.has(element.dataset.taskRecord!) || !workspaceElementVisible(element) || element.closest('[inert], [hidden], [aria-hidden="true"]') || element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false || getComputedStyle(element).visibility === 'hidden' || rect.width <= 0 || rect.height <= 0 || rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) return [];
      return [{ id: element.dataset.taskRecord!, top: rect.top, left: rect.left }];
    }).sort((a, b) => a.top - b.top || a.left - b.left);
    return [...new Set(records.map(record => record.id))].slice(0, 48);
  }, [root]);
  const publish = useCallback((ready: boolean) => {
    const view = accepted.current;
    if (!view?.operationId || root.current?.dataset.carouselActive === 'false') return;
    const ids = ready ? recordIds() : [], key = `${view.operationId}:${ready}:${ids.join('|')}`;
    if (key === last.current && !failure.current) return;
    last.current = key;
    const input = { action: 'scene', sessionId: view.sessionId, operationId: view.operationId, generation: view.generation, queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: nextSceneRevision(), recordIds: ids, ready };
    pending.current = pending.current.then(async () => {
      if (accepted.current !== view) return;
      const controller = new AbortController(); transport.current = controller;
      try { await request(input, controller.signal); if (accepted.current === view) failure.current = null; }
      catch (error) { if (!controller.signal.aborted && accepted.current === view) failure.current = error; }
      finally { if (transport.current === controller) transport.current = null; }
    });
  }, [recordIds, request, nextSceneRevision, root]);
  const settle = useCallback(async () => {
    clearTimeout(timer.current); dirty.current = false; publish(true); await pending.current;
    if (failure.current) throw new Error('The visible collection could not be synchronized. Refresh the results before continuing.');
  }, [publish]);
  const pause = useCallback(() => { clearTimeout(timer.current); transport.current?.abort(); accepted.current = null; dirty.current = false; last.current = ''; failure.current = null; }, []);
  const accept = useCallback(async (view: VisitorTaskView, initialRecordIds?: string[]) => {
    accepted.current = view.active ? view : null;
    if (initialRecordIds) { last.current = `${view.operationId}:true:${initialRecordIds.join('|')}`; failure.current = null; }
    await settle();
  }, [settle]);
  useEffect(() => {
    if (!open || !root.current) return;
    const element = root.current;
    const changed = () => {
      if (!accepted.current) return;
      const key = `${accepted.current.operationId}:true:${recordIds().join('|')}`;
      if (!dirty.current && key === last.current) return;
      if (!dirty.current) { dirty.current = true; publish(false); }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { dirty.current = false; publish(true); }, 150);
    };
    const mutations = new MutationObserver(changed); mutations.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden', 'inert', 'aria-hidden'] });
    const resize = new ResizeObserver(changed); resize.observe(element);
    window.addEventListener('scroll', changed, true); window.addEventListener('resize', changed); document.addEventListener('visibilitychange', changed);
    window.visualViewport?.addEventListener('scroll', changed); window.visualViewport?.addEventListener('resize', changed);
    return () => { clearTimeout(timer.current); mutations.disconnect(); resize.disconnect(); window.removeEventListener('scroll', changed, true); window.removeEventListener('resize', changed); document.removeEventListener('visibilitychange', changed); window.visualViewport?.removeEventListener('scroll', changed); window.visualViewport?.removeEventListener('resize', changed); };
  }, [open, root, recordIds, publish]);
  return { pause, accept, settle, recordIds };
}
