'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MediaImage, usePublishedMedia } from './MediaViews.js';
import { revealTransition } from './motion.js';
import { effectiveWebsiteTemplate, FONT_PAIRINGS, websiteValueRole, type SiteDesign, type WebsiteMotion, type WebsiteTemplate } from './site-design.js';
import { useWebsiteDisclosure, useWebsiteExpansion, useWebsiteMotion } from './website-motion.js';

const WebsiteMotionContext = createContext(false);
const controlTransition = { type: 'spring' as const, stiffness: 380, damping: 28 };
const arrowVariants = { rest: { x: 0, y: 0 }, intent: { x: 3, y: -3 } };
const imageVariants = { rest: { scale: 1 }, intent: { scale: 1.035 } };

function DisclosureMark({ open }: { open: boolean }) {
  const enabled = useContext(WebsiteMotionContext);
  return <svg className="platform-website-disclosure-mark" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <path d="M4 10h12"/>{enabled ? <motion.path className="platform-website-disclosure-line" d="M10 4v12" initial={false} animate={{ pathLength: open ? 0 : 1, opacity: open ? 0 : 1 }} transition={{ duration: .22, ease: 'easeOut' }}/> : <path className="platform-website-disclosure-line" d="M10 4v12" style={{ opacity: open ? 0 : 1 }}/>}
  </svg>;
}

function WebsiteDisclosure({ title, children, className, reveal, order, onInteraction }: { title: string; children: ReactNode; className?: string; reveal?: boolean; order?: number; onInteraction: () => void }) {
  const enabled = useContext(WebsiteMotionContext);
  const { ref, open, toggle, onToggle, close } = useWebsiteDisclosure(enabled);
  return <details ref={ref} className={className} data-website-disclosure data-website-reveal={reveal || undefined} data-website-order={order}
    onToggle={event => { onToggle(event); onInteraction(); }} onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); close(); } }}>
    <summary onClick={toggle}>{title}<DisclosureMark open={open}/></summary>
    <div className="platform-website-disclosure-content" data-website-disclosure-content>{children}</div>
  </details>;
}

function WebsiteNavLink({ href, onClick, children }: { href: string; onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void; children: ReactNode }) {
  const enabled = useContext(WebsiteMotionContext);
  return <motion.a className="platform-website-nav-link" href={href} onClick={onClick} initial={false} animate="rest" whileHover={enabled ? 'intent' : undefined} whileFocus={enabled ? 'intent' : undefined} whileTap={enabled ? { y: 1 } : undefined} transition={enabled ? controlTransition : { duration: 0 }}>
    <span>{children}<motion.span className="platform-website-nav-underline" aria-hidden="true" variants={{ rest: { scaleX: 0 }, intent: { scaleX: 1 } }} transition={enabled ? { duration: .24, ease: [.22, .68, .2, 1] } : { duration: 0 }}/></span>
  </motion.a>;
}

export type WebsiteEntry = { kind?: string; caption?: string; credit?: string; id: string; name: string; body?: string; blocks?: { id: string; kind: 'paragraph' | 'heading'; text: string }[]; imageAssetId?: string; example?: boolean; eyebrow?: string; recordId?: string; videoId?: string; number?: number; values?: { label: string; text: string; role?: 'price' | 'price-terms' }[] };
export type WebsiteSection = { id: string; title: string; description?: string; kind: 'stories' | 'collection' | 'photos' | 'faq' | 'information'; entries: WebsiteEntry[]; navigation?: boolean; navLabel?: string; paged?: boolean; total?: number; offset?: number; parentTitle?: string };

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

type WebsiteValue = NonNullable<WebsiteEntry['values']>[number];
function websitePrice(value: WebsiteValue) {
  const parsed = /^([A-Z]{3}) (\d+(?:\.\d+)?)(?:\s*\/\s*(.+))?$/.exec(value.text);
  if (!parsed || !Intl.supportedValuesOf('currency').includes(parsed[1])) return null;
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: parsed[1] }).resolvedOptions().maximumFractionDigits!;
  return { currency: parsed[1], amount: Number(parsed[2]), unit: parsed[3]?.trim(), text: new Intl.NumberFormat('en-US', { style: 'currency', currency: parsed[1], maximumFractionDigits: Math.max(digits, Math.min(20, parsed[2].split('.')[1]?.length ?? 0)) }).format(Number(parsed[2])) };
}

/** Remove only the importer's exact leading price clauses, leaving every word
 * of the following description/qualifications and conflicting prices intact. */
function importedPriceDescription(name: string, source: string, prices: WebsiteValue[]): string | undefined {
  const parsed = prices.map(websitePrice);
  if (!parsed.length || parsed.some(value => !value)) return undefined;
  let remainder = source.trim();
  if (remainder.startsWith(name) && /^[\s~:–—-]/.test(remainder.slice(name.length))) remainder = remainder.slice(name.length).replace(/^[\s~:–—-]+/, '');
  const matched = new Set<number>();
  for (let index = 0; index < prices.length; index++) {
    const clause = /^(?:([^$£€:]{1,80}):\s*)?([$£€])\s*(\d[\d,]*(?:\.\d+)?)\b/.exec(remainder);
    if (!clause) return undefined;
    if (/^\s*(?:[-–—/]|\b(?:to|per)\b)/i.test(remainder.slice(clause[0].length))) return undefined;
    const match = parsed.findIndex((price, position) => !matched.has(position) && price
      && ({ USD: '$', GBP: '£', EUR: '€' } as Record<string, string>)[price.currency] === clause[2]
      && price.amount === Number(clause[3].replaceAll(',', ''))
      && (price.unit?.toLocaleLowerCase() ?? '') === (clause[1]?.trim().toLocaleLowerCase() ?? ''));
    if (match === -1) return undefined;
    matched.add(match);
    remainder = remainder.slice(clause[0].length).replace(/^(?:[\s,;]+|\.\s+)+/, '');
  }
  return /[$£€]\s*\d/.test(remainder) ? undefined : remainder;
}

/** Website-only cards deliberately do not change the assistant's ContentCard. */
function WebsiteCard({ entry, onOpen, gallery, signature, index, highlighted, sectionTitle }: { entry: WebsiteEntry; onOpen: () => void; gallery: boolean; signature: boolean; index: number; highlighted: boolean; sectionTitle: string }) {
  const motionEnabled = useContext(WebsiteMotionContext);
  const role = (value: NonNullable<WebsiteEntry['values']>[number]) => value.role ?? websiteValueRole(value);
  const prices = entry.values?.filter(value => role(value) === 'price') ?? [];
  const terms = entry.values?.filter(value => role(value) === 'price-terms') ?? [];
  const category = entry.values?.find(value => /^(?:source )?category$/i.test(value.label));
  const sourceBody = terms.length === 1 ? `${category?.text ? `${category.text}. ` : ''}${terms[0].text}` : undefined;
  const copiedSummary = sourceBody !== undefined && (entry.body === `${sourceBody}. Listed information; availability is not verified.`
    || entry.body === `${sourceBody}${/[.!?]$/.test(sourceBody) ? '' : '.'} Listed information; availability is not verified.`);
  const description = copiedSummary ? importedPriceDescription(entry.name, terms[0].text, prices) : undefined;
  return <motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} whileTap={motionEnabled ? { scale: .995 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} type="button" className="platform-content-card platform-website-card" data-has-image={Boolean(entry.imageAssetId)} data-kind={entry.kind}
    data-task-record={entry.recordId} data-workspace-content={entry.id} data-workspace-highlighted={highlighted ? entry.id : undefined} aria-label={`Open ${entry.name}`} onClick={onOpen}>
    {entry.imageAssetId && <span className="platform-website-image-frame" data-website-frame data-website-depth={signature || undefined}><span className="platform-website-image-content"><motion.span className="platform-website-image-interaction" variants={imageVariants} transition={motionEnabled ? { duration: .42, ease: [.22, .68, .2, 1] } : { duration: 0 }}><MediaImage checkInitialLoad assetId={entry.imageAssetId} size="display" loading="lazy" interactive={false} aspectRatio={gallery ? '4 / 3' : '16 / 11'}/></motion.span></span></span>}
    <span className="platform-content-card-copy">
      {!gallery && <span className="platform-website-item-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>}
      <strong>{entry.name}</strong>
      {entry.example && <span className="platform-media-example">Illustrative example</span>}
      {!gallery && entry.body && !copiedSummary && <span className="platform-content-card-description">{entry.body}</span>}
      {description && <span className="platform-content-card-description platform-website-price-description">{description}</span>}
      {prices.length > 0 && <span className="platform-website-price">{prices.map((value, position) => {
        const price = websitePrice(value);
        const label = price?.unit ? `${/^(?:starting|base)\b/i.test(value.label) ? `${value.label} / ` : ''}${price.unit}` : (/^(?:listed )?price(?:\s*\([^)]*\))?$/i.test(value.label) ? 'Price' : value.label);
        return <span className="platform-website-price-variant" key={`${position}:${value.label}`}><span>{label}</span><span>{price?.text ?? value.text}</span></span>;
      })}</span>}
      {terms.filter(() => description === undefined).map(value => <span className="platform-content-card-value" key={value.label}>{value.label}: {value.text}</span>)}
      {entry.values?.filter(value => !prices.includes(value) && !terms.includes(value) && !(value === category && value.text === sectionTitle)).slice(0, 2).map(value => <span className="platform-content-card-value" key={value.label}>{value.label}: {value.text}</span>)}
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

/** Composition changes only the arrangement of existing content. Price/service
 * rows stay comparable; sparse and mixed-media collections never need filler. */
function sectionComposition(section: WebsiteSection, template: WebsiteTemplate | undefined, entries: WebsiteEntry[], leadImage?: { width: number; height: number }) {
  const layout = collectionLayout(section);
  if (template === 'editorial' && section.kind === 'stories' && entries.some(entry => entry.imageAssetId)) return 'illustrated-story';
  if (entries.length >= 3 && entries.every(entry => entry.imageAssetId) && ['gallery', 'portfolio', 'catalog'].includes(layout)) {
    if (template === 'editorial') return 'editorial-gallery';
    if (template === 'showcase' && (section.kind !== 'photos' || leadImage && leadImage.width >= 1200 && leadImage.width / leadImage.height >= 1.8)) return 'image-grid';
  }
  if (template === 'clarity' && layout === 'catalog' && section.kind === 'collection' && entries.length > 1) return 'quick-grid';
  return 'flow';
}

function WebsiteGroup({ section, anchor, onOpen, onInteraction, highlightedId, onPage, template, signature }: { section: WebsiteSection; anchor: string; onOpen: (id: string) => void; onInteraction: () => void; highlightedId?: string; onPage?: (offset: number) => void; template?: WebsiteTemplate; signature: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const motionEnabled = useContext(WebsiteMotionContext);
  const { ref: expansionRef, prepare } = useWebsiteExpansion(motionEnabled, expanded);
  const limit = section.paged ? 48 : section.kind === 'photos' ? 8 : 6;
  const entries = expanded ? section.entries : section.entries.slice(0, limit);
  const presentation = collectionLayout(section);
  const leadImage = usePublishedMedia()?.library.assets.find(asset => asset.id === entries[0]?.imageAssetId);
  return <section id={anchor} tabIndex={-1} className="platform-website-section" data-section-kind={section.kind} data-collection-layout={presentation} data-website-composition={sectionComposition(section, template, entries, leadImage)} data-entry-count={entries.length} aria-label={section.title}>
    <span className="platform-website-section-rule" data-website-reveal="rule" aria-hidden="true"/>
    <header className="platform-website-section-heading" data-website-reveal><div>{section.parentTitle && <span className="platform-website-eyebrow">{section.parentTitle}</span>}<h2>{section.title}</h2>{section.description && <p>{section.description}</p>}</div>
      {(section.kind === 'collection' || section.kind === 'photos') && <span className="platform-website-count">{section.total ?? section.entries.length} {section.kind === 'photos' ? section.entries.length === 1 ? 'photo' : 'photos' : section.entries.length === 1 ? 'item' : 'items'}</span>}
    </header>
    <div ref={expansionRef} className="platform-website-section-body" id={`${anchor}-entries`}>
      {section.kind === 'faq' ? <div className="platform-website-faq">{entries.map((entry, index) => <WebsiteDisclosure key={entry.id} title={entry.name} reveal order={index} onInteraction={onInteraction}>
        <div className="platform-website-answer">{entry.blocks?.length ? entry.blocks.map(block => block.kind === 'heading' ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>) : <p>{entry.body}</p>}{entry.values?.map(value => <p key={value.label}><strong>{value.label}</strong> {value.text}</p>)}</div>
      </WebsiteDisclosure>)}</div> : section.kind === 'stories' || section.kind === 'information' ? <div className="platform-website-stories">{entries.map(entry => {
        const showTitle = section.entries.length > 1 || entry.name !== section.title;
        const BlockHeading = showTitle ? 'h4' : 'h3';
        const headingKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
        const previewBlocks = entry.blocks?.filter((block, index) => index !== 0 || block.kind !== 'heading' || headingKey(block.text) !== headingKey(entry.name));
        return <article key={entry.id} data-task-record={entry.recordId} className="platform-website-story" data-website-reveal>
        {entry.imageAssetId && <motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} type="button" aria-label={`Explore the photo for ${entry.name}`} onClick={() => onOpen(entry.id)}><span className="platform-website-image-frame" data-website-frame><span className="platform-website-image-content"><motion.span className="platform-website-image-interaction" variants={imageVariants} transition={motionEnabled ? { duration: .42 } : { duration: 0 }}><MediaImage checkInitialLoad assetId={entry.imageAssetId} size="display" loading="lazy" interactive={false}/></motion.span></span></span></motion.button>}
        <div>{showTitle && <h3>{entry.name}</h3>}
          {previewBlocks?.length ? (template ? previewBlocks.slice(0, 2) : previewBlocks).map(block => block.kind === 'heading' ? <BlockHeading className="platform-website-story-subheading" key={block.id}>{block.text}</BlockHeading> : <p key={block.id}>{template && block.text.length > 600 ? `${block.text.slice(0, 600)}…` : block.text}</p>) : <p>{template && (entry.body?.length ?? 0) > 600 ? `${entry.body!.slice(0, 600)}…` : entry.body}</p>}
          {entry.example && <span className="platform-media-example">Illustrative example</span>}{entry.caption && <p className="platform-website-caption">{entry.caption}</p>}{entry.credit && <small className="platform-website-credit">{entry.credit}</small>}
          <motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} whileTap={motionEnabled ? { scale: .98 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} type="button" className="platform-website-text-link" aria-label={`Open ${entry.name}`} data-workspace-content={entry.id} data-workspace-highlighted={highlightedId === entry.id ? entry.id : undefined} onClick={() => onOpen(entry.id)}>{section.kind === 'stories' ? 'Continue reading' : 'Full details'} <motion.span variants={arrowVariants} transition={motionEnabled ? controlTransition : { duration: 0 }} aria-hidden="true">↗</motion.span></motion.button>
        </div>
      </article>; })}</div> : <ol className="platform-website-entries" data-with-photos={entries.some(entry => entry.imageAssetId)}>{entries.map((entry, index) => <li key={entry.id} data-website-reveal data-website-order={index}>
        {template ? <WebsiteCard entry={entry} sectionTitle={section.title} index={index} gallery={section.kind === 'photos'} signature={signature && index === 0} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/> : <ContentCard motionEnabled={false} entry={entry} number={index + 1} onOpen={() => onOpen(entry.id)} highlighted={highlightedId === entry.id}/>}
      </li>)}</ol>}
      {onPage && section.total != null && <nav className="platform-website-pagination" aria-label="Collection pages"><button type="button" className="platform-website-text-link" disabled={!section.offset} onClick={() => onPage(Math.max(0, (section.offset ?? 0) - 24))}>Previous page</button><span aria-live="polite">{Math.floor((section.offset ?? 0) / 24) + 1} / {Math.max(1, Math.ceil(section.total / 24))}</span><button type="button" className="platform-website-text-link" disabled={(section.offset ?? 0) + 24 >= section.total} onClick={() => onPage((section.offset ?? 0) + 24)}>Next page</button></nav>}
      {section.entries.length > limit && <motion.button initial={false} layout={motionEnabled ? 'position' : false} whileHover={motionEnabled ? { y: -2 } : undefined} whileTap={motionEnabled ? { scale: .985 } : undefined} transition={motionEnabled ? { ...controlTransition, layout: { duration: .42, ease: [.22, .68, .2, 1] } } : { duration: 0 }} type="button" className="platform-website-more" aria-expanded={expanded} aria-controls={`${anchor}-entries`} onClick={event => { if (expanded && expansionRef.current?.contains(document.activeElement)) event.currentTarget.focus({ preventScroll: true }); prepare(); onInteraction(); setExpanded(value => !value); }}>{expanded ? 'Show fewer' : `Explore all ${section.entries.length}`} <DisclosureMark open={expanded}/></motion.button>}
    </div>
  </section>;
}

/** A controlled, provider-independent website composed only from the published snapshot. */
export function PublishedWebsite({ primaryAction, name, headline, description, tagline, template: selectedTemplate, styleSettings, websiteMotion = 'subtle', active = true, assistantEnabled = true, logoAssetId, hero, sections, contact, hours, onOpen, onHome, onInteraction, highlightedId, onPage, onAsk = onHome, layout = 'balanced' }: {
  primaryAction?: { actionId: string; label: string } | null;
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
  const links = <>{navigation.map(section => <WebsiteNavLink key={section.id} href={`#${anchor(section.id)}`} onClick={navigate}>{section.navLabel ?? section.title}</WebsiteNavLink>)}{(contact || hours) && <WebsiteNavLink href={`#${anchor('contact')}`} onClick={navigate}>Contact</WebsiteNavLink>}</>;
  const selectedSection = primaryAction?.actionId.startsWith('section:') ? displayed.find(section => section.id === primaryAction.actionId.slice(8)) : undefined;
  const primaryTarget = selectedSection?.id ?? (primaryAction?.actionId === 'contact' && contact ? 'contact' : displayed[0]?.id);
  const primaryLabel = selectedSection || primaryAction?.actionId === 'contact' && contact ? primaryAction!.label : displayed[0]?.navLabel ?? displayed[0]?.title;
  const primaryAssistant = primaryAction?.actionId === 'assistant' && assistantEnabled;
  const actions = <div className="platform-website-hero-actions" data-website-reveal="actions" data-website-order="3">{primaryTarget && !primaryAssistant && <motion.a initial={false} whileHover={motionEnabled ? { y: -3 } : undefined} whileTap={motionEnabled ? { scale: .98 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} href={`#${anchor(primaryTarget)}`} onClick={navigate}>{primaryLabel} <span aria-hidden="true">↘</span></motion.a>}{assistantEnabled && <motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} whileTap={motionEnabled ? { scale: .98 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} type="button" onClick={onAsk}>Ask a question <motion.span variants={arrowVariants} transition={motionEnabled ? controlTransition : { duration: 0 }} aria-hidden="true">↗</motion.span></motion.button>}</div>;
  const photograph = hero?.imageAssetId && <figure><motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} whileTap={motionEnabled ? { scale: .995 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} type="button" onClick={() => onOpen(hero.id)} aria-label={`Open ${hero.name}`}><span className="platform-website-image-frame" data-website-frame data-website-depth data-website-order="2"><span className="platform-website-image-content"><motion.span className="platform-website-image-interaction" variants={imageVariants} transition={motionEnabled ? { duration: .42, ease: [.22, .68, .2, 1] } : { duration: 0 }}><MediaImage checkInitialLoad assetId={hero.imageAssetId} size="display" interactive={false} aspectRatio={template === 'showcase' ? '16 / 9' : '4 / 5'}/></motion.span></span></span></motion.button><figcaption><span>{hero.caption || hero.name}{hero.example ? ' · Illustrative example' : ''}</span>{hero.credit && <small>{hero.credit}</small>}</figcaption></figure>;
  return <WebsiteMotionContext.Provider value={motionEnabled}><div ref={root} style={defaults} id={anchor('top')} tabIndex={-1} className="platform-website" data-template={template} data-website-design="refined" data-website-motion={websiteMotion} data-website-paused={!active} data-published-website="true" data-website-layout={layout} role="region" aria-label="Browse approved information">
    {template && <a className="platform-website-skip" onClick={navigate} href={`#${anchor(displayed[0]?.id ?? 'contact')}`}>Skip to content</a>}
    <header className="platform-website-header"><button className="platform-website-brand" onClick={onHome} type="button" aria-label={`${name} home`}>{logoAssetId && <MediaImage checkInitialLoad assetId={logoAssetId} fit="contain" interactive={false}/>}<span>{name}</span></button>
      <nav aria-label="Website navigation">{navigation.slice(0, 4).map(section => <WebsiteNavLink key={section.id} href={`#${anchor(section.id)}`} onClick={navigate}>{section.navLabel ?? section.title}</WebsiteNavLink>)}{navigation.length > 4 && <WebsiteDisclosure title="More" className="platform-website-nav-more" onInteraction={onInteraction}><div className="platform-website-disclosure-inner">{navigation.slice(4).map(section => <WebsiteNavLink key={section.id} href={`#${anchor(section.id)}`} onClick={navigate}>{section.navLabel ?? section.title}</WebsiteNavLink>)}</div></WebsiteDisclosure>}{(contact || hours) && <WebsiteNavLink href={`#${anchor('contact')}`} onClick={navigate}>Contact</WebsiteNavLink>}</nav>
      {template && (navigation.length > 0 || contact || hours) && <WebsiteDisclosure title="Menu" className="platform-website-mobile-nav" onInteraction={onInteraction}><nav aria-label="Mobile website navigation">{links}</nav></WebsiteDisclosure>}
    </header>
    <div className="platform-website-hero" data-has-image={Boolean(hero?.imageAssetId)} data-hero-layout={heroLayout} style={heroStyle}>
      <div className="platform-website-hero-copy">{tagline && tagline !== headline && <span className="platform-website-eyebrow" data-website-reveal="eyebrow">{tagline}</span>}<h1 data-website-reveal="headline" data-website-order="1">{headline}</h1>{!separateIntro && <>{description && <p data-website-reveal="copy" data-website-order="2">{description}</p>}{actions}</>}</div>
      {separateIntro && (description || displayed.length > 0 || assistantEnabled || primaryTarget) && <div className="platform-website-hero-intro">{description && <p data-website-reveal="copy" data-website-order="2">{description}</p>}{actions}</div>}
      {photograph}
      {template === 'clarity' && !photograph && navigation.length > 0 && <aside className="platform-website-directory" aria-label="On this website"><span className="platform-website-eyebrow">On this website</span>{navigation.slice(0, 4).map((section, i) => <a data-website-reveal="directory-item" data-website-order={i} href={`#${anchor(section.id)}`} key={section.id} onClick={navigate}><span>0{i + 1}</span>{section.navLabel ?? section.title}<span aria-hidden="true">↗</span></a>)}</aside>}
    </div>
    <section className="platform-website-content" aria-label="Website content"><div>{displayed.map(section => <WebsiteGroup key={section.id} template={template} section={section} anchor={anchor(section.id)} onOpen={onOpen} onInteraction={onInteraction} highlightedId={highlightedId} onPage={section.id === 'published-catalog' ? onPage : undefined} signature={section.id === signatureSection}/>)}</div></section>
    <footer id={anchor('contact')} tabIndex={-1} className="platform-website-footer" data-minimal={!contact && !hours}>
      {(tagline || contact || hours || assistantEnabled) && <div data-website-reveal><h2>{tagline || name}</h2>{assistantEnabled && <motion.button initial={false} animate="rest" whileHover={motionEnabled ? 'intent' : undefined} whileFocus={motionEnabled ? 'intent' : undefined} whileTap={motionEnabled ? { scale: .98 } : undefined} transition={motionEnabled ? controlTransition : { duration: 0 }} type="button" className="platform-website-text-link" onClick={onAsk}>Ask a question <motion.span variants={arrowVariants} transition={motionEnabled ? controlTransition : { duration: 0 }} aria-hidden="true">↗</motion.span></motion.button>}</div>}
      {(contact || hours) && <div className="platform-website-contact" data-website-reveal>{contact && <div data-source-id="contact"><h3>Get in touch</h3><p><ContactText text={contact}/></p></div>}{hours && <div data-source-id="hours"><h3>Hours &amp; availability</h3><p>{hours}</p></div>}</div>}
      <div className="platform-website-colophon"><span>{name}</span><span>Made with FlowPath Studio</span><a href={`#${anchor('top')}`} onClick={navigate}>Back to top ↑</a></div>
    </footer>
  </div></WebsiteMotionContext.Provider>;
}
