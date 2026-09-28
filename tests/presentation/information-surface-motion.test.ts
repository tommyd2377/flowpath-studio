/* eslint-disable react/no-children-prop -- createElement receives the shared components' required children prop in these server-rendering tests. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionConfig, MotionConfigContext } from 'motion/react';
import { InformationFrame, InformationGrid, InformationGridItem, InformationRegion } from '../../packages/platform-ui/src/InformationSurface.js';
import { InterfaceMotion, MotionHeight, usePlatformReducedMotion } from '../../packages/platform-ui/src/motion.js';

test('the coordinated information surface renders readable content before hydration', () => {
  const html = renderToStaticMarkup(createElement(InformationFrame, { transitionKey: 'initial', onSettled() {},
    children: createElement('div', { 'data-workspace-scroll': true }, createElement('div', { 'data-layout': 'collection' },
      createElement(InformationRegion, { id: 'published-offerings', role: 'primary', kind: 'collection', reverse: false,
        children: createElement(InformationGrid, { direction: 'forward', children: ['Workshop', 'Trail guide'].map((name, index) => createElement(InformationGridItem, {
          key: `item-${index}`, id: `item-${index}`, children: createElement('button', { type: 'button' }, name),
        })) }),
      }),
    )),
  }));
  assert.match(html, /aria-label="Current information"/);
  assert.match(html, /data-information-motion="full"/);
  assert.match(html, /data-item-count="2"/);
  assert.match(html, /<button type="button">Workshop<\/button>/);
  assert.match(html, /<button type="button">Trail guide<\/button>/);
  assert.equal((html.match(/data-grid-presence="present"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /opacity:0(?:;|")|visibility:hidden|aria-hidden="true"|inert=""|scale\(/, 'First content must not depend on an animation or client-only API to become usable');
});

test('live motion preference has a stable server snapshot and preserves media markup', () => {
  function Preference() {
    const reduced = usePlatformReducedMotion();
    return createElement('span', null, reduced ? 'reduced' : 'full');
  }
  const html = renderToStaticMarkup(createElement(InterfaceMotion, { id: 'video-frame', children: createElement(MotionHeight, {
    duration: .2, children: [createElement(Preference, { key: 'preference' }), createElement('video', { key: 'film', controls: true, preload: 'none' })],
  }) }));
  assert.match(html, /<span>full<\/span>/);
  assert.match(html, /data-platform-height="true"/);
  assert.match(html, /<video controls="" preload="none"><\/video>/);
  assert.doesNotMatch(html, /opacity:0(?:;|")|autoplay|scale\(/);
});

test('registered descendants keep automatic reduced-motion protection inside every information wrapper', () => {
  function DescendantPolicy() {
    return createElement('output', null, useContext(MotionConfigContext).reducedMotion);
  }
  const probe = createElement(DescendantPolicy);
  const children = [
    createElement(InterfaceMotion, { key: 'runtime', id: 'runtime', children: probe }),
    createElement(MotionConfig, { key: 'frame', reducedMotion: 'user', children: createElement(InformationFrame, { transitionKey: 'first', onSettled() {}, children: probe }) }),
    createElement(InformationRegion, { key: 'region', id: 'region', role: 'primary', kind: 'answer', reverse: false, children: probe }),
    createElement(InformationGridItem, { key: 'item', id: 'item', children: probe }),
  ];
  const html = renderToStaticMarkup(createElement('div', null, children));
  assert.equal((html.match(/<output>user<\/output>/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<output>never<\/output>/, 'A local transform override must not disable protection for nested media, detail or registered components');
});
