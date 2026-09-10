'use client';

import type { SiteContent } from '@/lib/site-model';
import { visitorSettings, visitorDraft, type VisitorSettings as Settings } from '@/lib/visitor-model';

export default function VisitorSettings({ content, setContent, busy }: {
  content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean;
}) {
  const settings = visitorSettings(visitorDraft(content));
  const change = (patch: Partial<Settings>) => setContent({ ...content, visitor: { ...settings, ...patch } });
  return <section aria-label="Visitor conversations">
    <div className="section-heading"><h3>Visitor conversations</h3></div>
    <label className="field">How visitors interact
      <select disabled={busy} value={settings.mode} onChange={event => {
        const mode = event.target.value;
        if (mode === 'chat' || mode === 'voice' || mode === 'both') change({ enabled: true, mode });
      }}>
        <option value="voice">Voice only</option><option value="chat">Chat only</option><option value="both">Chat and voice</option>
      </select>
      <span className="field-help">Voice only is the default. Save and publish to update your site. In voice-only mode, visitors see chat after the voice limit is reached. Chat and voice lets them switch from the start.</span>
    </label>
    {settings.enabled && <>
      {settings.mode !== 'chat' && <>
        <label className="field">Voice quality<select disabled={busy} value={settings.voiceTier} onChange={event => change({ voiceTier: event.target.value as Settings['voiceTier'] })}>
          <option value="standard">Standard — lower cost</option><option value="premium">Premium — more capable</option>
        </select></label>
        <label className="field">Daily voice reply limit<input disabled={busy} type="number" min={0} max={100} step={1} value={settings.voiceDailyLimit} onChange={event => change({ voiceDailyLimit: Number(event.target.value) })}/>
          <span className="field-help">Up to 100 replies per day across all visitors. The opening greeting counts as a reply. At the limit, visitors can continue in chat.</span>
        </label>
      </>}
      <label className="field">Daily chat message limit<input disabled={busy} type="number" min={1} max={100} step={1} value={settings.chatDailyLimit} onChange={event => change({ chatDailyLimit: Number(event.target.value) })}/>
        <span className="field-help">Up to 100 messages per day across all visitors, including chat after voice reaches its limit.</span>
      </label>
      <p className="field-help">Limits reset at midnight UTC. Attempts count even if cancelled or unsuccessful. Platform-wide limits may be reached sooner. These are usage limits; API charges depend on the model and conversation length.</p>
      <p className="field-help">Visitors type what they want to see, and the site brings the relevant details or comparisons into view. Voice shows the same information with a spoken explanation. The preview uses demo content without AI calls. Voice uses short turns: tap to speak, then tap to send, with up to 20 seconds per recording.</p>
    </>}
  </section>;
}
