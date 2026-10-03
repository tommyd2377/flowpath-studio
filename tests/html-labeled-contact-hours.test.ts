import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlDocument } from '../lib/html-document';
import { extractWebsitePage, designWebsite } from '../lib/website-import';

const inline = '<p>Tel: (718) 246-5500</p><p>Hours:<br>Weekdays, 11am-8pm<br>Saturday, 10am-6pm<br>Closed Sundays</p>';
const footer = '<footer><p><strong>Hours</strong><br>Monday—Friday: 11:00AM–8:00PM<br>Saturday : 10:00AM–6:00PM</p></footer>';

test('explicit plain phone and closed-day schedule reach the generated design', () => {
  const page = extractWebsitePage('<h1>Neighborhood salon</h1>'+inline+footer, 'https://salon.example/');
  const design = designWebsite(page, 1);
  assert.equal(design.contact, '(718) 246-5500');
  assert.match(design.hours!, /Weekdays, 11am-8pm; Saturday, 10am-6pm; Closed Sundays/);
  assert.match(design.hours!, /Monday—Friday: 11:00AM–8:00PM/);
  assert.ok(page.text.includes('Tel: (718) 246-5500'));
  assert.ok(page.rawText?.includes('Closed Sundays'));
});

test('inline formatting and qualifications remain literal, without taking neighboring prose', () => {
  const result = htmlDocument('<p><strong>Phone:</strong> <span>+44 (20) 7946 0958 ext. 3 — appointments only</span></p><p><b>Business hours:</b><br>Monday 9–5 by appointment only<br>Except public holidays</p><h2>Events</h2><p>Sunday brunch $25</p>');
  assert.equal(result.contact, '+44 (20) 7946 0958 ext. 3 — appointments only');
  assert.equal(result.hours, 'Monday 9–5 by appointment only; Except public holidays');
  assert.doesNotMatch(result.hours, /brunch/);
});

test('unlabeled numbers, separate paragraphs, hidden/form/navigation/example blocks do not become metadata', () => {
  for (const wrap of [(s:string)=>`<div hidden>${s}</div>`, (s:string)=>`<section aria-hidden="true">${s}</section>`, (s:string)=>`<form>${s}</form>`, (s:string)=>`<nav>${s}</nav>`, (s:string)=>`<div role="navigation">${s}</div>`, (s:string)=>`<blockquote>${s}</blockquote>`, (s:string)=>`<pre>${s}</pre>`]) {
    const result=htmlDocument(wrap(inline)); assert.equal(result.contact,''); assert.equal(result.hours,'');
  }
  const result=htmlDocument('<p>(718) 246-5500</p><p>Hours:</p><p>Sunday 9am–5pm</p><p>Phone: ask our team</p><script>Phone: 7182465500</script>');
  assert.equal(result.contact,''); assert.equal(result.hours,'');
});

test('different locations or conflicting inline schedules stay in evidence without one flattened summary', () => {
  const result=htmlDocument('<section><h2>North</h2><p>Phone: 212-555-0100</p><p>Hours: Monday 9am–5pm</p></section><section><h2>South</h2><p>Phone: 212-555-0200</p><p>Hours: Monday 10am–6pm</p></section>');
  assert.equal(result.contact,''); assert.equal(result.hours,'');
  for(const value of ['North','South','212-555-0100','212-555-0200','Monday 9am–5pm','Monday 10am–6pm']) assert.ok(result.text.includes(value));
});

test('footer and inline conflicts are retained verbatim, never reconciled', () => {
  const result=htmlDocument('<p>Hours:<br>Monday 9am–5pm<br>Closed Sundays</p><footer><p>Monday 10am–6pm</p><p>Sunday 10am–2pm</p></footer>');
  for(const value of ['Monday 9am–5pm','Monday 10am–6pm','Closed Sundays','Sunday 10am–2pm']) assert.ok(result.hours.includes(value));
});

test('mixed-format location values do not lose their named scope', () => {
  for(const second of ['<footer><h2>South</h2><a href="tel:2125550200">212-555-0200</a><p>Monday 10am–6pm</p></footer>', '<section><h2>South</h2><h3>Hours</h3><p>Monday 10am–6pm</p></section>']) {
    const result=htmlDocument('<section><h2>North</h2><p>Phone: 212-555-0100</p><p>Hours: Monday 9am–5pm</p></section>'+second);
    assert.equal(result.hours,'');
    if(second.includes('tel:'))assert.equal(result.contact,'');
    for(const value of ['North','South','Monday 9am–5pm','Monday 10am–6pm'])assert.ok(result.text.includes(value));
  }
});

test('the same named-location evidence found by both paths does not erase existing metadata', () => {
  const result=htmlDocument('<section><h2>Brooklyn</h2><p>Phone: <a href="tel:7182465500">(718) 246-5500</a></p><h3>Hours</h3><p>Hours: Monday 9am–5pm</p></section>');
  assert.equal(result.contact,'7182465500');
  assert.match(result.hours,/Monday 9am–5pm/);
});

test('metadata limits never cut off new inline qualifications', () => {
  const result=htmlDocument(`<p>Hours:<br>Monday 9am–5pm<br>${'Seasonal arrangements vary. '.repeat(8)}By appointment only.</p><p>Phone: 212-555-0100 ${'appointments only; '.repeat(12)}</p>`);
  assert.equal(result.hours,''); assert.equal(result.contact,'');
  assert.ok(result.text.includes('By appointment only.'));
});

test('a label in a mixed block does not cross another metadata boundary', () => {
  const result=htmlDocument('<p>Hours:<br>Monday 9am–5pm<br>Phone: 212-555-0100</p>');
  assert.equal(result.hours,''); assert.equal(result.contact,'');
  const phoneFirst=htmlDocument('<p>Tel: 212-555-0100<br>Hours: Monday 9am–5pm</p>');
  assert.equal(phoneFirst.contact,'');
  const hiddenChild=htmlDocument('<p>Tel: <span hidden>212-555-0100</span></p><p>Hours:<span aria-hidden="true">Monday 9am–5pm</span></p>');
  assert.equal(hiddenChild.contact,''); assert.equal(hiddenChild.hours,'');
});

test('duplicate inline blocks do not duplicate derived values; heading/footer behavior stays unchanged', () => {
  const result=htmlDocument(inline+inline);
  assert.equal(result.contact,'(718) 246-5500');
  assert.equal(result.hours,'Weekdays, 11am-8pm; Saturday, 10am-6pm; Closed Sundays');
  const legacy=htmlDocument('<main><h2>Hours</h2><p>Monday 9am–5pm</p></main><footer><p>Monday 10am–6pm</p></footer>');
  assert.equal(legacy.hours,'Monday 10am–6pm');
});
