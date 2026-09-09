'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleHelp, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import type { BillingAction, BillingView } from '@/lib/billing-view';
import styles from './BillingPanel.module.css';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const date = (value: number | null) => value === null ? 'When your plan starts' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value);
const problem = (error: unknown) => error instanceof Error ? error.message : 'Billing could not be loaded.';
const stripeTestCheckoutUrl = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    return url.origin === 'https://checkout.stripe.com' && !url.username && !url.password
      && /^\/(?:c\/)?pay\/cs_test_[a-zA-Z0-9]+(?:\/|$)/.test(url.pathname) ? url.href : null;
  } catch { return null; }
};
type Settings = Pick<BillingView['replenishment'], 'enabled' | 'amountCents' | 'thresholdCents' | 'monthlyCeilingCents'>;
const settingsFrom = (view: BillingView): Settings => ({ enabled: view.replenishment.enabled, amountCents: view.replenishment.amountCents, thresholdCents: view.replenishment.thresholdCents, monthlyCeilingCents: view.replenishment.monthlyCeilingCents });

export default function BillingPanel({ siteId, siteName }: { siteId: string; siteName: string }) {
  const ceilingHelpId = useId();
  const [view, setView] = useState<BillingView | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [topup, setTopup] = useState(1000);
  const [settings, setSettings] = useState<Settings>({ enabled: false, amountCents: 1000, thresholdCents: 200, monthlyCeilingCents: 5000 });
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const uncertainPayment = useRef<{ signature: string; key: string } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  // Site changes must invalidate a pending checkout before passive effect cleanup.
  useLayoutEffect(() => () => { mounted.current = false; controller.current?.abort(); }, []);

  function accept(next: BillingView) {
    if (next.siteId !== siteId) throw new Error('Billing returned a different site. Refresh to try again.');
    setView(next); setSettings(settingsFrom(next));
    const currentCycle = next.subscription.cycle ?? next.pendingCheckout?.cycle;
    if (currentCycle) setCycle(currentCycle);
  }

  useEffect(() => {
    mounted.current = true;
    const request = new AbortController(); controller.current = request;
    void fetch(`/api/sites/${siteId}/billing`, { cache: 'no-store', signal: request.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Billing could not be loaded.');
        if (request.signal.aborted) return;
        if (body.billing?.siteId !== siteId) throw new Error('Billing returned a different site. Refresh to try again.');
        setView(body.billing); setSettings(settingsFrom(body.billing));
        const currentCycle = body.billing.subscription.cycle ?? body.billing.pendingCheckout?.cycle;
        if (currentCycle) setCycle(currentCycle);
      }).catch(error => { if (!request.signal.aborted) setError(problem(error)); });
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [siteId]);

  async function refresh() {
    if (running.current) return;
    running.current = true; setPending('refresh'); setError(''); setNotice('');
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch(`/api/sites/${siteId}/billing`, { cache: 'no-store', signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Billing could not be refreshed.');
      if (!mounted.current || request.signal.aborted) return;
      accept(body.billing); setNeedsRefresh(false); setNotice('Balances refreshed.');
    } catch (error) { if (!request.signal.aborted) setError(problem(error)); }
    finally { if (mounted.current && !request.signal.aborted) { running.current = false; setPending(''); } }
  }

  async function change(action: BillingAction, message: string) {
    if (running.current || !view || view.mode !== 'preview' || needsRefresh) return;
    if (view.pendingCheckout && (action.action === 'activate' || action.action === 'topup')) return;
    const initiatingControl = document.activeElement;
    let newerFocusIntent = false;
    const focusTracking = new AbortController();
    const trackFocusIntent = () => { newerFocusIntent = true; };
    document.addEventListener('pointerdown', trackFocusIntent, { capture: true, signal: focusTracking.signal });
    document.addEventListener('keydown', trackFocusIntent, { capture: true, signal: focusTracking.signal });
    running.current = true; setPending(action.action); setError(''); setNotice('');
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    if ('idempotencyKey' in action) {
      const signature = JSON.stringify({ ...action, idempotencyKey: undefined });
      if (uncertainPayment.current?.signature === signature) action = { ...action, idempotencyKey: uncertainPayment.current.key };
      else uncertainPayment.current = { signature, key: action.idempotencyKey };
    }
    try {
      const response = await fetch(`/api/sites/${siteId}/billing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal: request.signal });
      const body = await response.json();
      if (!response.ok) { setNeedsRefresh(response.status === 409); throw new Error(body.error || 'The change could not be saved.'); }
      if (!mounted.current || request.signal.aborted) return;
      if (body.checkoutUrl) {
        const checkout = stripeTestCheckoutUrl(body.checkoutUrl);
        if (view.checkoutProvider !== 'stripe' || !checkout) throw new Error('The test checkout address could not be verified.');
        setNotice('Opening Stripe test checkout. Credit updates after the payment is verified.');
        window.location.assign(checkout);
        return;
      }
      accept(body.billing); uncertainPayment.current = null;
      setNotice(body.billing.pendingCheckout ? 'Checkout is awaiting verification. Refresh billing to check its status.' : message);
      // Disabling a pending control can move focus to the body. Restore it, or
      // transfer it if the control disappeared, without replacing newer intent.
      requestAnimationFrame(() => {
        if (!mounted.current || newerFocusIntent || document.activeElement !== document.body) return;
        const target = initiatingControl instanceof HTMLElement && initiatingControl.isConnected ? initiatingControl : status.current;
        target?.focus({ preventScroll: true });
      });
    } catch (error) {
      if (!request.signal.aborted) {
        setError(problem(error));
        if (error instanceof TypeError || error instanceof SyntaxError) { setNeedsRefresh(true); setError('This change could not be confirmed. Refresh balances before trying again.'); }
      }
    } finally {
      focusTracking.abort();
      if (mounted.current && !request.signal.aborted) { running.current = false; setPending(''); }
    }
  }

  const active = view?.subscription.status === 'active';
  const preview = view?.mode === 'preview';
  const stripeCheckout = preview && view?.checkoutProvider === 'stripe';
  const disabled = !!pending || !preview || needsRefresh;
  const paymentDisabled = disabled || !!view?.pendingCheckout;
  const savedCheckout = stripeCheckout ? view?.pendingCheckout : undefined;
  const savedCheckoutUrl = savedCheckout?.status === 'open' ? stripeTestCheckoutUrl(savedCheckout.checkoutUrl) : null;
  const offer = view?.offer;
  const available = view ? view.balances.includedCents + view.balances.purchasedCents : 0;
  const settingsDirty = !!view && JSON.stringify(settings) !== JSON.stringify(settingsFrom(view));
  const settingsValid = settings.thresholdCents >= 0 && settings.thresholdCents <= 5000 && Number.isInteger(settings.thresholdCents)
    && settings.monthlyCeilingCents >= settings.amountCents && settings.monthlyCeilingCents <= 1_000_000 && Number.isInteger(settings.monthlyCeilingCents);

  return <section className={styles.panel} aria-label="Site subscription and AI credits" aria-busy={!!pending}>
    <div className="panel-heading"><span className="eyebrow">Your launch, your pace</span><h2>Usage & billing</h2><p>One simple plan for {siteName}. AI usage stays in your control.</p></div>
    {view && <div className={styles.banner}><ShieldCheck size={19} aria-hidden="true"/><div><strong>{stripeCheckout ? 'Stripe test billing — no real charges' : preview ? 'Billing preview — no real charges' : 'Checkout is not available yet'}</strong><p>{stripeCheckout ? 'Subscriptions and top-ups open Stripe test checkout. Credit is added after the payment is verified. Public hosting and custom-domain setup are separate.' : preview ? 'Try the plan and credit controls with a local test balance. Stripe checkout, public hosting and custom-domain setup are not connected.' : 'This launch offer is ready to preview. Real subscriptions and credit purchases will be available when Stripe payment processing is connected.'}</p></div></div>}
    <div className={styles.feedback}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p ref={status} tabIndex={-1} role="status" className={styles.status}>{pending ? pending === 'refresh' ? 'Refreshing balances…' : 'Saving your preview…' : notice}</p>
      {(!view && error || needsRefresh) && <button className="button secondary" disabled={!!pending} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true"/>Refresh billing</button>}
      {!view && !error && <p role="status">Loading your plan…</p>}
    </div>
    {view && offer && <>
      {savedCheckout && <section className={styles.card} aria-label="Pending Stripe checkout">
        <div className={styles.cardHeading}><h3>{savedCheckoutUrl ? 'Continue your checkout' : 'Payment confirmation pending'}</h3><span className={styles.badge}>Pending</span></div>
        <p className={styles.small}>{money(savedCheckout.amountCents)} for {savedCheckout.kind === 'topup' ? 'AI credit' : `${savedCheckout.cycle === 'annual' ? 'an annual' : 'a monthly'} subscription`}.</p>
        <p className={styles.small}>{savedCheckoutUrl ? 'Your existing Stripe test checkout is ready to resume. Your balance updates only after payment is verified.' : savedCheckout.status === 'awaiting-confirmation' ? 'Checkout is complete. Waiting for verified payment before updating your plan or credit. Refresh billing to check its status.' : 'The checkout request could not be confirmed. Refresh billing to check its status. A new checkout stays unavailable while this request is reconciled.'}</p>
        <div className={styles.simulationActions}>{savedCheckoutUrl && <a className="button primary" href={savedCheckoutUrl} rel="noreferrer" aria-disabled={!!pending || needsRefresh} onClick={event => { if (running.current || needsRefresh || !mounted.current) event.preventDefault(); }}>Resume Stripe test checkout<ArrowUpRight size={15} aria-hidden="true"/></a>}<button className="button secondary" disabled={!!pending} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true"/>Refresh payment status</button></div>
      </section>}
      <section className={`${styles.card} ${styles.plan}`} aria-label="Launch plan">
        <div className={styles.cardHeading}><div><span className={styles.kicker}>The launch offer</span><h3>Everything for one site</h3></div><span className={styles.badge}>{active ? view.subscription.cancelAtPeriodEnd ? 'Ends at renewal' : 'Active preview' : 'One plan'}</span></div>
        {!active && <fieldset className={styles.cycles} disabled={paymentDisabled}><legend>Billing cycle</legend>
          <label className={cycle === 'monthly' ? styles.selected : ''}><input type="radio" name="billing-cycle" value="monthly" checked={cycle === 'monthly'} onChange={() => setCycle('monthly')}/><span>Monthly</span></label>
          <label className={cycle === 'annual' ? styles.selected : ''}><input type="radio" name="billing-cycle" value="annual" checked={cycle === 'annual'} onChange={() => setCycle('annual')}/><span>Annually <small>Save {money(offer.monthlyCents * 12 - offer.annualCents)}/year</small></span></label>
        </fieldset>}
        <div className={styles.price}><strong>{money(cycle === 'annual' ? offer.annualCents / 12 : offer.monthlyCents).replace('.00', '')}</strong><span>/ month</span></div>
        <p className={styles.priceNote}>{cycle === 'annual' ? `${money(offer.annualCents)} billed annually` : `${money(offer.monthlyCents)} billed monthly`} · USD</p>
        <ul className={styles.features}>
          <li><Check size={16} aria-hidden="true"/>One published site, hosting and core publishing</li>
          <li><Check size={16} aria-hidden="true"/>Custom-domain connection; registration is separate</li>
          <li><Check size={16} aria-hidden="true"/>{money(view.allowance.monthlyCents)} in AI credit every month</li>
        </ul>
        <p className={styles.small}>Included credit renews monthly on both plans. Unused included credit expires each month; purchased credit rolls over.</p>
        {active ? <div className={styles.renewal}><p><strong>{view.subscription.cancelAtPeriodEnd ? 'Access continues until ' : 'Current term ends '}{date(view.subscription.currentPeriodEnd)}.</strong><br/>{view.subscription.cancelAtPeriodEnd ? 'Automatic replenishment is off. Purchased credit stays on this site.' : 'Manage renewal here without changing your published content.'}</p><button className="text-button" disabled={disabled} onClick={() => void change({ action: view.subscription.cancelAtPeriodEnd ? 'resume' : 'cancel', revision: view.revision }, view.subscription.cancelAtPeriodEnd ? 'Preview renewal restored. Automatic replenishment stays off until you enable it.' : 'Preview renewal canceled. Your plan remains active until the end of the term.')}>
          {view.subscription.cancelAtPeriodEnd ? 'Keep preview subscription' : 'Cancel preview renewal'}
        </button></div> : <button className={`button primary ${styles.wideButton}`} disabled={paymentDisabled} onClick={() => void change({ action: 'activate', cycle, idempotencyKey: crypto.randomUUID() }, 'Preview plan started. Your monthly AI credit is ready.')}>
          {stripeCheckout ? 'Continue to Stripe test checkout' : preview ? `Simulate ${cycle === 'annual' ? 'annual' : 'monthly'} subscription` : 'Checkout coming soon'}<ArrowUpRight size={16} aria-hidden="true"/>
        </button>}
      </section>

      <section className={styles.card} aria-label="AI credit balance">
        <div className={styles.cardHeading}><div><span className={styles.kicker}>Pay as you go</span><h3><Wallet size={18} aria-hidden="true"/>AI credit</h3></div><button className="icon-button" disabled={!!pending} aria-label="Refresh credit balances" onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true"/></button></div>
        <div className={styles.total}><strong>{preview ? money(available) : '—'}</strong><span>available for AI usage</span></div>
        <dl className={styles.balances}>
          <div><dt>Included credit <span>{active ? `Resets ${date(view.allowance.resetsAt)}` : `${money(view.allowance.monthlyCents)} each month with your plan`}</span></dt><dd>{preview ? money(view.balances.includedCents) : '—'}</dd></div>
          <div><dt>Purchased credit <span>Rolls over month to month</span></dt><dd>{preview ? money(view.balances.purchasedCents) : '—'}</dd></div>
          <div><dt>Reserved for work in progress <span>Already excluded from available credit</span></dt><dd>{preview ? money(view.balances.reservedCents) : '—'}</dd></div>
        </dl>
        <div className={styles.rateNote}><CircleHelp size={16} aria-hidden="true"/><p>Credits are measured at retail rates, currently {offer.retailMultiplier}× provider API cost: $1.00 of provider usage uses {money(offer.retailMultiplier * 100)} of credit. Text and voice consume different amounts. Rates can change for future usage.</p></div>
        <p className={styles.small}>Included credit is used first. When available credit runs out, AI pauses and visitors can keep browsing your site.</p>
        <form onSubmit={event => { event.preventDefault(); if (!paymentDisabled && active) void change({ action: 'topup', amountCents: topup, idempotencyKey: crypto.randomUUID() }, `${money(topup)} of preview credit added.`); }}>
          <fieldset className={styles.creditChoices} disabled={paymentDisabled || !active}><legend>Add prepaid credit</legend>{offer.topUpAmountsCents.map(amount => <label className={topup === amount ? styles.selected : ''} key={amount}><input type="radio" name="topup" value={amount} checked={topup === amount} onChange={() => setTopup(amount)}/><span>{money(amount).replace('.00', '')}</span></label>)}</fieldset>
          <button className={`button secondary ${styles.wideButton}`} disabled={paymentDisabled || !active} type="submit">{stripeCheckout ? `Add ${money(topup)} test credit` : `Simulate adding ${money(topup)} credit`}</button>
          {!active && <p className={styles.small}>Start a plan to add credit for this site.</p>}
        </form>
      </section>

      <section className={styles.card} aria-label="Automatic replenishment">
        <div className={styles.cardHeading}><div><span className={styles.kicker}>Optional, with a limit</span><h3>Automatic replenishment</h3></div><span className={styles.badge}>{view.replenishment.enabled ? 'On' : 'Off'}</span></div>
        <p className={styles.small}>Add credit when your balance gets low. Your monthly ceiling limits automatic top-ups; manual top-ups and the subscription are separate.</p>
        <form onSubmit={event => { event.preventDefault(); if (!disabled && active && settingsDirty && settingsValid) void change({ action: 'replenishment', ...settings, revision: view.revision }, settings.enabled ? 'Preview replenishment settings saved.' : 'Automatic replenishment turned off.'); }}>
          <label className={styles.toggle}><input type="checkbox" checked={settings.enabled} aria-describedby={stripeCheckout ? `auto-consent-${siteId}` : undefined} disabled={disabled || !active || view.subscription.cancelAtPeriodEnd} onChange={event => setSettings(event.target.checked ? { ...settings, enabled: true } : { ...settingsFrom(view), enabled: false })}/><span>Enable automatic replenishment</span></label>
          {stripeCheckout && <p id={`auto-consent-${siteId}`} className={styles.small}>Enabling this and saving authorizes automatic test charges of {money(settings.amountCents)} to your saved Stripe payment method when credit falls below {money(settings.thresholdCents)}, up to {money(settings.monthlyCeilingCents)} per UTC calendar month. You can turn it off here at any time.</p>}
          <fieldset className={styles.autoFields} disabled={disabled || !active || !settings.enabled || view.subscription.cancelAtPeriodEnd}>
            <legend className={styles.srOnly}>Replenishment limits in US dollars</legend>
            <label className="field">Add each time<select aria-label="Add each time" value={settings.amountCents} onChange={event => setSettings({ ...settings, amountCents: Number(event.target.value) })}>{offer.topUpAmountsCents.map(amount => <option key={amount} value={amount}>{money(amount)}</option>)}</select></label>
            <label className="field">When credit falls below ($)<input aria-label="When credit falls below ($)" type="number" required min="0" max="50" step="1" value={Number.isFinite(settings.thresholdCents) ? settings.thresholdCents / 100 : ''} onChange={event => setSettings({ ...settings, thresholdCents: event.target.valueAsNumber * 100 })}/></label>
            <label className="field">Monthly automatic top-up ceiling ($)<input aria-label="Monthly automatic top-up ceiling ($)" aria-describedby={ceilingHelpId} type="number" required min={settings.amountCents / 100} max="10000" step="1" value={Number.isFinite(settings.monthlyCeilingCents) ? settings.monthlyCeilingCents / 100 : ''} onChange={event => setSettings({ ...settings, monthlyCeilingCents: event.target.valueAsNumber * 100 })}/><span id={ceilingHelpId} className="field-help">At least one top-up; the full top-up must fit under this ceiling.</span></label>
          </fieldset>
          {settings.enabled && !settingsValid && <p className={styles.error}>Choose a valid threshold and a ceiling that covers at least one top-up.</p>}
          {view.replenishment.pause && <p className={styles.error} role="status">Automatic replenishment is paused because the last payment {view.replenishment.pause === 'unknown' ? 'could not be confirmed' : 'failed'}. No further automatic top-ups will be attempted until this is resolved.</p>}
          <p className={styles.small}>{money(view.replenishment.spentThisMonthCents)} committed to automatic top-ups this UTC calendar month. Your settings start turned off.</p>
          <button type="submit" className="button secondary" disabled={disabled || !active || !settingsDirty || !settingsValid || view.subscription.cancelAtPeriodEnd}>Save replenishment settings</button>
        </form>
      </section>
      {preview && !stripeCheckout && <details className={styles.simulation}><summary>Try usage accounting</summary><p className={styles.small}>Apply a fixed synthetic chat or voice sample to this preview balance. No AI request, microphone access or payment is made. This lets you check credit deductions and automatic replenishment.</p><div className={styles.simulationActions}><button className="button secondary" disabled={disabled || !active} onClick={() => void change({ action: 'simulate-usage', kind: 'chat', idempotencyKey: crypto.randomUUID() }, 'Synthetic chat usage applied to your preview balance.')}>Simulate chat usage</button><button className="button secondary" disabled={disabled || !active} onClick={() => void change({ action: 'simulate-usage', kind: 'voice', idempotencyKey: crypto.randomUUID() }, 'Synthetic voice usage applied to your preview balance.')}>Simulate voice usage</button></div></details>}
    </>}
  </section>;
}
