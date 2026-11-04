'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { PracticeId } from '@/lib/practice-contract';
import type { LiveTextDisplay } from '@/lib/live-text-session';

type DisplayKind = LiveTextDisplay | 'visual' | PracticeId;
const slot: Record<DisplayKind, number> = { text: 0, quiz: 40, lessons: 80, knowledge: 120, flashcards: 180, visual: 240, interview: 300 };
const shortest = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

/** Presentation only: the voice host and session controller outlive each turn. */
export default function PluginCarousel({ display, children }: { display: DisplayKind; children: ReactNode }) {
  const deck = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const previous = useRef<{ display: DisplayKind; snapshot: HTMLDivElement } | null>(null);
  const rotation = useRef({ ring: -slot[display], face: 0, frame: 0 });

  useLayoutEffect(() => {
    const container = deck.current, incoming = face.current;
    if (!container || !incoming) return;
    const last = previous.current;
    previous.current = { display, snapshot: incoming.cloneNode(true) as HTMLDivElement };
    if (!last || last.display === display) return;
    const motion = rotation.current;
    cancelAnimationFrame(motion.frame);
    container.querySelector('.plugin-carousel__outgoing')?.remove();
    const from = motion.ring, travel = shortest(-slot[display] - from), destination = from + travel;
    const outgoingStart = motion.face;
    const settle = () => {
      motion.ring = shortest(destination); motion.face = 0; motion.frame = 0;
      container.querySelector('.plugin-carousel__outgoing')?.remove();
      incoming.style.transform = 'none'; incoming.style.visibility = 'visible'; incoming.style.zIndex = '2'; incoming.inert = false;
      container.dataset.turning = 'false';
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(travel) < .01) { settle(); return; }
    const outgoing = last.snapshot;
    outgoing.classList.add('plugin-carousel__outgoing'); outgoing.setAttribute('aria-hidden', 'true'); outgoing.inert = true;
    outgoing.removeAttribute('id'); outgoing.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    container.append(outgoing);
    incoming.inert = true;
    const width = container.clientWidth, radius = Math.max(120, width * .6);
    const presentation = Math.sign(travel) * Math.max(120, Math.abs(travel));
    container.style.perspective = `${Math.max(950, width * 2)}px`;
    container.dataset.turning = 'true'; container.dataset.duration = '800';
    const position = (node: HTMLElement, angle: number) => {
      const radians = angle * Math.PI / 180, depth = radius * (Math.cos(radians) - 1);
      node.style.transform = `translate3d(${radius * Math.sin(radians)}px,0,${depth}px) rotateY(${angle}deg)`;
      node.style.visibility = Math.cos(radians) > .001 ? 'visible' : 'hidden';
      node.style.zIndex = String(Math.round(10000 + depth));
    };
    const paint = (progress: number) => {
      motion.ring = from + travel * progress;
      motion.face = -presentation * (1 - progress);
      position(outgoing, outgoingStart + presentation * progress); position(incoming, motion.face);
    };
    paint(0);
    const start = performance.now();
    const tick = (now: number) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { settle(); return; }
      const t = Math.min(1, Math.max(0, (now - start) / 800));
      paint(t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      if (t < 1) motion.frame = requestAnimationFrame(tick);
      else settle();
    };
    motion.frame = requestAnimationFrame(tick);
  }, [display, children]);

  useLayoutEffect(() => {
    const motion = rotation.current;
    return () => { cancelAnimationFrame(motion.frame); };
  }, []);

  return <div ref={deck} className="plugin-carousel" data-display={display} data-turning="false">
    <div ref={face} className="plugin-carousel__face">{children}</div>
  </div>;
}
