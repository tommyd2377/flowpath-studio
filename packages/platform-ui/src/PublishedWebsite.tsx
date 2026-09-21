'use client';

import { createContext, useContext, useId, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MediaImage, usePublishedMedia } from './MediaViews.js';
import { revealTransition } from './motion.js';
import { effectiveWebsiteTemplate, FONT_PAIRINGS, websiteValueRole, type SiteDesign, type WebsiteMotion, type WebsiteTemplate } from './site-design.js';
import { useWebsiteMotion } from './website-motion.js';

const WebsiteMotionContext = createContext(false);
const controlTransition = { type: 'spring' as const, stiffness: 380, damping: 28 };
const arrowVariants = { rest: { x: 0, y: 0 }, intent: { x: 3, y: -3 } };

export type WebsiteEntry = { kind?: string; caption?: string; credit?: string; id: string; name: string; body?: string; blocks?: { id: string; kind: 'paragraph' | 'heading'; text: string }[]; imageAssetId?: string; example?: boolean; eyebrow?: string; recordId?: string; videoId?: string; number?: number; values?: { label: string; text: string; role?: 'price' | 'price-terms' }[] };
export type WebsiteSection = { id: string; title: string; description?: string; kind: 'stories' | 'collection' | 'photos' | 'faq' | 'information'; entries: WebsiteEntry[]; navigation?: boolean; paged?: boolean; total?: number; offset?: number; parentTitle?: string };

function ContactText({ text }: { text: string }) {
  return <>{text.split(/([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/g).map((part, index) => /^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(part) ? <a key={index} href={`mailto:${part}`}>{part}</a> : part)}</>;
}

/** The same published card appears in the full website, collections, and conversational views. */
export function ContentCard({ entry, onOpen, highlighted, number, motionEnabled = true }: { entry: WebsiteEntry; onOpen: () => void; highlighted?: boolean; number?: number; motionEnabled?: boolean }) {
  const reduced = useReducedMotion();
  return <motion.button type="button" className="platform-content-card" data-has-image={Boolean(entry.imageAssetId)}
    layoutId={`website-card-${entry.id}`} data-task-record={entry.recordId} data-workspace-content={entry.id} data-workspace-highlighted={highlighted ? entry.id : undefined}
    aria-label={`Open ${entry.name}`} onClick={onOpen} whileHover={reduced || !motionEnabled ? undefined : { y: -3 }} whileTap={reduced || !motionEnabled ? undefined : { scale: .992 }} transition={revealTransition}>
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

/** Website-only cards deliberately do not change the assistant's ContentCard. */
function WebsiteCard({ entry, onOpen, gallery, signature, index, highlighted, sectionTitle }: { entry: WebsiteEntry; onOpen: () => void; gallery: boolean; signature: boolean; index: number; highlighted: boolean; sectionTitle: string }) {
  const motionEnabled = useContext(WebsiteMotionContext);
  const role = (value: NonNullable<WebsiteEntry['values']>[number]) => value.role ?? websiteValueRole(value);
  const price = entry.values?.find(value => role(value) === 'price');
  const terms = entry.values?.filter(value => role(value) === 'price-terms') ?? [];
  const category = entry.values?.find(value => /^(?:source )?category$/i.test(value.label));
  const copiedSummary = terms.length === 1 && entry.body === `${category?.text ? `${category.text}. ` : ''}${terms[0].text}. Listed information; availability is not verified.`;
  const money = price?.text.match(/^([A-Z]{3}) (-?\d+(?:\.\d+)?)(\s*\/\s*.+)?$/);
  const amount = money ? Number(money[2]) : undefined;
  const symbol = money ? ({ USD: '$', GBP: '£', EUR: '€' } as Record<string, string>)[money[1]] : undefined;
  // Collapse only the deterministic importer's exact duplicated value. All
  // qualifiers stay verbatim; ambiguous/conflicting prices use the full fields.
  const combinedTerms = copiedSummary && money && terms[0].text.match(/([$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  const inlineTerms = combinedTerms && !money?.[3] && combinedTerms[1] === symbol && Number(combinedTerms[2].replaceAll(',', '')) === amount ? terms[0] : undefined;
  const withoutName = (text: string) => text.startsWith(entry.name) && /^[\s~:–—-]+[$£€]/.test(text.slice(entry.name.length)) ? text.slice(entry.name.length).replace(/^[\s~:–—-]+/, '') : text;
  const priceText = inlineTerms ? withoutName(inlineTerms.text) : money ? `${new Intl.NumberFormat('en-US', { style: 'currency', currency: money[1] }).format(amount!)}${money[3] ?? ''}` : price?.text;
  return <motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} whileTap={motionEnabled ? { scale: .995 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} type="button" className="platform-content-card platform-website-card" data-has-image={Boolean(entry.imageAssetId)} data-kind={entry.kind}
    data-task-record={entry.recordId} data-workspace-content={entry.id} data-workspace-highlighted={highlighted ? entry.id : undefined} aria-label={`Open ${entry.name}`} onClick={onOpen}>
    {entry.imageAssetId && <span className="platform-website-image-frame" data-website-frame data-website-depth={signature || undefined}><MediaImage checkInitialLoad assetId={entry.imageAssetId} interactive={false} aspectRatio={gallery ? '4 / 3' : '16 / 11'}/></span>}
    <span className="platform-content-card-copy">
      {!gallery && <span className="platform-website-item-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>}
      <strong>{entry.name}</strong>
      {entry.example && <span className="platform-media-example">Illustrative example</span>}
      {!gallery && entry.body && !copiedSummary && <span className="platform-content-card-description">{entry.body}</span>}
      {price && <span className="platform-website-price"><span>Price</span>{priceText}</span>}
      {terms.filter(value => value !== inlineTerms).map(value => <span className="platform-content-card-value" key={value.label}>{value.label}: {value.text}</span>)}
      {entry.values?.filter(value => value !== price && !terms.includes(value) && !(value === category && value.text === sectionTitle)).slice(0, 2).map(value => <span className="platform-content-card-value" key={value.label}>{value.label}: {value.text}</span>)}
      {entry.caption && entry.caption !== entry.name && <span className="platform-website-caption">{entry.caption}</span>}
      {entry.credit && <span className="platform-website-credit">{entry.credit}</span>}
      <span className="platform-content-card-more">{gallery ? 'View photograph' : entry.kind === 'project' ? 'View project' : 'View details'} <motion.span variants={arrowVariants} transition={motionEnabled ? controlTransition : { duration: 0 }} aria-hidden="true">↗</motion.span></span>
    </span>
  </motion.button>;
}

function collectionLayout(section: WebsiteSection) {
  if (section.kind === 'photos') return 'gallery';
  if (section.entries.every(entry => entry.kind === 'project')) return 'portfolio';
  if (section.entries.every(entry => entry.kind === 'service')) return 'services';
  if (section.entries.some(entry => entry.values?.some(value => (value.role ?? websiteValueRole(value)) === 'price'))) return 'priced';
  return 'catalog';
}

function WebsiteGroup({ section, anchor, onOpen, onInteraction, highlightedId, onPage, template, signature }: { section: WebsiteSection; anchor: string; onOpen: (id: string) => void; onInteraction: () => void; highlightedId?: string; onPage?: (offset: number) => void; template?: WebsiteTemplate; signature: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const limit = section.paged ? 48 : section.kind === 'photos' ? 8 : 6;
  const entries = expanded ? section.entries : section.entries.slice(0, limit);
  const presentation = collectionLayout(section);
  return <section id={anchor} tabIndex={-1} className="platform-website-section" data-section-kind={section.kind} data-collection-layout={presentation} data-entry-count={entries.length} aria-label={section.title}>
    <header className="platform-website-section-heading" data-website-reveal><div>{section.parentTitle && <span className="platform-website-eyebrow">{section.parentTitle}</span>}<h2>{section.title}</h2>{section.description && <p>{section.description}</p>}</div>
      {(section.kind === 'collection' || section.kind === 'photos') && <span className="platform-website-count">{section.total ?? section.entries.length} {section.kind === 'photos' ? section.entries.length === 1 ? 'photo' : 'photos' : section.entries.length === 1 ? 'item' : 'items'}</span>}
    </header>
    <div className="platform-website-section-body" id={`${anchor}-entries`}>
      {section.kind === 'faq' ? <div className="platform-website-faq">{entries.map((entry, index) => <details key={entry.id} data-website-reveal data-website-order={index} onToggle={onInteraction}>
        <summary>{entry.name}<span aria-hidden="true">+</span></summary><div className="platform-website-answer">{entry.blocks?.length ? entry.blocks.map(block => block.kind === 'heading' ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>) : <p>{entry.body}</p>}{entry.values?.map(value => <p key={value.label}><strong>{value.label}</strong> {value.text}</p>)}</div>
      </details>)}</div> : section.kind === 'stories' || section.kind === 'information' ? <div className="platform-website-stories">{entries.map(entry => {
        const showTitle = section.entries.length > 1 || entry.name !== section.title;
        const BlockHeading = showTitle ? 'h4' : 'h3';
        const headingKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
        const previewBlocks = entry.blocks?.filter((block, index) => index !== 0 || block.kind !== 'heading' || headingKey(block.text) !== headingKey(entry.name));
        return <article key={entry.id} data-task-record={entry.recordId} className="platform-website-story" data-website-reveal>
        {entry.imageAssetId && <button type="button" aria-label={`Explore the photo for ${entry.name}`} onClick={() => onOpen(entry.id)}><span className="platform-website-image-frame" data-website-frame><MediaImage checkInitialLoad assetId={entry.imageAssetId} size="display" interactive={false}/></span></button>}
        <div>{showTitle && <h3>{entry.name}</h3>}
          {previewBlocks?.length ? (template ? previewBlocks.slice(0, 2) : previewBlocks).map(block => block.kind === 'heading' ? <BlockHeading className="platform-website-story-subheading" key={block.id}>{block.text}</BlockHeading> : <p key={block.id}>{template && block.text.length > 600 ? `${block.text.slice(0, 600)}…` : block.text}</p>) : <p>{template && (entry.body?.length ?? 0) > 600 ? `${entry.body!.slice(0, 600)}…` : entry.body}</p>}
          {entry.example && <span className="platform-media-example">Illustrative example</span>}{entry.caption && <p className="platform-website-caption">{entry.caption}</p>}{entry.credit && <small className="platform-website-credit">{entry.credit}</small>}
          <button type="button" className="platform-website-text-link" aria-label={`Open ${entry.name}`} data-workspace-content={entry.id} data-workspace-highlighted={highlightedId === entry.id ? entry.id : undefined} onClick={() => onOpen(entry.id)}>{section.kind === 'stories' ? 'Continue reading' : 'Full details'} <span aria-hidden="true">↗</span></button>
        </div>
      </article>; })}</div> : <ol className="platform-website-entries" data-with-photos={entries.some(entry => entry.imageAssetId)}>{entries.map((entry, index) => <li key={entry.id} data-website-reveal data-website-order={index}>
        {template ? <WebsiteCard entry={entry} sectionTitle={section.title} index={index} gallery={section.kind === 'photos'} signature={signature && index === 0} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/> : <ContentCard motionEnabled={false} entry={entry} number={index + 1} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/>}
      </li>)}</ol>}
      {onPage && section.total != null && <nav className="platform-website-pagination" aria-label="Collection pages"><button type="button" className="platform-website-text-link" disabled={!section.offset} onClick={() => onPage(Math.max(0, (section.offset ?? 0) - 24))}>Previous page</button><span aria-live="polite">{Math.floor((section.offset ?? 0) / 24) + 1} / {Math.max(1, Math.ceil(section.total / 24))}</span><button type="button" className="platform-website-text-link" disabled={(section.offset ?? 0) + 24 >= section.total} onClick={() => onPage((section.offset ?? 0) + 24)}>Next page</button></nav>}
      {section.entries.length > limit && <button type="button" className="platform-website-more" aria-expanded={expanded} aria-controls={`${anchor}-entries`} onClick={() => { onInteraction(); setExpanded(value => !value); }}>{expanded ? 'Show fewer' : `Explore all ${section.entries.length}`} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}
    </div>
  </section>;
}

/** A controlled, provider-independent website composed only from the published snapshot. */
export function PublishedWebsite({ name, headline, description, tagline, template: selectedTemplate, styleSettings, websiteMotion = 'subtle', active = true, assistantEnabled = true, logoAssetId, hero, sections, contact, hours, onOpen, onHome, onInteraction, highlightedId, onPage, onAsk = onHome, layout = 'balanced' }: {
  tagline?: string; template?: WebsiteTemplate; styleSettings?: SiteDesign; websiteMotion?: WebsiteMotion; active?: boolean; assistantEnabled?: boolean;
  layout?: 'balanced' | 'editorial' | 'compact'; name: string; headline: string; description: string; logoAssetId?: string | null; hero?: WebsiteEntry; sections: WebsiteSection[];
  contact?: string; hours?: string; onOpen: (id: string) => void; onHome: () => void; onInteraction: () => void;
  highlightedId?: string; onAsk?: () => void; onPage?: (offset: number) => void;
}) {
  const template = effectiveWebsiteTemplate({ template: selectedTemplate, layout });
  const media = usePublishedMedia();
  const heroAsset = media?.library.assets.find(asset => asset.id === hero?.imageAssetId);
  // Use published dimensions before the image loads so thumbnails and portraits
  // never become oversized banners or cause a later composition shift.
  const banner = template === 'showcase' && !!heroAsset && heroAsset.width >= 1200 && heroAsset.width / heroAsset.height >= 1.5;
  const separateIntro = template === 'showcase' && (!hero?.imageAssetId || banner);
  const heroLayout = hero?.imageAssetId ? banner ? 'banner' : 'split' : 'text';
  const heroStyle = heroAsset ? { '--website-hero-ratio': heroAsset.width / heroAsset.height, '--website-hero-image-limit': `${Math.min(560, heroAsset.width * 1.5)}px` } as React.CSSProperties : undefined;
  // Old publications lack typography tokens. Scope defaults to the website,
  // honoring saved font/spacing choices without changing brand or assistant colors.
  const font = FONT_PAIRINGS[styleSettings?.typography ?? (template === 'editorial' ? 'literary' : template === 'showcase' ? 'modern' : 'humanist')];
  const defaults = !selectedTemplate ? { '--platform-heading-font': font.heading, '--platform-body-font': font.body, '--platform-heading-weight': font.weight,
    '--platform-text-scale': styleSettings?.textSize === 'larger' ? '1.125' : '1', '--platform-space-scale': ({ compact: '.75', comfortable: '1', spacious: '1.3' })[styleSettings?.spacing ?? 'comfortable'],
    '--platform-on-accent': 'var(--platform-bg)', '--platform-radius': template === 'clarity' ? '18px' : '0px' } as React.CSSProperties : undefined;
  const prefix = useId().replace(/:/g, '');
  const { ref: root, motionEnabled } = useWebsiteMotion(websiteMotion, active, template);
  const anchor = (id: string) => `${prefix}-${id}`;
  const displayed = sections.filter(section => section.entries.length || section.total);
  const navigation = displayed.filter(section => section.navigation !== false);
  const signatureSection = displayed.find(section => section.entries.some(entry => entry.imageAssetId))?.id;
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onInteraction();
    const menu = event.currentTarget.closest('details');
    if (menu) {
      menu.removeAttribute('open');
      const id = event.currentTarget.hash.slice(1);
      requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }));
    }
  };
  const links = <>{navigation.map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={navigate}>{section.title}</a>)}{(contact || hours) && <a href={`#${anchor('contact')}`} onClick={navigate}>Contact</a>}</>;
  const actions = <div className="platform-website-hero-actions" data-website-reveal="actions" data-website-order="3">{displayed[0] && <motion.a initial={false} whileHover={motionEnabled ? { y: -3 } : undefined} whileTap={motionEnabled ? { scale: .98 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} href={`#${anchor(displayed[0].id)}`} onClick={navigate}>{displayed[0].title} <span aria-hidden="true">↘</span></motion.a>}{assistantEnabled && <button type="button" onClick={onAsk}>Ask a question <span aria-hidden="true">↗</span></button>}</div>;
  const photograph = hero?.imageAssetId && <figure><button type="button" onClick={() => onOpen(hero.id)} aria-label={`Open ${hero.name}`}><span className="platform-website-image-frame" data-website-frame data-website-depth data-website-order="2"><MediaImage checkInitialLoad assetId={hero.imageAssetId} size="display" interactive={false} aspectRatio={template === 'showcase' ? '16 / 9' : '4 / 5'}/></span></button><figcaption><span>{hero.caption || hero.name}{hero.example ? ' · Illustrative example' : ''}</span>{hero.credit && <small>{hero.credit}</small>}</figcaption></figure>;
  return <WebsiteMotionContext.Provider value={motionEnabled}><div ref={root} style={defaults} id={anchor('top')} tabIndex={-1} className="platform-website" data-template={template} data-website-design="refined" data-website-motion={websiteMotion} data-website-paused={!active} data-published-website="true" data-website-layout={layout} role="region" aria-label="Browse approved information">
    {template && <a className="platform-website-skip" onClick={navigate} href={`#${anchor(displayed[0]?.id ?? 'contact')}`}>Skip to content</a>}
    <header className="platform-website-header"><button className="platform-website-brand" onClick={onHome} type="button" aria-label={`${name} home`}>{logoAssetId && <MediaImage checkInitialLoad assetId={logoAssetId} fit="contain" interactive={false}/>}<span>{name}</span></button>
      <nav aria-label="Website navigation">{navigation.slice(0, 4).map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={navigate}>{section.title}</a>)}{navigation.length > 4 && <details className="platform-website-nav-more"><summary>More</summary><div>{navigation.slice(4).map(section => <a key={section.id} href={`#${anchor(section.id)}`} onClick={navigate}>{section.title}</a>)}</div></details>}{(contact || hours) && <a href={`#${anchor('contact')}`} onClick={navigate}>Contact</a>}</nav>
      {template && (navigation.length > 0 || contact || hours) && <details className="platform-website-mobile-nav" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary>Menu <span aria-hidden="true">+</span></summary><nav aria-label="Mobile website navigation">{links}</nav></details>}
    </header>
    <div className="platform-website-hero" data-has-image={Boolean(hero?.imageAssetId)} data-hero-layout={heroLayout} style={heroStyle}>
      <div className="platform-website-hero-copy">{tagline && tagline !== headline && <span className="platform-website-eyebrow" data-website-reveal="eyebrow">{tagline}</span>}<h1 data-website-reveal="headline" data-website-order="1">{headline}</h1>{!separateIntro && <>{description && <p data-website-reveal="copy" data-website-order="2">{description}</p>}{actions}</>}</div>
      {separateIntro && (description || displayed.length > 0 || assistantEnabled) && <div className="platform-website-hero-intro">{description && <p data-website-reveal="copy" data-website-order="2">{description}</p>}{actions}</div>}
      {photograph}
      {template === 'clarity' && !photograph && navigation.length > 0 && <aside className="platform-website-directory" data-website-reveal="directory" data-website-order="3" aria-label="On this website"><span className="platform-website-eyebrow">On this website</span>{navigation.slice(0, 4).map((section, i) => <a href={`#${anchor(section.id)}`} key={section.id} onClick={navigate}><span>0{i + 1}</span>{section.title}<span aria-hidden="true">↗</span></a>)}</aside>}
    </div>
    <section className="platform-website-content" aria-label="Website content"><div>{displayed.map(section => <WebsiteGroup key={section.id} template={template} section={section} anchor={anchor(section.id)} onOpen={onOpen} onInteraction={onInteraction} highlightedId={highlightedId} onPage={section.id === 'published-catalog' ? onPage : undefined} signature={section.id === signatureSection}/>)}</div></section>
    <footer id={anchor('contact')} tabIndex={-1} className="platform-website-footer" data-minimal={!contact && !hours}>
      {(tagline || contact || hours || assistantEnabled) && <div data-website-reveal><h2>{tagline || name}</h2>{assistantEnabled && <button type="button" className="platform-website-text-link" onClick={onAsk}>Ask a question <span aria-hidden="true">↗</span></button>}</div>}
      {(contact || hours) && <div className="platform-website-contact" data-website-reveal>{contact && <div data-source-id="contact"><h3>Get in touch</h3><p><ContactText text={contact}/></p></div>}{hours && <div data-source-id="hours"><h3>Hours &amp; availability</h3><p>{hours}</p></div>}</div>}
      <div className="platform-website-colophon"><span>{name}</span><span>Made with FlowPath Studio</span><a href={`#${anchor('top')}`} onClick={navigate}>Back to top ↑</a></div>
    </footer>
  </div></WebsiteMotionContext.Provider>;
}
