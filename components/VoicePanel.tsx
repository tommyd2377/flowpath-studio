'use client';

import type { CSSProperties } from 'react';
import { AudioLines, Check } from 'lucide-react';
import { VOICE_COLORS, voiceDesignTokens, type VoiceColor } from '@thevoice/platform-ui/voice-design';
import type { SiteContent } from '@/lib/site-model';
import { visitorDraft, visitorSettings } from '@/lib/visitor-model';
import { CONVERSATION_OPTIONS, CONVERSATION_PRESETS, LIVE_VOICE_CHOICES, VOICE_LANGUAGES, conversationSettings, type ConversationSettings } from '@/lib/voice-settings';
import GreetingSettings from './GreetingSettings';
import VisitorSettings from './VisitorSettings';
import ExploreSettings from './ExploreSettings';
import Waveform from './Waveform';
import styles from './VoicePanel.module.css';

export default function VoicePanel({ siteId, content, setContent, busy, unsaved, save }: {
  siteId: string; content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean; unsaved: boolean; save: () => void;
}) {
  const settings = conversationSettings(content);
  const openingExperience = visitorSettings(content).openingExperience;
  const update = (patch: Partial<ConversationSettings>) => setContent({ ...content, visitor: { ...visitorSettings(visitorDraft(content)), conversation: { ...content.visitor?.conversation, ...patch } } });
  const colorTokens = voiceDesignTokens(settings.color, '#f7f7f8', '#ffffff');
  const activePreset = Object.entries(CONVERSATION_PRESETS).find(([, preset]) => Object.entries(preset.settings).every(([key, value]) => settings[key as keyof ConversationSettings] === value))?.[0];
  return <div className={`settings-panel ${styles.panel}`}>
    <div className="panel-heading"><span className="eyebrow">A voice of your own</span><h2>The Voice</h2><p>Choose how your assistant sounds, listens and responds. Make it feel at home on your site.</p></div>
    <div className={styles.model}><AudioLines size={22}/><div><strong>GPT Live 1</strong><span>One model. Your personality.</span></div><span className="badge">Voice model</span></div>
    <p className="field-help">Settings belong to this site and its published address. Save your draft, then Publish to use them with visitors. Switching sites keeps each assistant’s choices separate.</p>

    <section aria-label="Visitor arrival"><div className="section-heading"><h3>Visitor arrival</h3><span>First view</span></div>
      <p className="field-help">Choose what visitors see before they start a conversation.</p>
      <div className={styles.openingChoices} role="group" aria-label="Opening experience">
        <button type="button" disabled={busy} aria-pressed={openingExperience === 'website'} onClick={() => setContent({ ...content, visitor: { ...visitorSettings(visitorDraft(content)), openingExperience: 'website' } })}><strong>Website first</strong><span>Open your regular website with conversation controls ready.</span></button>
        <button type="button" disabled={busy} aria-pressed={openingExperience === 'voice'} onClick={() => setContent({ ...content, visitor: { ...visitorSettings(visitorDraft(content)), openingExperience: 'voice' } })}><strong>Voice invitation</strong><span>Welcome visitors with your logo and a prominent waveform.</span></button>
      </div>
      <p className="field-help">The voice invitation includes a Browse website button. It appears only when voice is enabled, and never starts a conversation automatically.</p>
    </section>

    <section aria-label="Assistant role"><div className="section-heading"><h3>Assistant role</h3><span>Voice & chat</span></div>
      <p className="field-help">Define who your assistant is, who it helps, and what it helps them do throughout the conversation.</p>
      <label className="field">Role and identity<textarea disabled={busy} rows={3} maxLength={1000} value={content.visitor?.assistantPurpose ?? ''} onChange={event => setContent({ ...content, visitor: { ...visitorSettings(visitorDraft(content)), assistantPurpose: event.target.value } })} placeholder="For example: Be a knowledgeable travel guide. Help curious visitors understand the places in this guide and compare their options."/>
        <span className="field-help">Leave blank for a helpful website guide. This role applies to both voice and chat after publishing. It does not add business facts, credentials or services.</span>
      </label>
      <p className="field-help">Your welcome words and up to three opening topics are separate. Set those in Conversation opening below.</p>
    </section>
    <GreetingSettings key={siteId} siteId={siteId} content={content} setContent={setContent} busy={busy}/>

    <section aria-label="Voice and language"><div className="section-heading"><h3>Voice & language</h3></div>
      <label className="field">Speaking voice<select disabled={busy} value={settings.voice} onChange={event => update({ voice: event.target.value as ConversationSettings['voice'] })}>{Object.entries(LIVE_VOICE_CHOICES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><span className="field-help">Choose from documented GPT Live voices. Regional descriptions are influences, not guaranteed accents. Voice changes apply to the next conversation after publishing.</span></label>
      <label className="field">Conversation language<select disabled={busy} value={settings.language} onChange={event => update({ language: event.target.value as ConversationSettings['language'] })}>{Object.entries(VOICE_LANGUAGES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><span className="field-help">The visitor can request another language. With “Follow the visitor,” the opening uses your welcome message’s language.</span></label>
    </section>

    <section aria-label="Conversation personality"><div className="section-heading"><h3>Personality</h3><span>Voice & chat</span></div><p className="field-help">Start with a preset, then adjust any detail. Presets keep your voice, language, color, greeting and usage limits.</p>
      <div className={styles.presets}>{Object.entries(CONVERSATION_PRESETS).map(([id, preset]) => <button type="button" disabled={busy} aria-pressed={activePreset === id} key={id} onClick={() => update(preset.settings)}><strong>{preset.name}</strong><span>{preset.description}</span></button>)}</div>
      <div className={styles.fields}>{(['verbosity', 'warmth', 'formality', 'energy'] as const).map(key => <label className="field" key={key}>{CONVERSATION_OPTIONS[key].label}<select disabled={busy} value={settings[key]} onChange={event => update({ [key]: event.target.value })}>{Object.entries(CONVERSATION_OPTIONS[key].choices).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>)}</div>
      <details className={styles.details}><summary>Conversation habits & pronunciation</summary><div className={styles.fields}>{(['pace', 'backchannels', 'followUp', 'smallTalk', 'listening'] as const).map(key => <label className="field" key={key}>{CONVERSATION_OPTIONS[key].label}<select disabled={busy} value={settings[key]} onChange={event => update({ [key]: event.target.value })}>{Object.entries(CONVERSATION_OPTIONS[key].choices).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>)}</div>
        <label className="field">Pronunciation hints<textarea disabled={busy} rows={3} maxLength={500} value={settings.pronunciation} onChange={event => update({ pronunciation: event.target.value })} placeholder="For example: pronounce Acme as ACK-mee."/><span className="field-help">Names and phonetic spellings only. These hints guide speech; they do not add facts to your site.</span></label>
      </details>
      <p className="field-help">Personality, language and pacing guide the model; exact delivery can vary. Visitors can always interrupt. Quiet listening removes filler and unsolicited follow-ups, while still allowing necessary clarification.</p>
    </section>

    <section aria-label="Voice color"><div className="section-heading"><h3>Voice color</h3><span>Waveform & chat</span></div><p className="field-help">One quiet color, separate from your website palette. Shades adapt for readable contrast.</p>
      <div className={styles.colors}>{Object.entries(VOICE_COLORS).map(([id, color]) => <button type="button" disabled={busy} aria-label={`${color.name} voice color`} aria-pressed={content.visitor?.conversation?.color === id} key={id} onClick={() => update({ color: id as VoiceColor })}><span className={styles.swatch} style={{ background: color.ink }} aria-hidden="true">{content.visitor?.conversation?.color === id && <Check size={14}/>}</span><span>{color.name}</span></button>)}</div>
      {!content.visitor?.conversation?.color && <p className="field-help">Your existing appearance is retained. Choose a color to give voice and chat their own look. Amber is the default for new sites.</p>}
      <div className={styles.colorPreview} style={colorTokens as CSSProperties} aria-label="Voice color illustration"><div className={styles.wave}><Waveform phase="idle" inputAnalyser={null} outputAnalyser={null} color={colorTokens['--voice-accent']}/></div><div className={styles.bubble}><span>What would you like to explore?</span><AudioLines size={17}/></div><small>Color illustration · no audio or AI calls</small></div>
    </section>

    <VisitorSettings content={content} setContent={setContent} busy={busy}/>
    <ExploreSettings content={content} setContent={setContent} busy={busy}/>
    <div className="save-bar"><span>{unsaved ? 'Save these choices, then Publish when ready.' : 'Your draft is up to date.'}</span><button className="button primary" disabled={busy || !unsaved} onClick={save}><Check size={16}/>Save draft</button></div>
  </div>;
}
