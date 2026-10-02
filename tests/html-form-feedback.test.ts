import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlDocument } from '../lib/html-document';
import { htmlToText } from '../lib/source-adapters';
import { extractWebsitePage, importWebsitePages, websitePageCatalog } from '../lib/website-import';
import { unlinkedSourceProvenance } from '../lib/source-extractors';
import type { WebsiteTransport } from '../lib/website-fetch';

const success = 'Thank you! Your submission has been received!';
const failure = 'Oops! Something went wrong while submitting the form.';
const feedback = `<div class="newsletter w-form"><form><input name="email"><button>Subscribe</button></form>
  <div class="newsletter-success w-form-done"><div>${success}</div></div>
  <div class="newsletter-error w-form-fail"><div>${failure}</div></div></div>`;
const qualification = 'Please call before visiting; a request does not confirm admission.';
const html = `<html><head><title>Synthetic center</title></head><body><nav>Site navigation</nav>
  <main><h1>Admissions</h1><p>${qualification}</p>${feedback}</main>
  <footer><h2>Contact</h2><p><a href="mailto:intake@synthetic.example">intake@synthetic.example</a></p>
  <p>Monday–Friday: 9am–5pm</p><p>Individual insurance verification is required.</p>${feedback}</footer></body></html>`;

test('builder feedback beside a real form stays in raw evidence but not semantic text or reading blocks', () => {
  const page = extractWebsitePage(html, 'https://synthetic.example/admissions');
  for (const message of [success, failure]) {
    assert.equal(page.rawText?.split(message).length, 3, 'both original form states remain in private raw text');
    assert.ok(!page.text.includes(message));
    assert.ok(page.blocks?.every(block => !block.text.includes(message)));
  }
  for (const text of [qualification, 'Individual insurance verification is required.', 'intake@synthetic.example', 'Monday–Friday: 9am–5pm']) assert.ok(page.text.includes(text), text);
  assert.equal(page.contact, 'intake@synthetic.example');
  assert.equal(page.hours, 'Monday–Friday: 9am–5pm');
  assert.deepEqual(page.blocks, websitePageCatalog([page]).entities[0].blocks);
});

test('source prose and lookalike classes are not classified by their message wording', () => {
  const examples = [
    `<article><p>${success}</p><p>${failure}</p></article>`,
    `<div class="w-form-done">${success}</div><div class="w-form-fail">${failure}</div>`,
    `<div class="w-form"><p>${success}</p><div class="w-form-fail">${failure}</div></div>`,
    `<div class="w-form"><form></form><article><div class="w-form-done">${success}</div><div class="w-form-fail">${failure}</div></article></div>`,
    `<div class="w-form"><form></form><div class="w-form-done-copy">${success}</div><div class="w-form-failures">${failure}</div></div>`,
    `<div class="my-w-form"><form></form><div class="w-form-done">${success}</div><div class="w-form-fail">${failure}</div></div>`,
  ];
  for (const example of examples) {
    const document = htmlDocument(example);
    assert.ok(document.text.includes(success), example);
    assert.ok(document.text.includes(failure), example);
  }
});

test('saved HTML extraction removes feedback with the form even when site chrome is retained', () => {
  const document = htmlDocument(html, false);
  assert.match(document.text, /Site navigation/);
  assert.ok(document.text.includes(qualification));
  assert.ok(!document.text.includes(success));
  assert.ok(!document.text.includes(failure));
  assert.ok(document.rawText.includes(success));
  assert.equal(htmlToText(html), `Title: Synthetic center\n\n${document.text}`);
});

test('removed feedback cannot supply fabricated contact or hours metadata', () => {
  const document = htmlDocument(`<main><h1>Request a visit</h1><p>Visits require confirmation.</p>
    <div class="w-form"><form></form><div class="w-form-done"><a href="mailto:placeholder@synthetic.example">placeholder@synthetic.example</a></div>
    <div class="w-form-fail"><h2>Hours</h2><p>Monday: placeholder time</p></div></div></main>`);
  assert.equal(document.contact, '');
  assert.equal(document.hours, '');
  assert.match(document.rawText, /placeholder@synthetic.example/);
  assert.match(document.rawText, /Monday: placeholder time/);
  assert.match(document.text, /Visits require confirmation/);
});

test('website import keeps exact qualification evidence while omitting builder feedback', async () => {
  const io: WebsiteTransport = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: async url => ({ remoteAddress: '93.184.216.34', status: 200, contentType: url.pathname === '/robots.txt' ? 'text/plain' : 'text/html', bytes: Buffer.from(url.pathname === '/robots.txt' ? '' : html) }),
  };
  const result = await importWebsitePages('https://synthetic.example/', ['https://synthetic.example/admissions'], io);
  assert.ok(!result.text.includes(success));
  assert.ok(!result.text.includes(failure));
  const provenance = unlinkedSourceProvenance({ format: 'html', text: result.text });
  const anchor = provenance.anchors.find(value => value.excerpt.includes(qualification));
  assert.ok(anchor);
  assert.equal(result.text.slice(anchor.characterStart, anchor.characterEnd), anchor.excerpt);
  assert.ok(result.pages[0].rawText?.includes(success));
});
