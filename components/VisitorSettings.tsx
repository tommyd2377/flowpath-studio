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
    <label className="field">Assistant purpose
      <textarea disabled={busy} rows={3} maxLength={1000} value={settings.assistantPurpose ?? ''} onChange={event => change({ assistantPurpose: event.target.value })} placeholder="Who is this site for, and what should the assistant help them discover or do?"/>
      <span className="field-help">For example: Help visitors explore this travel guide, compare destinations, and open the places and photos they ask about. Applies to chat and voice after publishing; it does not add facts or enable services.</span>
    </label>
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
        <p className="field-help">Every site uses GPT-Live for natural, continuous voice conversations.</p>
        <label className="field">End voice after inactivity<select disabled={busy} value={settings.voiceIdleTimeoutSeconds} onChange={event => change({ voiceIdleTimeoutSeconds: Number(event.target.value) as Settings['voiceIdleTimeoutSeconds'] })}>
          <option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={0}>Never</option>
        </select>
          <span className="field-help">The timer starts when neither person is speaking and no backend work is running. Ending the session stops Live usage; visitors tap the wave to start again. Never still follows the platform session limit.</span>
        </label>
        <label className="field">Daily voice task limit<input disabled={busy} type="number" min={0} max={100} step={1} value={settings.voiceDailyLimit} onChange={event => change({ voiceDailyLimit: Number(event.target.value) })}/>
          <span className="field-help">Up to 100 backend tasks per day across all visitors. Starting a conversation also counts. At the limit, visitors can continue in chat.</span>
        </label>
      </>}
      <label className="field">Daily chat message limit<input disabled={busy} type="number" min={1} max={100} step={1} value={settings.chatDailyLimit} onChange={event => change({ chatDailyLimit: Number(event.target.value) })}/>
        <span className="field-help">Up to 100 messages per day across all visitors, including chat after voice reaches its limit.</span>
      </label>
      <p className="field-help">Limits reset at midnight UTC. Attempts count even if cancelled or unsuccessful. Platform-wide limits may be reached sooner. These are usage limits; API charges depend on the model and conversation length.</p>
      <p className="field-help">Visitors type what they want to see, and the site brings the relevant details or comparisons into view. Voice shows the same information with a spoken explanation. The preview uses demo content without AI calls. Tap the wave to start a continuous conversation. You can speak while the assistant responds. Tap again to end.</p>
    </>}
  </section>;
}
