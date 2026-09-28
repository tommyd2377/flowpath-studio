'use client';

import { Children, createContext, forwardRef, useCallback, useContext, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, animate, motion, useIsPresent, useMotionValue, usePresenceData } from 'motion/react';
import { informationTiming, revealTransition, usePlatformReducedMotion } from './motion.js';
import type { SurfaceRegion } from './surface.js';

const FrameMotion = createContext<((id: string, moving: boolean) => void) | null>(null);
function useFrameMotion() {
  const update = useContext(FrameMotion), id = useId();
  useLayoutEffect(() => () => { update?.(`${id}:reveal`, false); update?.(`${id}:layout`, false); }, [id, update]);
  return {
    onAnimationStart: () => update?.(`${id}:reveal`, true),
    onAnimationComplete: () => update?.(`${id}:reveal`, false),
    onLayoutAnimationStart: () => update?.(`${id}:layout`, true),
    onLayoutAnimationComplete: () => update?.(`${id}:layout`, false),
  };
}

function useInformationMotion(reduced: boolean, present: boolean) {
  const offset = useMotionValue(0), opacity = useMotionValue(1);
  useLayoutEffect(() => {
    if (!reduced) return;
    // Stop an in-flight arrival as well as disabling the next one. Stable
    // motion values preserve the mounted content and media element identity.
    offset.jump(0); opacity.jump(present ? 1 : 0);
  }, [offset, opacity, reduced, present]);
  return { offset, opacity };
}
const noTransform = () => 'none';

/** Animate real geometry, never scale text or video. The observed content does
 * not depend on the animated height, so measurement cannot feed back into itself. */
export const InformationFrame = forwardRef<HTMLElement, { children: ReactNode; className?: string; transitionKey: string; onSettled: (settled: boolean) => void }>(function InformationFrame({ children, className, transitionKey, onSettled }, ref) {
  const own = useRef<HTMLElement | null>(null), height = useMotionValue<number | 'auto'>('auto');
  const target = useRef(0), animation = useRef<ReturnType<typeof animate> | null>(null);
  const settled = useRef(onSettled);
  useLayoutEffect(() => { settled.current = onSettled; }, [onSettled]);
  const reduced = usePlatformReducedMotion(), groupId = useId();
  const settlingFrame = useRef(0), moving = useRef(new Map<string, number>());
  const markMoving = useCallback(() => {
    settled.current(false); cancelAnimationFrame(settlingFrame.current);
    let previous = '', stable = 0;
    const observe = () => {
      const root = own.current;
      if (!root) return;
      const position = [root, ...root.querySelectorAll<HTMLElement>('[data-surface-region], [data-grid-presence]')].map(element => {
        const rect = element.getBoundingClientRect();
        return `${[rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 2)).join(':')}:${Math.round(Number(getComputedStyle(element).opacity) * 1000)}`;
      }).join('|');
      stable = position === previous ? stable + 1 : 0; previous = position;
      if (stable >= 3) {
        // Motion can finish a stopped layout projection without calling its
        // prop completion handler. Recover that latch only after its expected
        // duration and observed stillness; ordinary completions need no delay.
        if (moving.current.size && !root.getAnimations({ subtree: true }).some(value => value.pending || value.playState === 'running')) {
          const expiredBefore = performance.now() - (informationTiming.reflow * 1000 + 80);
          for (const [id, started] of moving.current) if (started <= expiredBefore) moving.current.delete(id);
        }
        if (!moving.current.size) { settled.current(true); return; }
      }
      settlingFrame.current = requestAnimationFrame(observe);
    };
    settlingFrame.current = requestAnimationFrame(observe);
  }, []);
  const motionState = useCallback((id: string, active: boolean) => {
    if (active) moving.current.set(id, performance.now()); else moving.current.delete(id);
    markMoving();
  }, [markMoving]);
  useLayoutEffect(() => {
    const root = own.current, content = root?.querySelector<HTMLElement>('[data-workspace-scroll]'), composition = content?.querySelector<HTMLElement>('[data-layout]');
    if (!root || !content || !composition) return;
    const activeMotions = moving.current;
    if (reduced && target.current > 0) {
      animation.current?.stop(); height.set(target.current); activeMotions.clear(); markMoving();
    }
    let frame = 0, width = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maximum = parseFloat(getComputedStyle(root).maxHeight), style = getComputedStyle(content);
        const widthChanged = Math.abs(content.offsetWidth - width) >= 1;
        if (widthChanged) { width = content.offsetWidth; markMoving(); }
        const next = Math.min(Number.isFinite(maximum) ? maximum : innerHeight, composition.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + [...content.children].filter(child => child !== composition).reduce((sum, child) => sum + (child as HTMLElement).offsetHeight + 20, 0) + 2);
        if (Math.abs(target.current - next) < 1) return;
        markMoving();
        animation.current?.stop(); const first = target.current === 0; target.current = next;
        // Width already animates the real grid geometry. Follow its measured
        // height rather than restarting a second tween behind every resize.
        if (reduced || first || widthChanged) { height.set(next); motionState('frame-height', false); }
        else {
          motionState('frame-height', true);
          animation.current = animate(height, next, { ...revealTransition, duration: informationTiming.reflow, onComplete: () => motionState('frame-height', false) });
        }
      });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(composition); observer.observe(content);
    const contentChanges = new MutationObserver(measure); contentChanges.observe(content, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); contentChanges.disconnect(); animation.current?.stop(); activeMotions.delete('frame-height'); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [height, reduced, markMoving, motionState]);
  useLayoutEffect(() => {
    markMoving();
    return () => cancelAnimationFrame(settlingFrame.current);
  }, [transitionKey, markMoving]);
  return <LayoutGroup id={groupId}><FrameMotion.Provider value={motionState}><motion.article layoutRoot ref={element => { own.current = element; if (typeof ref === 'function') ref(element); else if (ref) ref.current = element; }} className={`platform-information-frame${className ? ` ${className}` : ''}`} data-information-motion={reduced ? 'reduced' : 'full'} style={{ height }} tabIndex={-1} aria-label="Current information">{children}</motion.article></FrameMotion.Provider></LayoutGroup>;
});

/** Stable canonical key + position-only projection preserves interactive children. */
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
export const InformationRegion = forwardRef<HTMLElement, { children: ReactNode; id: string; role: SurfaceRegion['role']; kind: SurfaceRegion['kind']; reverse: boolean; className?: string }>(function InformationRegion({ children, id, role, kind, reverse, className }, ref) {
  const reduced = usePlatformReducedMotion();
  const present = useIsPresent(), travel = usePresenceData();
  const { offset, opacity } = useInformationMotion(reduced, present);
  const motionEvents = useFrameMotion();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  // Only this measured element uses our live preference; registered content
  // keeps automatic reduction even when it supplies explicit transitions.
  return <MotionConfig reducedMotion="never"><motion.section {...motionEvents} ref={ref} layout={reduced ? false : 'position'} transformTemplate={reduced ? noTransform : undefined} style={{ x: offset, opacity }} className={className} data-surface-region={id} data-role={role} data-kind={kind} inert={!present} aria-hidden={!present || undefined}
    initial={!hydrated || reduced ? false : { opacity: 0, x: reverse ? -18 : 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : travel === 'back' ? 18 : -18, transition: { ...revealTransition, duration: reduced ? 0 : informationTiming.exit } }}
    transition={{ ...revealTransition, duration: reduced ? 0 : informationTiming.enter, opacity: { duration: reduced ? 0 : informationTiming.opacity }, layout: { ...revealTransition, duration: reduced ? 0 : informationTiming.reflow } }}>
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  </motion.section></MotionConfig>;
});

/** Stable record keys keep retained items mounted while excluded items drop out. */
export function InformationGrid({ children, direction, className, photos = false }: { children: ReactNode; photos?: boolean; direction: 'back' | 'forward'; className?: string }) {
  return <div className={className} data-information-grid data-item-count={Children.count(children)} data-photos={photos} style={{ position: 'relative' }}><AnimatePresence initial={false} mode="popLayout" custom={direction}>{children}</AnimatePresence></div>;
}
export const InformationGridItem = forwardRef<HTMLElement, { children: ReactNode; id: string; className?: string }>(function InformationGridItem({ children, id, className }, ref) {
  const reduced = usePlatformReducedMotion(), present = useIsPresent(), direction = usePresenceData();
  const { offset, opacity } = useInformationMotion(reduced, present);
  const motionEvents = useFrameMotion();
  return <MotionConfig reducedMotion="never"><motion.article {...motionEvents} ref={ref} layout={reduced ? false : 'position'} transformTemplate={reduced ? noTransform : undefined} style={{ y: offset, opacity }} className={className} data-task-record={id} data-grid-presence={present ? 'present' : 'exiting'} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: direction === 'back' ? 28 : -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : direction === 'back' ? -12 : 28, transition: { ...revealTransition, duration: reduced ? 0 : informationTiming.exit } }}
    transition={{ ...revealTransition, duration: reduced ? 0 : informationTiming.enter, opacity: { duration: reduced ? 0 : informationTiming.opacity }, layout: { ...revealTransition, duration: reduced ? 0 : informationTiming.reflow } }}><MotionConfig reducedMotion="user">{children}</MotionConfig></motion.article></MotionConfig>;
});
