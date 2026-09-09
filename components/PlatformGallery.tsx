'use client';

import { useState } from 'react';
import { CatalogExplorer } from '@thevoice/platform-ui';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import tequila from '@/fixtures/catalogs/tequila.json';
import bookstore from '@/fixtures/catalogs/bookstore.json';
import classes from '@/fixtures/catalogs/classes.json';

const examples = [
  { id: 'tequila', label: 'Agave catalog', accent: '#c9b58e', catalog: validateCatalog(tequila) },
  { id: 'bookstore', label: 'Bookstore', accent: '#d2ab8c', catalog: validateCatalog(bookstore) },
  { id: 'classes', label: 'Classes & experiences', accent: '#a8c6b3', catalog: validateCatalog(classes) },
];

export default function PlatformGallery() {
  const [selected, setSelected] = useState('tequila');
  const example = examples.find(item => item.id === selected)!;
  return <main style={{ padding: 'clamp(20px, 4vw, 64px)', background: '#101310', minHeight: '100vh', color: '#edeade' }}>
    <header style={{ maxWidth: 1360, margin: '0 auto 30px' }}>
      <p style={{ fontSize: 11, letterSpacing: '.14em', color: '#aaa', textTransform: 'uppercase' }}>TheVoice · Interface lab</p>
      <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 43px)', margin: '12px 0' }}>Different worlds. One thoughtful interface.</h1>
      <p style={{ fontSize: 13, color: '#a0a69b', maxWidth: 730, lineHeight: 1.7 }}>These are synthetic catalogs. Explore with filters, select a shortlist, compare attributes and follow relationships. Typed requests use a local deterministic planner; no AI calls or transactions occur.</p>
      <nav aria-label="Example catalogs" style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 23 }}>{examples.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} style={{ color: selected === item.id ? '#171918' : '#c2c7bc', background: selected === item.id ? item.accent : 'transparent', border: '1px solid #ffffff22', borderRadius: 7, padding: '10px 15px', fontSize: 12, cursor: 'pointer' }}>{item.label}</button>)}</nav>
    </header>
    <CatalogExplorer key={example.id} catalog={example.catalog} accent={example.accent}/>
  </main>;
}
