'use client';

import { forwardRef } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { publicAnswerUrl } from './answer-model.js';
import type { PublishedEstimate } from './estimate.js';
import { motionTiming, revealTransition } from './motion.js';

type EstimateLine = PublishedEstimate['lines'][number];

const lineKey = (line: EstimateLine) => JSON.stringify([line.recordId, line.fieldId]);
const variant = (line: EstimateLine) => line.unit || line.per?.replace(/[-_]+/g, ' ') || 'item';
const amount = (currency: string | null, value: string) => `${currency ? `${currency} ` : ''}${value}`;
function readableTaxIssue(issue: string, estimate: PublishedEstimate) {
  const line = estimate.lines.find(item => issue.startsWith(`${item.recordId}/${item.fieldId}: `));
  return line ? `${line.name} · ${variant(line)}: ${issue.slice(`${line.recordId}/${line.fieldId}: `.length)}` : issue;
}

function unitAmount(estimate: PublishedEstimate, line: EstimateLine) {
  return amount(estimate.currency, line.unitPrice.toLocaleString('en-US', {
    useGrouping: true, minimumFractionDigits: estimate.fractionDigits ?? 2, maximumFractionDigits: 6,
  }));
}

const EstimateItem = forwardRef<HTMLLIElement, { line: EstimateLine; estimate: PublishedEstimate }>(function EstimateItem({ line, estimate }, ref) {
  const reduced = useReducedMotion(), present = useIsPresent();
  const label = `${line.name}, ${variant(line)}`;
  const terms = [...new Set(line.sourceTerms.filter(Boolean))];
  return <motion.li ref={ref} className="platform-estimate-item" data-task-record={line.recordId} data-price-field={line.fieldId}
    layout={reduced ? false : 'position'} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 12 }}
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reflow, opacity: { duration: reduced ? 0 : .18 } }}>
    <div className="platform-estimate-item-heading">
      <h3>{line.name}</h3>
      <p className="platform-estimate-line-total" aria-label={`Line total for ${label}`}>{amount(estimate.currency, line.lineTotal)}</p>
    </div>
    <p className="platform-estimate-unit"><span className="platform-estimate-quantity" aria-label={`Quantity of ${label}: ${line.quantity}`}>{line.quantity} ×</span> {unitAmount(estimate, line)} <span>per {variant(line)}</span></p>
    {(terms.length > 0 || line.sourceSummary) && <details className="platform-estimate-source">
      <summary>Price details</summary>
      {line.sourceSummary && !terms.includes(line.sourceSummary) && <p>{line.sourceSummary}</p>}
      {terms.map(term => <p key={term}>{term}</p>)}
    </details>}
  </motion.li>;
});

/** Read-only planning results; chat and voice use the host's estimate capabilities. */
export function PublishedEstimateView({ estimate, busy = false, historical = false }: {
  estimate: PublishedEstimate; busy?: boolean; historical?: boolean;
}) {
  const reduced = useReducedMotion();
  const tax = estimate.tax;
  const complete = tax?.status === 'complete' && tax.estimatedTax !== null && tax.estimatedTotal !== null;
  const sources = tax ? [...new Map(tax.lines.flatMap(line => line.evidence).filter(source => publicAnswerUrl(source.url)).map(source => [source.url, source])).values()] : [];
  return <section className="platform-estimate" aria-label="Published price estimate" aria-busy={busy} data-estimate-revision={estimate.revision} data-estimate-historical={historical}>
    <header className="platform-estimate-heading"><h2>Estimate</h2></header>
    {historical && <p className="platform-estimate-historical">Earlier estimate · shown as it was.</p>}
    {estimate.lines.length === 0 ? <p className="platform-estimate-empty">Your estimate is empty. Ask for items and quantities to begin.</p> : <div className="platform-estimate-layout">
      <ul className="platform-estimate-items"><AnimatePresence initial={false} mode="popLayout">{estimate.lines.map(line => <EstimateItem key={lineKey(line)} line={line} estimate={estimate}/>)}</AnimatePresence></ul>
      <motion.aside className="platform-estimate-summary" aria-label="Estimate totals" layout={reduced ? false : 'position'} transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reflow }}>
        <dl>
          <div><dt>Subtotal</dt><dd>{estimate.formattedSubtotal}</dd></div>
          <div><dt>{tax?.mode === 'hypothetical' ? 'Hypothetical tax' : 'Estimated tax'}</dt><dd>{complete ? amount(estimate.currency, tax.estimatedTax!) : 'Not included'}</dd></div>
          <div className="platform-estimate-total"><dt>{complete ? 'Estimated total' : 'Before tax'}</dt><dd>{complete ? amount(estimate.currency, tax.estimatedTotal!) : estimate.formattedSubtotal}</dd></div>
        </dl>
        <p className="platform-estimate-tax-status">{tax ? tax.label : 'Tax has not been calculated.'}{tax && !complete ? ' · Incomplete' : ''}</p>
        {tax?.missing.length ? <ul className="platform-estimate-missing">{tax.missing.map((value, index) => <li key={`${index}:${value}`}>{readableTaxIssue(value, estimate)}</li>)}</ul> : null}
        <p className="platform-estimate-note">Planning estimate. Availability, fees and unlisted adjustments are not verified.</p>
        {tax && <details className="platform-estimate-source platform-estimate-tax-details"><summary>Tax assumptions &amp; sources</summary>
          {(tax.jurisdiction || tax.location || tax.fulfillment) && <dl>{tax.jurisdiction && <div><dt>Jurisdiction</dt><dd>{tax.jurisdiction}</dd></div>}{tax.location && <div><dt>Location</dt><dd>{tax.location}</dd></div>}{tax.fulfillment && <div><dt>Fulfillment</dt><dd>{tax.fulfillment}</dd></div>}</dl>}
          {[...new Set([...tax.notes, ...tax.applicabilityNotes, ...(tax.visitorAssumption ? [tax.visitorAssumption] : [])])].map(note => <p key={note}>{note}</p>)}
          {tax.lines.map(line => <div className="platform-estimate-tax-line" key={JSON.stringify([line.recordId, line.fieldId])}><strong>{estimate.lines.find(item => item.recordId === line.recordId && item.fieldId === line.fieldId)?.name ?? 'Item'}</strong><p>{line.classification ? `${line.classification} · ` : ''}{line.taxability}{line.ratePercent === null ? '' : ` · ${line.ratePercent}%`}</p><p>{line.taxabilityNotes}</p></div>)}
          {sources.length > 0 && <ul className="platform-estimate-citations">{sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || new URL(source.url).hostname}</a></li>)}</ul>}
        </details>}
      </motion.aside>
    </div>}
  </section>;
}
