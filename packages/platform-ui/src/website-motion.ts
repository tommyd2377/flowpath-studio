'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type SyntheticEvent } from 'react';
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

/** Native details remain the fallback. Only the current, reversible height
 * transition is held open; closed content becomes inert before it moves away. */
export function useWebsiteDisclosure(enabled: boolean) {
  const [ref, animate] = useAnimate<HTMLDetailsElement>();
  const [open, setOpen] = useState(false);
  const pending = useRef<{ open: boolean; finish: () => void; cancel: () => void } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    const details = ref.current;
    if (details) details.dataset.websiteDisclosureEnhanced = 'true';
    return () => { pending.current?.finish(); if (cleanup.current) { cancelFrame(cleanup.current); cleanup.current(); } if (details) delete details.dataset.websiteDisclosureEnhanced; };
  }, [ref]);
  useEffect(() => { if (!enabled) pending.current?.finish(); }, [enabled]);
  const close = () => {
    const details = ref.current;
    if (!details) return;
    details.querySelector('summary')?.focus({ preventScroll: true });
    if (pending.current) { pending.current.open = false; pending.current.finish(); }
    else details.open = false;
    setOpen(false);
  };
  const toggle = (event: MouseEvent<HTMLElement>) => {
    const details = ref.current, body = details?.querySelector<HTMLElement>('[data-website-disclosure-content]');
    if (!enabled || event.defaultPrevented || !details || !body) return;
    event.preventDefault();
    const next = !(pending.current?.open ?? details.open), from = details.open ? body.getBoundingClientRect().height : 0;
    const opacity = details.open ? Number(getComputedStyle(body).opacity) : .45;
    pending.current?.cancel();
    if (cleanup.current) { cancelFrame(cleanup.current); cleanup.current(); }
    const summary = details.querySelector('summary')!;
    if (!next && body.contains(document.activeElement)) summary.focus({ preventScroll: true });
    details.open = true;
    // Measure the natural target before starting Motion, never from an inline
    // height left by the previous transition or a hidden native details body.
    const height = next ? body.getBoundingClientRect().height : 0;
    body.inert = !next; body.setAttribute('aria-hidden', String(!next));
    summary.setAttribute('aria-expanded', String(next));
    body.style.overflow = 'clip';
    const reset = () => {
      body.style.removeProperty('height'); body.style.removeProperty('opacity'); body.style.removeProperty('overflow');
      body.inert = false; body.removeAttribute('aria-hidden'); summary.removeAttribute('aria-expanded');
    };
    let controls: ReturnType<typeof animate> | undefined;
    const transition = { open: next,
      cancel() { if (pending.current !== transition) return; pending.current = null; controls?.cancel(); reset(); },
      finish() {
        if (pending.current !== transition) return;
        details.open = transition.open; transition.cancel();
        // Motion may queue a final style write after completion. Clear it after
        // that render, cancelling this cleanup before any new transition.
        const afterRender = () => { if (cleanup.current !== afterRender || pending.current) return; reset(); cleanup.current = null; };
        cleanup.current = afterRender; frame.postRender(afterRender);
      },
    };
    pending.current = transition; setOpen(next);
    try {
      controls = animate(body, { height: [from, height], opacity: [opacity, next ? 1 : 0] }, { duration: next ? .38 : .28, ease: [.22, .68, .2, 1] });
      void controls.then(transition.finish);
    } catch { transition.finish(); }
  };
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    // Escape, an anchor selection or another native control may close details
    // during animation. That newer action always wins over its old completion.
    if (!event.currentTarget.open && pending.current) { pending.current.open = false; pending.current.finish(); }
    setOpen(pending.current?.open ?? event.currentTarget.open);
  };
  return { ref, open, toggle, onToggle, close };
}

/** A collection grows from its measured old height to its new natural height.
 * The actual entries update immediately; only surrounding geometry catches up. */
export function useWebsiteExpansion(enabled: boolean, expanded: boolean) {
  const [ref, animate] = useAnimate<HTMLDivElement>();
  const previousHeight = useRef<number | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    finish.current?.();
    if (cleanup.current) { cancelFrame(cleanup.current); cleanup.current(); }
  }, []);
  const prepare = () => {
    const body = ref.current;
    if (!body) return;
    const height = body.getBoundingClientRect().height;
    finish.current?.();
    if (cleanup.current) { cancelFrame(cleanup.current); cleanup.current(); }
    previousHeight.current = enabled ? height : null;
  };
  useLayoutEffect(() => {
    const body = ref.current, from = previousHeight.current;
    previousHeight.current = null;
    finish.current?.();
    // Disabling motion must retain the queued post-render reset: cancellation
    // can still be followed by Motion's final height write in the next frame.
    if (!body || !enabled || from === null) return;
    if (cleanup.current) { cancelFrame(cleanup.current); cleanup.current(); }
    const height = body.getBoundingClientRect().height;
    if (Math.abs(height - from) < 1) return;
    body.style.overflow = 'clip';
    body.style.overflowAnchor = 'none';
    let controls: ReturnType<typeof animate> | undefined;
    const reset = () => { body.style.removeProperty('height'); body.style.removeProperty('overflow'); body.style.removeProperty('overflow-anchor'); };
    const settle = () => {
      if (finish.current !== settle) return;
      finish.current = null; controls?.cancel(); reset();
      const afterRender = () => { if (cleanup.current !== afterRender || finish.current) return; reset(); cleanup.current = null; };
      cleanup.current = afterRender; frame.postRender(afterRender);
    };
    finish.current = settle;
    try { controls = animate(body, { height: [from, height] }, { duration: .42, ease: [.22, .68, .2, 1] }); void controls.then(settle); }
    catch { settle(); }
    return settle;
  }, [animate, enabled, expanded, ref]);
  return { ref, prepare };
}

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
          if (!hero && !frame && part !== 'rule') groups.set(group, index + 1);
          // Only contemporaneous arrivals stagger. Fast scrolling to item 48
          // must not wait behind 47 invisible items or animate a whole section.
          const delay = hero ? Math.min(Number(node.dataset.websiteOrder ?? 0), 3) * timing.stagger
            : frame ? .06 : stagger(timing.stagger)(Math.min(index, 3), 4);
          if (part === 'rule') {
            play(node, { transform: ['scaleX(.08)', 'scaleX(1)'] }, timing.duration, 0);
          } else if (frame) {
            const clip = template === 'editorial' ? `inset(0% ${wide ? 24 : 16}% 0% 0%)` : 'inset(6% 6% 6% 6%)';
            play(node, template === 'clarity'
              ? { opacity: [.65, 1], transform: ['scale(.985)', 'scale(1)'] }
              : { clipPath: [clip, 'inset(0% 0% 0% 0%)'] }, timing.duration + .12, delay);
            // A finite image-focus gesture also works on phones. It has its own
            // wrapper, so optional desktop image depth never fights its transform.
            const content = node.querySelector<HTMLElement>('.platform-website-image-content');
            if (content && template === 'showcase') play(content, { transform: [`scale(${mode === 'expressive' ? 1.075 : 1.045})`, 'scale(1)'] }, timing.duration + .18, delay);
          } else {
            const heading = node.classList.contains('platform-website-section-heading');
            const picture = !!node.querySelector('[data-website-frame]');
            const item = node.matches('li, details') || part === 'directory-item';
            if (template === 'editorial') {
              // Sideways reading rhythm and a gentle headline reveal, rather
              // than translating every paragraph vertically as one block.
              play(node, { opacity: [.65, 1], transform: [`translateX(${heading || hero ? -distance * .45 : distance * .25}px)`, 'translateX(0px)'],
                ...(part === 'headline' ? { clipPath: ['inset(0% 0% 18% 0%)', 'inset(0% 0% 0% 0%)'] } : {}) }, timing.duration, delay);
            } else if (template === 'showcase') {
              play(node, picture ? { opacity: [.8, 1] } : { opacity: [.6, 1], transform: [`translateY(${distance * (part === 'headline' ? .7 : .3)}px)`, 'translateY(0px)'] }, timing.duration, delay);
            } else {
              play(node, { opacity: [.65, 1], transform: item
                ? [`translate(${wide ? 12 : 6}px, 6px) scale(.985)`, 'translate(0px, 0px) scale(1)']
                : [`translateX(${heading ? -12 : 8}px)`, 'translateX(0px)'] }, timing.duration, delay);
            }
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
      register();
      const additions = new MutationObserver(register);
      additions.observe(root, { childList: true, subtree: true });
      root.addEventListener('focusin', focus);
      dispose = () => {
        reveal.disconnect(); depth?.disconnect(); additions.disconnect();
        running.forEach((_controls, node) => finish(node));
        subscriptions.forEach(subscription => subscription.stop()); subscriptions.clear();
        root.querySelectorAll<HTMLElement>('[data-website-depth]').forEach(node => {
          node.dataset.websiteTracking = 'false'; reset(node);
          node.querySelector('img')?.style.removeProperty('transform');
        });
        root.removeEventListener('focusin', focus);
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
