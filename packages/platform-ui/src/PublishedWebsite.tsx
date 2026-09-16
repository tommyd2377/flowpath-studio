'use client';

import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MediaImage } from './MediaViews.js';
import { revealTransition } from './motion.js';
import type { WebsiteTemplate } from './site-design.js';

export type WebsiteEntry = { id: string; name: string; body?: string; blocks?: { id: string; kind: 'paragraph' | 'heading'; text: string }[]; imageAssetId?: string; example?: boolean; eyebrow?: string; recordId?: string; videoId?: string; number?: number; values?: { label: string; text: string }[] };
export type WebsiteSection = { id: string; title: string; description?: string; kind: 'stories' | 'collection' | 'photos' | 'faq' | 'information'; entries: WebsiteEntry[]; navigation?: boolean; paged?: boolean; total?: number; offset?: number; parentTitle?: string };

function ContactText({ text }: { text: string }) {
  return <>{text.split(/([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/g).map((part, index) => /^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(part) ? <a key={index} href={`mailto:${part}`}>{part}</a> : part)}</>;
}

/** The same published card appears in the full website, collections, and conversational views. */
export function ContentCard({ entry, onOpen, highlighted, number }: { entry: WebsiteEntry; onOpen: () => void; highlighted?: boolean; number?: number }) {
  const reduced = useReducedMotion();
  return <motion.button type="button" className="platform-content-card" data-has-image={Boolean(entry.imageAssetId)}
    layoutId={`website-card-${entry.id}`} data-task-record={entry.recordId} data-workspace-content={entry.id} data-workspace-highlighted={highlighted ? entry.id : undefined}
    aria-label={`Open ${entry.name}`} onClick={onOpen} whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: .992 }} transition={revealTransition}>
    {entry.imageAssetId && <MediaImage assetId={entry.imageAssetId} interactive={false} aspectRatio="16 / 11"/>}
    <span className="platform-content-card-copy">
      <span className="platform-content-card-meta">{(entry.number ?? number) != null && <span className="platform-workspace-number">{String(entry.number ?? number).padStart(2, '0')}</span>}{entry.eyebrow && <span>{entry.eyebrow}</span>}</span>
      <strong>{entry.name}</strong>{entry.example && <span className="platform-media-example">Example photo</span>}
      {entry.body && <span className="platform-content-card-description">{entry.body}</span>}
      {entry.values?.slice(0, 3).map(value => <span className="platform-content-card-value" key={value.label}>{value.label}: {value.text}</span>)}
      <span className="platform-content-card-more">Explore <span aria-hidden="true">↗</span></span>
    </span>
  </motion.button>;
}

function WebsiteGroup({ section, anchor, onOpen, onInteraction, highlightedId, onPage, template }: { section: WebsiteSection; anchor: string; onOpen: (id: string) => void; onInteraction: () => void; highlightedId?: string; onPage?: (offset: number) => void; template?: WebsiteTemplate }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const limit = section.paged ? 48 : section.kind === 'photos' ? 8 : 6;
  const entries = expanded ? section.entries : section.entries.slice(0, limit);
  return <motion.div layout="position" initial={false} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, overflow: 'hidden' }} transition={{ duration: reduced ? 0 : .3, ease: [0.22, 1, 0.36, 1] }}><section id={anchor} className="platform-website-section" data-section-kind={section.kind} aria-label={section.title}>
    <header className="platform-website-section-heading"><div><span className="platform-website-eyebrow">{section.kind === 'photos' ? 'In pictures' : section.kind === 'stories' ? 'Discover' : section.kind === 'information' ? 'Good to know' : section.kind === 'faq' ? 'Your questions, answered' : 'Explore the collection'}</span><h2>{section.title}</h2>{section.description && <p>{section.description}</p>}</div>{(section.kind === 'collection' || section.kind === 'photos') && <span className="platform-website-count">{section.total ?? section.entries.length} {section.kind === 'photos' ? section.entries.length === 1 ? 'photo' : 'photos' : section.entries.length === 1 ? 'item' : 'items'}</span>}</header>
    {section.parentTitle && <p className="platform-website-parent">{section.parentTitle}</p>}
    {section.kind === 'faq' ? <div className="platform-website-faq">{entries.map(entry => <details key={entry.id} onToggle={onInteraction}><summary>{entry.name}</summary>{entry.blocks?.length ? entry.blocks.map(block => <p key={block.id}>{block.text}</p>) : <p>{entry.body}</p>}</details>)}</div> : section.kind === 'stories' || section.kind === 'information' ? <div className="platform-website-stories">{entries.map(entry => <article key={entry.id} data-task-record={entry.recordId} className="platform-website-story">
      {entry.imageAssetId && <button type="button" aria-label={`Explore the photo for ${entry.name}`} onClick={() => onOpen(entry.id)}><MediaImage assetId={entry.imageAssetId} size="display" interactive={false}/></button>}
      <div>{(section.entries.length > 1 || entry.name !== section.title) && <h3>{entry.name}</h3>}{entry.blocks?.length ? (template ? entry.blocks.slice(0, 2) : entry.blocks).map(block => block.kind === 'heading' ? <h4 key={block.id}>{block.text}</h4> : <p key={block.id}>{template && block.text.length > 600 ? `${block.text.slice(0, 600)}…` : block.text}</p>) : <p>{template && (entry.body?.length ?? 0) > 600 ? `${entry.body!.slice(0, 600)}…` : entry.body}</p>}{entry.example && <span className="platform-media-example">Example photo</span>}<button type="button" className="platform-website-text-link" aria-label={`Open ${entry.name}`} data-workspace-content={entry.id} data-workspace-highlighted={highlightedId === entry.id ? entry.id : undefined} onClick={() => onOpen(entry.id)}>Explore {entry.name} <span aria-hidden="true">↗</span></button></div>
    </article>)}</div> : <ol className="platform-website-entries" data-with-photos={entries.some(entry => entry.imageAssetId)}><AnimatePresence initial={false} mode="popLayout">{entries.map((entry, index) => <motion.li layout="position" key={entry.id} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .28, ease: [0.22, 1, 0.36, 1] }}><ContentCard entry={entry} number={index + 1} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/></motion.li>)}</AnimatePresence></ol>}
    {onPage && section.total != null && <nav aria-label="Collection pages"><button type="button" className="platform-website-text-link" disabled={!section.offset} onClick={() => onPage(Math.max(0, (section.offset ?? 0) - 24))}>Previous page</button><span> {Math.floor((section.offset ?? 0) / 24) + 1} / {Math.max(1, Math.ceil(section.total / 24))} </span><button type="button" className="platform-website-text-link" disabled={(section.offset ?? 0) + 24 >= section.total} onClick={() => onPage((section.offset ?? 0) + 24)}>Next page</button></nav>}
    {section.entries.length > limit && <button type="button" className="platform-website-more" aria-expanded={expanded} onClick={() => { onInteraction(); setExpanded(value => !value); }}>{expanded ? 'Show fewer' : `Explore all ${section.entries.length}`} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}
  </section></motion.div>;
}

/** A controlled, provider-independent website composed only from the host's published snapshot. */
export function PublishedWebsite({ name, headline, description, tagline, template, assistantEnabled = true, logoAssetId, hero, sections, contact, hours, onOpen, onHome, onInteraction, highlightedId, onPage, onAsk = onHome, layout = 'balanced' }: {
  tagline?: string; template?: WebsiteTemplate; assistantEnabled?: boolean;
  layout?: 'balanced' | 'editorial' | 'compact'; name: string; headline: string; description: string; logoAssetId?: string | null; hero?: WebsiteEntry; sections: WebsiteSection[];
  contact?: string; hours?: string; onOpen: (id: string) => void; onHome: () => void; onInteraction: () => void;
  highlightedId?: string; onAsk?: () => void; onPage?: (offset: number) => void;
}) {
  const prefix = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const anchor = (id: string) => `${prefix}-${id}`;
  const displayed = sections.filter(section => section.entries.length || section.total);
  const navigation = displayed.filter(section => section.navigation !== false);
  const links = <>{navigation.map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={event => { onInteraction(); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{section.title}</a>)}{(contact || hours) && <a href={`#${anchor('contact')}`} onClick={onInteraction}>Contact</a>}</>;
  const actions = <div className="platform-website-hero-actions">{displayed[0] && <a href={`#${anchor(displayed[0].id)}`} onClick={onInteraction}>{displayed[0].title} <span aria-hidden="true">↘</span></a>}{assistantEnabled && <button type="button" onClick={onAsk}>Ask a question <span aria-hidden="true">↗</span></button>}</div>;
  const photograph = hero?.imageAssetId && <figure><button type="button" onClick={() => onOpen(hero.id)} aria-label={`Open ${hero.name}`}><MediaImage assetId={hero.imageAssetId} size="display" interactive={false} aspectRatio={template === 'showcase' ? '16 / 9' : '4 / 5'}/></button><figcaption>{hero.name}{hero.example ? ' · Example photo' : ''}</figcaption></figure>;
  return <motion.div id={anchor('top')} className="platform-website" data-template={template} data-published-website="true" data-website-layout={layout} role="region" aria-label="Browse approved information" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : .5 }}>
    {template && <a className="platform-website-skip" onClick={onInteraction} href={`#${anchor(displayed[0]?.id ?? 'contact')}`}>Skip to content</a>}
    <header className="platform-website-header"><button className="platform-website-brand" onClick={onHome} type="button" aria-label={`${name} home`}>{logoAssetId && <MediaImage assetId={logoAssetId} fit="contain" interactive={false}/>}<span>{name}</span></button>
      <nav aria-label="Website navigation">{navigation.slice(0, 4).map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={onInteraction}>{section.title}</a>)}{navigation.length > 4 && <details className="platform-website-nav-more"><summary>More</summary><div>{navigation.slice(4).map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={event => { onInteraction(); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{section.title}</a>)}</div></details>}{(contact || hours) && <a href={`#${anchor('contact')}`} onClick={onInteraction}>Contact</a>}</nav>
      {template && (navigation.length > 0 || contact || hours) && <details className="platform-website-mobile-nav"><summary>Menu <span aria-hidden="true">＋</span></summary><nav aria-label="Mobile website navigation">{links}</nav></details>}
    </header>
    {template ? <div className="platform-website-hero" data-has-image={Boolean(hero?.imageAssetId)}>
      <div className="platform-website-hero-copy"><span className="platform-website-eyebrow">{tagline || name}</span><h1>{headline}</h1>{template !== 'showcase' && <>{description && <p>{description}</p>}{actions}</>}</div>
      {template === 'showcase' && <div className="platform-website-hero-intro">{description && <p>{description}</p>}{actions}</div>}
      {photograph}
      {template === 'clarity' && !photograph && navigation.length > 0 && <aside className="platform-website-directory" aria-label="On this website"><span className="platform-website-eyebrow">Find your way</span>{navigation.slice(0, 4).map((section, i) => <a href={`#${anchor(section.id)}`} key={section.id} onClick={onInteraction}><span>0{i + 1}</span>{section.title}<span aria-hidden="true">↗</span></a>)}</aside>}
    </div> : <AnimatePresence initial={false}>{<motion.div key="website-hero" layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, overflow: 'hidden' }} transition={{ duration: reduced ? 0 : .3 }} className="platform-website-hero-frame"><div className="platform-website-hero" data-has-image={Boolean(hero?.imageAssetId)}><div className="platform-website-hero-copy"><span className="platform-website-eyebrow">{name}</span><h1>{headline}</h1><p>{description}</p>
      <div className="platform-website-hero-actions">{sections[0] && <a href={`#${anchor(sections[0].id)}`} onClick={onInteraction}>Start exploring <span aria-hidden="true">↘</span></a>}<button type="button" onClick={onAsk}>Ask the assistant <span aria-hidden="true">↗</span></button></div>
    </div>{photograph}</div></motion.div>}</AnimatePresence>}
    <section className="platform-website-content" aria-label="Website content" >
      <div>
        {<AnimatePresence initial={false}>{displayed.map(section => <WebsiteGroup key={section.id} template={template} section={section} anchor={anchor(section.id)} onOpen={onOpen} onInteraction={onInteraction} highlightedId={highlightedId} onPage={section.id === 'published-catalog' ? onPage : undefined}/>)}</AnimatePresence>}
      </div>
    </section>
    <footer id={anchor('contact')} className="platform-website-footer"><div><span className="platform-website-eyebrow">{name}</span><h2>{tagline || (contact ? 'Let’s connect.' : 'Explore at your own pace.')}</h2>{assistantEnabled && <button type="button" className="platform-website-text-link" onClick={onAsk}>Ask a question <span aria-hidden="true">↗</span></button>}</div>
      {(contact || hours) && <div className="platform-website-contact">{contact && <div data-source-id="contact"><h3>Get in touch</h3><p><ContactText text={contact}/></p></div>}{hours && <div data-source-id="hours"><h3>Hours & availability</h3><p>{hours}</p></div>}</div>}
      <div className="platform-website-colophon"><span>{name}</span><span>Made with FlowPath Studio</span><a href={`#${anchor('top')}`} onClick={onInteraction}>Back to top ↑</a></div>
    </footer>
  </motion.div>;
}
