'use client';

import { useEffect, useState } from 'react';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { defaultWelcomeMessage, getWelcomeMessage, greetingPointText, type GreetingPoint, WELCOME_MESSAGE_MAX_LENGTH } from '@/lib/site-greeting';
import type { SiteContent } from '@/lib/site-model';
import GreetingPlayer from './GreetingPlayer';

export default function GreetingSettings({ content, setContent, busy, siteId }: {
  content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean; siteId?: string;
}) {
  const [loaded, setLoaded] = useState<KnowledgeCatalog | null>(null);
  const catalog = loaded?.id === content.knowledgeRevisionId ? loaded : null;
  useEffect(() => {
    if (!siteId || !content.knowledgeRevisionId) return;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/knowledge?revisionId=${encodeURIComponent(content.knowledgeRevisionId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (response.ok && body.catalog && !controller.signal.aborted) setLoaded(body.catalog); }).catch(() => undefined);
    return () => controller.abort();
  }, [siteId, content.knowledgeRevisionId]);
  const message = getWelcomeMessage(content, catalog);
  const points = content.greetingPoints ?? [null, null, null];
  const choices: { label: string; point: GreetingPoint }[] = [
    ...(content.description && content.description.length <= 300 ? [{ label: 'Introduction', point: { kind: 'source' as const, id: 'overview' } }] : []),
    ...(content.hours ? [{ label: 'Hours', point: { kind: 'source' as const, id: 'hours' } }] : []),
    ...(content.contact ? [{ label: 'Contact', point: { kind: 'source' as const, id: 'contact' } }] : []),
    ...content.sections.filter(section => section.body.length <= 300).map(section => ({ label: section.title, point: { kind: 'source' as const, id: `section:${section.id}` } })),
    ...(catalog?.entities.map(entity => ({ label: entity.name, point: { kind: 'entity' as const, id: entity.id } })) ?? []),
    ...(catalog?.facts?.map(fact => ({ label: `${fact.definition?.label ?? fact.field} · ${catalog.entities.find(entity => entity.id === fact.entityId)?.name}`, point: { kind: 'fact' as const, id: fact.id } })) ?? []),
  ].filter(choice => (greetingPointText(choice.point, content, catalog)?.length ?? 1000) <= 300);
  const changePoint = (index: number, point: GreetingPoint | null) => setContent({ ...content, greetingPoints: points.map((current, i) => i === index ? point : current) });
  return <section aria-label="Voice welcome">
    <div className="section-heading"><h3>Voice welcome</h3><span>{(content.welcomeMessage || '').length} / {WELCOME_MESSAGE_MAX_LENGTH}</span></div>
    <label className="field">Welcome message
      <textarea disabled={busy} rows={4} maxLength={WELCOME_MESSAGE_MAX_LENGTH}
        value={content.welcomeMessage ?? ''} placeholder={defaultWelcomeMessage(content.name)}
        onChange={event => setContent({ ...content, welcomeMessage: event.target.value })}/>
      <span className="field-help">Write a short greeting, or leave this blank to use the default shown above. Save your draft, then publish to update your site.</span>
    </label>
    <div className="inline-actions">
      <GreetingPlayer key={`${message}:${!!content.visitorSpeaksFirst}`} text={message} disabled={busy}/>
      <button type="button" className="text-button" disabled={busy || !content.welcomeMessage}
        onClick={() => setContent({ ...content, welcomeMessage: '' })}>Use default greeting</button>
    </div>
    <p className="field-help">Preview uses an installed device voice. The final conversation voice may sound different.</p>
    <fieldset><legend>Three spoken information points</legend><p className="field-help">Optional. Choose approved information or write a concise publisher-authored point. When the welcome is spoken, these points appear as a carousel with related photos, and matching cards come forward as they are introduced. Browsing stops the automatic focus. Empty slots are skipped; all empty preserves your existing greeting.</p>
      {points.map((point, index) => <div key={index}><label className="field">Greeting point {index + 1}<select disabled={busy} value={!point ? '' : point.kind === 'custom' ? 'custom' : `${point.kind}:${point.id}`} onChange={event => changePoint(index, event.target.value === 'custom' ? { kind: 'custom', text: '' } : choices.find(choice => choice.point.kind !== 'custom' && `${choice.point.kind}:${choice.point.id}` === event.target.value)?.point ?? null)}>
        <option value="">Empty — skip this point</option><option value="custom">Write an approved point</option>{choices.map(choice => <option key={JSON.stringify(choice.point)} value={choice.point.kind === 'custom' ? 'custom' : `${choice.point.kind}:${choice.point.id}`}>{choice.label}</option>)}
      </select></label>{point?.kind === 'custom' && <label className="field">Publisher-authored point {index + 1}<input disabled={busy} maxLength={180} value={point.text} onChange={event => changePoint(index, { kind: 'custom', text: event.target.value })}/><span className="field-help">Save is your draft approval; publishing makes this information public.</span></label>}</div>)}
      <div aria-label="Spoken greeting text preview"><strong>Offline wording preview</strong><p>{message}</p><small>Voice may adjust phrasing and transitions to the selected tone, without adding facts.</small></div>
    </fieldset>
    <label className="field">Who speaks first?
      <select disabled={busy} value={content.visitorSpeaksFirst ? 'visitor' : 'assistant'}
        onChange={event => setContent({ ...content, visitorSpeaksFirst: event.target.value === 'visitor' })}>
        <option value="assistant">Assistant welcomes the visitor</option>
        <option value="visitor">Let the visitor speak first</option>
      </select>
      <span className="field-help">{content.visitorSpeaksFirst
        ? 'Your greeting is kept, but skipped when the visitor speaks first.'
        : 'Your greeting opens the conversation after the visitor starts it.'} Enable voice in Visitor conversations, then save and publish. This wording is spoken, without a greeting paragraph on the site.</span>
    </label>
  </section>;
}
