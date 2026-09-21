'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { cancelFrame, frame, scroll, stagger, useAnimate, type DOMKeyframesDefinition } from 'motion/react';
import type { WebsiteMotion, WebsiteTemplate } from './site-design.js';

/** Studio previews scroll independently from the document. */
function scrollRoot(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return undefined;
}

const rhythm = {
  editorial: { distance: 42, duration: .86, stagger: .1, ease: [.22, .68, .2, 1] as const },
  showcase: { distance: 54, duration: .94, stagger: .12, ease: [.18, .66, .24, 1] as const },
  clarity: { distance: 30, duration: .64, stagger: .075, ease: [.22, .61, .36, 1] as const },
};
const targets = '[data-website-reveal], [data-website-frame]';
const reducedQuery = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (changed: () => void) => {
  const query = matchMedia(reducedQuery);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};

/** React-scoped Motion enhancement. Server HTML is always the readable final state. */
export function useWebsiteMotion(mode: WebsiteMotion, active: boolean, template: WebsiteTemplate = 'clarity') {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const seen = useRef(new WeakSet<Element>());
  const resets = useRef(new WeakMap<HTMLElement, () => void>());
  // Motion 13.2's useReducedMotion samples on mount. Gestures also need to
  // respond immediately when the OS preference changes during this visit.
  const reduced = useSyncExternalStore(subscribeReduced, () => matchMedia(reducedQuery).matches, () => false);
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let dispose = () => {};
    const isWide = () => {
      const style = getComputedStyle(root);
      return root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) > 760;
    };
    let wide = isWide();
    const start = () => {
      dispose();
      root.setAttribute('data-website-reduced', String(preference.matches));
      if (!active || mode === 'off' || preference.matches || document.hidden || typeof IntersectionObserver === 'undefined') return;
      const container = scrollRoot(root);
      const timing = rhythm[template];
      const distance = timing.distance * (wide ? 1 : .7) * (mode === 'expressive' ? 1.15 : 1);
      const running = new Map<HTMLElement, ReturnType<typeof animate>>();
      const subscriptions = new Map<HTMLElement, { image: HTMLImageElement; stop: () => void }>();
      const observed = new Set<HTMLElement>();
      const depthObserved = new Set<HTMLElement>();
      const reset = (node: HTMLElement) => {
        node.style.removeProperty('transform'); node.style.removeProperty('opacity'); node.style.removeProperty('clip-path');
      };
      const finish = (node: HTMLElement, deferred = true) => {
        const pending = resets.current.get(node);
        if (pending) { cancelFrame(pending); resets.current.delete(node); }
        running.get(node)?.cancel(); running.delete(node); reset(node);
        // Motion can queue its final style write after resolving the animation.
        // Clear it after that render, without leaving a new containing block.
        if (deferred) {
          const settle = () => { reset(node); resets.current.delete(node); };
          resets.current.set(node, settle); frame.postRender(settle);
        }
      };
      const play = (node: HTMLElement, keyframes: DOMKeyframesDefinition, duration: number, delay = 0) => {
        finish(node, false);
        try {
          const controls = animate(node, keyframes, { duration, delay, ease: [...timing.ease] });
          running.set(node, controls);
          void controls.then(() => { if (running.get(node) === controls) finish(node); });
        } catch { reset(node); } // An unavailable animation API must never hide content.
      };
      const reveal = new IntersectionObserver(entries => {
        const arrivals = entries.filter(entry => entry.isIntersecting && !seen.current.has(entry.target));
        const groups = new Map<Element | null, number>();
        for (const entry of arrivals) {
          const node = entry.target as HTMLElement;
          seen.current.add(node); reveal.unobserve(node); node.dataset.websiteRevealed = 'true';
          const hero = node.closest('.platform-website-hero');
          const frame = node.hasAttribute('data-website-frame');
          const part = node.dataset.websiteReveal;
          const group = node.closest('.platform-website-section, .platform-website-footer');
          const index = groups.get(group) ?? 0;
          if (!hero && !frame) groups.set(group, index + 1);
          // Only contemporaneous arrivals stagger. Fast scrolling to item 48
          // must not wait behind 47 invisible items or animate a whole section.
          const delay = hero ? Math.min(Number(node.dataset.websiteOrder ?? 0), 3) * timing.stagger
            : frame ? .06 : stagger(timing.stagger)(Math.min(index, 3), 4);
          if (frame) {
            const clip = template === 'editorial' ? 'inset(0% 12% 14% 0%)' : 'inset(7% 7% 7% 7%)';
            play(node, template === 'clarity'
              ? { opacity: [.45, 1], transform: ['translateY(18px)', 'translateY(0px)'] }
              : { clipPath: [clip, 'inset(0% 0% 0% 0%)'] }, timing.duration + .12, delay);
          } else {
            const heading = node.classList.contains('platform-website-section-heading');
            const y = hero ? distance * (part === 'headline' ? 1 : .65) : distance * .65;
            const x = heading && template === 'editorial' && wide ? -18 : 0;
            play(node, { opacity: [part === 'headline' ? .35 : .45, 1], transform: [`translate(${x}px, ${y}px)`, 'translate(0px, 0px)'] }, timing.duration, delay);
          }
        }
        // Unobserve before translating: an entrance near the viewport edge can
        // move its own bounds outside the observer and otherwise cancel itself.
        // Finite entrances settle even if a fast scroll carries them offscreen.
      }, { root: container, threshold: 0, rootMargin: '0px 0px -24px 0px' });

      // Depth belongs to selected photographs, never paragraphs or the page.
      // Motion drives transforms directly, using native timelines where available.
      const depthEnabled = wide && (template === 'showcase' || (template === 'editorial' && mode === 'expressive'));
      const depth = depthEnabled ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          const frame = entry.target as HTMLElement;
          if (!entry.isIntersecting) { subscriptions.get(frame)?.stop(); subscriptions.delete(frame); frame.dataset.websiteTracking = 'false'; continue; }
          const image = frame.querySelector('img');
          if (!image || subscriptions.has(frame)) continue;
          const travel = mode === 'expressive' ? 2.2 : 1.5;
          const scale = mode === 'expressive' ? 1.05 : 1.035;
          try {
            const controls = animate(image, { transform: [`translateY(-${travel}%) scale(${scale})`, `translateY(${travel}%) scale(${scale})`] }, { duration: 1, ease: 'linear' });
            const stop = scroll(controls, { target: frame, container, offset: ['start end', 'end start'] });
            subscriptions.set(frame, { image, stop: () => { stop(); controls.stop(); } });
            frame.dataset.websiteTracking = 'true';
          } catch { image.style.removeProperty('transform'); }
        }
      }, { root: container, threshold: 0 }) : null;
      const register = () => {
        subscriptions.forEach((subscription, frame) => {
          if (!frame.isConnected || frame.querySelector('img') !== subscription.image) { subscription.stop(); subscriptions.delete(frame); frame.dataset.websiteTracking = 'false'; }
        });
        observed.forEach(node => { if (!root.contains(node)) { reveal.unobserve(node); observed.delete(node); finish(node); } });
        root.querySelectorAll<HTMLElement>(targets).forEach(node => {
          if (!observed.has(node)) { observed.add(node); if (!seen.current.has(node)) reveal.observe(node); }
        });
        root.querySelectorAll<HTMLElement>('[data-website-depth]').forEach((node, index) => {
          if (index < 2 && !depthObserved.has(node)) { depthObserved.add(node); depth?.observe(node); }
          // A failed image may have been replaced after the frame intersected.
          if (depth && index < 2 && node.querySelector('img') && !subscriptions.has(node)) { depth.unobserve(node); depth.observe(node); }
        });
      };
      const focus = (event: FocusEvent) => {
        running.forEach((_controls, node) => { if (event.target instanceof Node && node.contains(event.target)) finish(node); });
      };
      const disclose = (event: Event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement) || !details.open) return;
        const content = details.querySelector<HTMLElement>('.platform-website-answer, nav');
        if (content) play(content, { opacity: [.5, 1], transform: ['translateY(-8px)', 'translateY(0px)'] }, .3);
      };
      register();
      const additions = new MutationObserver(register);
      additions.observe(root, { childList: true, subtree: true });
      root.addEventListener('focusin', focus); root.addEventListener('toggle', disclose, true);
      dispose = () => {
        reveal.disconnect(); depth?.disconnect(); additions.disconnect();
        running.forEach((_controls, node) => finish(node));
        subscriptions.forEach(subscription => subscription.stop()); subscriptions.clear();
        root.querySelectorAll<HTMLElement>('[data-website-depth]').forEach(node => {
          node.dataset.websiteTracking = 'false'; reset(node);
          node.querySelector('img')?.style.removeProperty('transform');
        });
        root.removeEventListener('focusin', focus); root.removeEventListener('toggle', disclose, true);
      };
    };
    start();
    preference.addEventListener('change', start);
    document.addEventListener('visibilitychange', start);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const next = isWide();
      if (next !== wide) { wide = next; start(); }
    });
    resize?.observe(root);
    return () => { dispose(); resize?.disconnect(); preference.removeEventListener('change', start); document.removeEventListener('visibilitychange', start); };
  }, [scope, animate, mode, active, template]);
  return { ref: scope, motionEnabled: active && mode !== 'off' && !reduced };
}
