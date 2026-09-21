'use client';

import { Children, forwardRef, useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, usePresenceData, useReducedMotion } from 'motion/react';
import { motionTiming, revealTransition } from './motion.js';
import type { SurfaceRegion } from './surface.js';

/** Animate real geometry, never scale text or video. The observed content does
 * not depend on the animated height, so measurement cannot feed back into itself. */
export const InformationFrame = forwardRef<HTMLElement, { children: ReactNode; className?: string; transitionKey: string; onSettled: (settled: boolean) => void }>(function InformationFrame({ children, className, transitionKey, onSettled }, ref) {
  const own = useRef<HTMLElement | null>(null), height = useMotionValue<number | 'auto'>('auto');
  const target = useRef(0), animation = useRef<ReturnType<typeof animate> | null>(null);
  const settled = useRef(onSettled);
  useLayoutEffect(() => { settled.current = onSettled; }, [onSettled]);
  const reduced = useReducedMotion();
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markMoving = useCallback(() => {
    settled.current(false); clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settled.current(true), reduced ? 0 : (motionTiming.reflow + .08) * 1000);
  }, [reduced]);
  useLayoutEffect(() => {
    const root = own.current, content = root?.querySelector<HTMLElement>('[data-workspace-scroll]'), composition = content?.querySelector<HTMLElement>('[data-layout]');
    if (!root || !content || !composition) return;
    let frame = 0, width = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maximum = parseFloat(getComputedStyle(root).maxHeight), style = getComputedStyle(content);
        if (Math.abs(content.offsetWidth - width) >= 1) { width = content.offsetWidth; markMoving(); }
        const next = Math.min(Number.isFinite(maximum) ? maximum : innerHeight, composition.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + [...content.children].filter(child => child !== composition).reduce((sum, child) => sum + (child as HTMLElement).offsetHeight + 20, 0) + 2);
        if (Math.abs(target.current - next) < 1) return;
        markMoving();
        animation.current?.stop(); const first = target.current === 0; target.current = next;
        if (reduced || first) height.set(next);
        else animation.current = animate(height, next, { ...revealTransition, duration: motionTiming.reflow });
      });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(composition); observer.observe(content);
    const contentChanges = new MutationObserver(measure); contentChanges.observe(content, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); contentChanges.disconnect(); animation.current?.stop(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [height, reduced, markMoving]);
  useLayoutEffect(() => {
    markMoving();
    return () => clearTimeout(settleTimer.current);
  }, [transitionKey, markMoving]);
  return <motion.article ref={element => { own.current = element; if (typeof ref === 'function') ref(element); else if (ref) ref.current = element; }} className={`platform-information-frame${className ? ` ${className}` : ''}`} style={{ height }} tabIndex={-1} aria-label="Current information">{children}</motion.article>;
});

/** Stable canonical key + position-only projection preserves interactive children. */
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
export const InformationRegion = forwardRef<HTMLElement, { children: ReactNode; id: string; role: SurfaceRegion['role']; kind: SurfaceRegion['kind']; reverse: boolean; className?: string }>(function InformationRegion({ children, id, role, kind, reverse, className }, ref) {
  const reduced = useReducedMotion();
  const present = useIsPresent(), travel = usePresenceData();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  return <motion.section ref={ref} layout={reduced ? false : 'position'} className={className} data-surface-region={id} data-role={role} data-kind={kind} inert={!present} aria-hidden={!present || undefined}
    initial={!hydrated || reduced ? false : { opacity: 0, x: reverse ? -18 : 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : travel === 'back' ? 18 : -18 }} transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reflow }}>
    {children}
  </motion.section>;
});

/** Stable record keys keep retained items mounted while excluded items drop out. */
export function InformationGrid({ children, direction, className, photos = false }: { children: ReactNode; photos?: boolean; direction: 'back' | 'forward'; className?: string }) {
  return <div className={className} data-information-grid data-item-count={Children.count(children)} data-photos={photos} style={{ position: 'relative' }}><AnimatePresence initial={false} mode="popLayout" custom={direction}>{children}</AnimatePresence></div>;
}
export const InformationGridItem = forwardRef<HTMLElement, { children: ReactNode; id: string; className?: string }>(function InformationGridItem({ children, id, className }, ref) {
  const reduced = useReducedMotion(), present = useIsPresent(), direction = usePresenceData();
  return <motion.article ref={ref} layout={reduced ? false : 'position'} className={className} data-task-record={id} data-grid-presence={present ? 'present' : 'exiting'} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: direction === 'back' ? 28 : -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : direction === 'back' ? -12 : 28 }}
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reflow, opacity: { duration: reduced ? 0 : .24 } }}>{children}</motion.article>;
});
