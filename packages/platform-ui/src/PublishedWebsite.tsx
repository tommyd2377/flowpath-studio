'use client';

import { useId, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MediaImage } from './MediaViews.js';
import { revealTransition } from './motion.js';

export type WebsiteEntry = { id: string; name: string; body?: string; imageAssetId?: string; example?: boolean; eyebrow?: string };
export type WebsiteSection = { id: string; title: string; description?: string; kind: 'stories' | 'collection' | 'photos'; entries: WebsiteEntry[] };

/** The same published card appears in the full website, collections, and conversational views. */
export function ContentCard({ entry, onOpen, highlighted, number }: { entry: WebsiteEntry; onOpen: () => void; highlighted?: boolean; number?: number }) {
  const reduced = useReducedMotion();
  return <motion.button type="button" className="platform-content-card" data-has-image={Boolean(entry.imageAssetId)}
    data-workspace-content={entry.id} data-workspace-highlighted={highlighted ? entry.id : undefined}
    aria-label={`Open ${entry.name}`} onClick={onOpen} whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: .992 }} transition={revealTransition}>
    {entry.imageAssetId && <MediaImage assetId={entry.imageAssetId} interactive={false} aspectRatio="16 / 11"/>}
    <span className="platform-content-card-copy">
      <span className="platform-content-card-meta">{number != null && <span className="platform-workspace-number">{String(number).padStart(2, '0')}</span>}{entry.eyebrow && <span>{entry.eyebrow}</span>}</span>
      <strong>{entry.name}</strong>{entry.example && <span className="platform-media-example">Example photo</span>}
      {entry.body && <span className="platform-content-card-description">{entry.body}</span>}
      <span className="platform-content-card-more">Explore <span aria-hidden="true">↗</span></span>
    </span>
  </motion.button>;
}

function WebsiteGroup({ section, anchor, onOpen, onInteraction, highlightedId }: { section: WebsiteSection; anchor: string; onOpen: (id: string) => void; onInteraction: () => void; highlightedId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const limit = section.kind === 'photos' ? 8 : 6;
  const entries = expanded ? section.entries : section.entries.slice(0, limit);
  return <section id={anchor} className="platform-website-section" data-section-kind={section.kind} aria-label={section.title}>
    <header className="platform-website-section-heading"><div><span className="platform-website-eyebrow">{section.kind === 'photos' ? 'In pictures' : section.kind === 'stories' ? 'Discover' : 'Explore the collection'}</span><h2>{section.title}</h2>{section.description && <p>{section.description}</p>}</div><span className="platform-website-count">{section.entries.length} {section.kind === 'photos' ? section.entries.length === 1 ? 'photo' : 'photos' : section.entries.length === 1 ? 'item' : 'items'}</span></header>
    {section.kind === 'stories' ? <div className="platform-website-stories">{entries.map(entry => <article key={entry.id} className="platform-website-story">
      {entry.imageAssetId && <button type="button" aria-label={`Explore the photo for ${entry.name}`} onClick={() => onOpen(entry.id)}><MediaImage assetId={entry.imageAssetId} size="display" interactive={false}/></button>}
      <div><h3>{entry.name}</h3><p>{entry.body}</p>{entry.example && <span className="platform-media-example">Example photo</span>}<button type="button" className="platform-website-text-link" aria-label={`Open ${entry.name}`} data-workspace-content={entry.id} data-workspace-highlighted={highlightedId === entry.id ? entry.id : undefined} onClick={() => onOpen(entry.id)}>Explore {entry.name} <span aria-hidden="true">↗</span></button></div>
    </article>)}</div> : <ol className="platform-website-entries" data-with-photos={entries.some(entry => entry.imageAssetId)}>{entries.map((entry, index) => <li key={entry.id}><ContentCard entry={entry} number={index + 1} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/></li>)}</ol>}
    {section.entries.length > limit && <button type="button" className="platform-website-more" aria-expanded={expanded} onClick={() => { onInteraction(); setExpanded(value => !value); }}>{expanded ? 'Show fewer' : `Explore all ${section.entries.length}`} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}
  </section>;
}

/** A controlled, provider-independent website composed only from the host's published snapshot. */
export function PublishedWebsite({ name, headline, description, logoAssetId, hero, sections, contact, hours, onOpen, onHome, onInteraction, query, onQueryChange, searchResults, highlightedId }: {
  name: string; headline: string; description: string; logoAssetId?: string | null; hero?: WebsiteEntry; sections: WebsiteSection[];
  contact?: string; hours?: string; onOpen: (id: string) => void; onHome: () => void; onInteraction: () => void;
  query: string; onQueryChange: (value: string) => void; searchResults: WebsiteEntry[]; highlightedId?: string;
}) {
  const prefix = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const anchor = (id: string) => `${prefix}-${id}`;
  return <motion.div className="platform-website" data-published-website="true" role="region" aria-label="Browse approved information" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : .5 }}>
    <header className="platform-website-header"><button className="platform-website-brand" onClick={onHome} type="button" aria-label={`${name} home`}>{logoAssetId && <MediaImage assetId={logoAssetId} fit="contain" interactive={false}/>}<span>{name}</span></button>
      <nav aria-label="Website navigation">{sections.slice(0, 4).map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={onInteraction}>{section.title}</a>)}{sections.length > 4 && <details className="platform-website-nav-more"><summary>More</summary><div>{sections.slice(4).map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={event => { onInteraction(); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{section.title}</a>)}</div></details>}{(contact || hours) && <a href={`#${anchor('contact')}`} onClick={onInteraction}>Contact</a>}</nav>
    </header>
    <div className="platform-website-hero" data-has-image={Boolean(hero?.imageAssetId)}><div className="platform-website-hero-copy"><span className="platform-website-eyebrow">{name}</span><h1>{headline}</h1><p>{description}</p>
      <div className="platform-website-hero-actions">{sections[0] && <a href={`#${anchor(sections[0].id)}`} onClick={onInteraction}>Start exploring <span aria-hidden="true">↘</span></a>}<button type="button" onClick={onHome}>Ask the assistant <span aria-hidden="true">↗</span></button></div>
    </div>{hero?.imageAssetId && <figure><button type="button" onClick={() => onOpen(hero.id)} aria-label={`Open ${hero.name}`}><MediaImage assetId={hero.imageAssetId} size="display" interactive={false} aspectRatio="4 / 5"/></button><figcaption>{hero.name}{hero.example ? ' · Example photo' : ''}</figcaption></figure>}</div>
    <div className="platform-website-search"><label>Find published information<input type="text" inputMode="search" value={query} placeholder="Find a place, a service, a detail…" onChange={event => onQueryChange(event.target.value)}/></label><span>{query ? `${searchResults.length} matches` : 'Explore at your own pace'}</span></div>
    {query.trim() ? <section className="platform-website-section" aria-label="Published search results"><h2>Matches for “{query}”</h2>{searchResults.length ? <ol className="platform-website-entries">{searchResults.map((entry, index) => <li key={entry.id}><ContentCard entry={entry} number={index + 1} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/></li>)}</ol> : <p>No matching published information. Try a name or a shorter phrase.</p>}</section>
      : sections.map(section => <WebsiteGroup key={section.id} section={section} anchor={anchor(section.id)} onOpen={onOpen} onInteraction={onInteraction} highlightedId={highlightedId}/>)}
    <footer id={anchor('contact')} className="platform-website-footer"><div><span className="platform-website-eyebrow">{name}</span><h2>{contact ? 'Let’s connect.' : 'There’s more to explore.'}</h2><button type="button" className="platform-website-text-link" onClick={onHome}>Ask a question <span aria-hidden="true">↗</span></button></div>
      {(contact || hours) && <div className="platform-website-contact">{contact && <div data-source-id="contact"><h3>Get in touch</h3><p>{contact}</p></div>}{hours && <div data-source-id="hours"><h3>Hours & availability</h3><p>{hours}</p></div>}</div>}
      <div className="platform-website-colophon"><span>{name}</span><span>Made with FlowPath Studio</span><a href={`#${anchor(sections[0]?.id ?? 'contact')}`} onClick={onInteraction}>Explore ↑</a></div>
    </footer>
  </motion.div>;
}
