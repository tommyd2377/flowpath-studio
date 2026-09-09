'use client';

import { defaultWelcomeMessage, getWelcomeMessage, WELCOME_MESSAGE_MAX_LENGTH } from '@/lib/site-greeting';
import type { SiteContent } from '@/lib/site-model';
import GreetingPlayer from './GreetingPlayer';

export default function GreetingSettings({ content, setContent, busy }: {
  content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean;
}) {
  const message = getWelcomeMessage(content);
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
