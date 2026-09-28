'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { RichAnswer } from '@thevoice/platform-ui/answer';
import { CatalogDiagram } from '@thevoice/platform-ui/diagram';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import classes from '@/fixtures/catalogs/classes.json';
import bookstore from '@/fixtures/catalogs/bookstore.json';
import styles from './AnswerLab.module.css';

const examples = [
  { id: 'classes', label: 'Learning studio', catalog: validateCatalog(classes), root: 'class-wheel',
    text: '## A first step in clay\n\n**Handbuilding** is the gentlest introduction. Choose **Wheel Skills** if you already have introductory experience.\n\n| Workshop | Level | Duration | Price |\n| :--- | :--- | ---: | ---: |\n| Introduction to Handbuilding | Beginner | 90 min | $60 |\n| Wheel Skills | Intermediate | 120 min | $85 |\n| Drawing from Observation | Beginner | 60 min | $35 |\n\n- Clay workshops include materials.\n- Drawing materials are not included.\n\n> These fictional examples describe a published schedule, not live availability.\n\n[Read the example guide](https://example.com/workshops).' },
  { id: 'bookstore', label: 'Bookshop', catalog: validateCatalog(bookstore), root: bookstore.entities[0].id,
    text: '## Make room for a reading ritual\n\n1. **Choose a quiet corner.** Keep your book within reach.\n2. Start with a few pages.\n   - Mark a sentence you want to revisit.\n   - Share it at your next book discussion.\n3. Leave time for the next chapter.\n\n### Your reading notes\n\n- [x] Choose a book\n- [ ] Make a little time\n\nThis is a synthetic formatting example, not a claim about the catalog.' },
];
const sources = [{ title: 'Example workshop guide · synthetic source', url: 'https://example.com/workshops' }];
export default function AnswerLab() {
  const [index, setIndex] = useState(0), [dark, setDark] = useState(false);
  const [streaming, setStreaming] = useState(false), [partial, setPartial] = useState('');
  const example = examples[index];
  useEffect(() => {
    if (!streaming) return;
    let length = 0;
    const timer = setInterval(() => {
      length += 24; setPartial(example.text.slice(0, length));
      if (length >= example.text.length) { clearInterval(timer); setStreaming(false); }
    }, 45);
    return () => clearInterval(timer);
  }, [streaming, example.text]);
  return <main className={styles.lab} data-theme={dark ? 'dark' : 'light'} style={{ colorScheme: dark ? 'dark' : 'light' } as CSSProperties}>
    <header className={styles.header}><Link href="/lab">← Interface lab</Link><h1>A little more clarity.</h1><p>Shared answer components and an optional relationship map. Synthetic content, no API calls.</p>
      <nav aria-label="Answer examples">{examples.map((item, current) => <button type="button" key={item.id} aria-pressed={current === index} onClick={() => { setStreaming(false); setIndex(current); }}>{item.label}</button>)}<button type="button" aria-pressed={dark} onClick={() => setDark(!dark)}>Dark palette</button></nav>
    </header>
    <article className={styles.answer} aria-label="Answer preview"><RichAnswer text={streaming ? partial : example.text} streaming={streaming} sources={index === 0 && !streaming ? sources : []}/><button className={styles.stream} type="button" disabled={streaming} onClick={() => { setPartial(''); setStreaming(true); }}>{streaming ? 'Streaming preview…' : 'Preview streamed answer'}</button></article>
    <section className={styles.relationships} aria-labelledby="relationships-title"><div className={styles.caption}><p>React Flow · prototype</p><h2 id="relationships-title">See how it connects.</h2><p>Explore relationships supplied by the catalog. Select an item to read its context. This view does not execute actions.</p></div><CatalogDiagram key={example.id} catalog={example.catalog} rootId={example.root}/></section>
  </main>;
}
