'use client';

import { forwardRef, useLayoutEffect, useRef, type ReactNode } from 'react';
import { animate, LayoutGroup, MotionConfig, motion, stagger, useIsPresent, useMotionValue, useReducedMotion, type Variants } from 'motion/react';
import type { SemanticTransition } from './contracts.js';

/** The only motion roles available to a published presentation. */
export const motionTiming = { reveal: 0.48, disclosure: 0.48, reflow: 0.56, workspace: 0.62, exit: 0.4, feedback: 0.22 } as const;
export const surfaceTransition = { type: 'spring', visualDuration: 0.46, bounce: 0.08 } as const;
export const revealTransition = { type: 'tween', duration: motionTiming.reveal, ease: [0.22, 0.61, 0.36, 1] } as const;
export const feedbackTransition = { type: 'spring', visualDuration: motionTiming.feedback, bounce: 0.12 } as const;

/** Coordinated page rhythm: one restrained entrance per new collection or reading view. */
export const sequenceVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { when: 'beforeChildren', delayChildren: stagger(0.055, { startDelay: 0.02 }) } },
};
export const sequenceItemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: revealTransition },
  exit: { opacity: 0, y: -7, transition: { ...revealTransition, duration: motionTiming.exit } },
};

export function InterfaceMotion({ children, id }: { children: ReactNode; id: string }) {
  const reduced = useReducedMotion();
  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reveal, layout: reduced ? { duration: 0 } : surfaceTransition }}><LayoutGroup id={id}>{children}</LayoutGroup></MotionConfig>;
}

/** Animate the surrounding flow without scaling its text or delaying nested disclosures. */
export function MotionHeight({ children, className, duration = motionTiming.reflow, clip = false }: {
  children: ReactNode; className?: string; duration?: number; clip?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null);
  const running = useRef<ReturnType<typeof animate> | null>(null);
  const height = useMotionValue<number | 'auto'>('auto');
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const next = content.current?.getBoundingClientRect().height;
    if (next === undefined) return;
    const previous = target.current;
    target.current = next;
    if (reduced) { running.current?.stop(); height.set(next); return; }
    if (previous !== null && Math.abs(previous - next) < 0.5) return;
    running.current?.stop();
    if (previous === null) height.set(next);
    else running.current = animate(height, next, { ...surfaceTransition, duration });
  });
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().height;
      if (target.current !== null && Math.abs(target.current - next) < 0.5) return;
      // Child-local disclosures already animate their real height. Follow those
      // frames directly rather than adding another full animation behind them.
      target.current = next; running.current?.stop(); height.set(next);
    });
    observer.observe(element);
    return () => { observer.disconnect(); running.current?.stop(); };
  }, [height]);
  return <motion.div className={className} data-platform-height style={{ height, ...(clip ? { overflow: 'clip' } : {}) }}>
    <div ref={content} style={{ display: 'flow-root' }}>{children}</div>
  </motion.div>;
}

export function Disclosure({ children, name }: { children: ReactNode; name: string }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return <motion.div data-platform-disclosure={name} inert={!present} aria-hidden={!present || undefined} style={{ overflow: 'clip' }}
    initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.disclosure, opacity: { duration: reduced ? 0 : motionTiming.feedback } }}>{children}</motion.div>;
}

export const SemanticSurface = forwardRef<HTMLDivElement, { children: ReactNode; name: string; intent?: SemanticTransition['type'] }>(function SemanticSurface({ children, name, intent = 'none' }, ref) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const still = reduced || intent === 'none';
  const duration = intent === 'workspace-shift' || intent === 'restore' || intent === 'focus' ? motionTiming.workspace : motionTiming.reveal;
  const movement = intent === 'restore' ? -1 : intent === 'workspace-shift' ? 1 : 0;
  const rise = intent === 'reveal' ? 12 : intent === 'expand' ? 4 : 0;
  return <motion.div ref={ref} layout={reduced ? false : 'position'} className={`platform-slot platform-slot-${name}`} data-platform-slot={name}
    inert={!present} aria-hidden={!present || undefined}
    initial={still ? false : { opacity: 0, x: movement * 14, y: rise }}
    animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0, x: still ? 0 : movement * -10, y: 0, transition: { ...revealTransition, duration: reduced ? 0 : motionTiming.exit } }}
    transition={{ ...revealTransition, duration: reduced ? 0 : duration, opacity: { duration: reduced ? 0 : motionTiming.feedback }, layout: reduced ? { duration: 0 } : surfaceTransition }}>
    {children}
  </motion.div>;
});
