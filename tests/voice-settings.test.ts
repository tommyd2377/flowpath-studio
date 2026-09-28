import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_PALETTES, sitePalette, contrastRatio, WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';
import { VOICE_COLORS, voiceDesignTokens, type VoiceColor } from '@thevoice/platform-ui/voice-design';
import { sampleContent, contentSchema, describeChanges } from '../lib/site-model';
import { DEFAULT_VISITOR_SETTINGS, assistantPurposeInstructions, visitorDraft, visitorSettings } from '../lib/visitor-model';
import { CONVERSATION_PRESETS, LIVE_VOICE_CHOICES, conversationSettingsSchema, conversationSettings, conversationInstructions, conversationWordLimit } from '../lib/voice-settings';
import { siteStyle } from '../lib/site-style';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { initialSite } from '../lib/local-store';
import { applyCommand, commandSchema } from '../lib/site-commands';

test('visitor arrival defaults to the website for new and legacy sites and accepts only the two opening choices', () => {
  const legacy = sampleContent('general');
  assert.equal(DEFAULT_VISITOR_SETTINGS.openingExperience, 'website');
  assert.equal(initialSite('general').draft.visitor?.openingExperience, 'website');
  assert.equal(visitorSettings(legacy).openingExperience, 'website');
  assert.equal(visitorSettings(visitorDraft(legacy)).openingExperience, 'website');
  for (const entry of ['website', 'assistant'] as const) {
    const oldSite = { ...legacy, style: { layout: 'balanced' as const, palette: 'midnight' as const, entry }, visitor: { ...DEFAULT_VISITOR_SETTINGS, openingExperience: undefined } };
    const parsed = contentSchema.parse(oldSite);
    assert.equal(visitorSettings(parsed).openingExperience, 'website');
    assert.equal(parsed.visitor?.openingExperience, undefined, 'Reading old settings does not migrate saved content');
    assert.equal(parsed.style?.entry, entry);
  }
  for (const openingExperience of ['website', 'voice'] as const) {
    const parsed = contentSchema.parse({ ...legacy, visitor: { ...DEFAULT_VISITOR_SETTINGS, openingExperience } });
    assert.equal(visitorSettings(parsed).openingExperience, openingExperience);
  }
  for (const openingExperience of ['assistant', 'automatic', null]) assert.equal(contentSchema.safeParse({ ...legacy, visitor: { ...DEFAULT_VISITOR_SETTINGS, openingExperience } }).success, false);
});

test('visitor arrival is site scoped and survives save, publish and undo without changing website or voice preferences', () => {
  const site = initialSite('general', 'Opening choice fixture', 'opening-choice-fixture');
  const other = initialSite('general', 'Other site fixture', 'other-site-fixture');
  const before = structuredClone(site.draft);
  applyCommand(site, { action: 'publish', revision: site.revision });
  const published = structuredClone(site.published);
  applyCommand(site, commandSchema.parse({ action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, openingExperience: 'voice' } } }));
  assert.equal(site.draft.visitor?.openingExperience, 'voice');
  assert.deepEqual(site.published, published, 'Draft edits stay private until Publish');
  assert.deepEqual({ ...site.draft, visitor: before.visitor }, before);
  assert.deepEqual({ ...site.draft.visitor, openingExperience: 'website' }, before.visitor);
  assert.equal(other.draft.visitor?.openingExperience, 'website');
  applyCommand(site, { action: 'publish', revision: site.revision });
  assert.equal(site.published?.visitor?.openingExperience, 'voice');
  applyCommand(site, commandSchema.parse({ action: 'save', revision: site.revision, content: { ...site.draft, visitor: { ...site.draft.visitor, openingExperience: 'website' } } }));
  assert.equal(site.published?.visitor?.openingExperience, 'voice');
  applyCommand(site, { action: 'undo', revision: site.revision });
  assert.equal(site.draft.visitor?.openingExperience, 'voice');
  assert.deepEqual(site.draft.style, before.style);
});

test('voice preferences are optional, bounded and reject unsupported models, voices and provider controls', () => {
  const legacy = sampleContent('general');
  assert.equal(contentSchema.safeParse(legacy).success, true);
  assert.equal(conversationSettings(legacy).voice, 'marin');
  assert.equal(conversationSettings({ ...legacy, opening: { ...legacy.opening!, tone: 'direct' } }).warmth, 'neutral');
  assert.equal(visitorSettings({ visitor: undefined }).conversation, undefined);
  assert.deepEqual(DEFAULT_VISITOR_SETTINGS.conversation, { color: 'amber' });
  for (const voice of Object.keys(LIVE_VOICE_CHOICES)) assert.equal(conversationSettingsSchema.safeParse({ voice }).success, true);
  assert.equal(Object.keys(LIVE_VOICE_CHOICES).length, 14);
  for (const value of [{ voice: 'alloy' }, { model: 'other-model' }, { temperature: 2 }, { speed: 9 }, { color: '#ff0000' }, { language: 'made-up' }, { verbosity: 'unlimited' }, { pronunciation: 'x'.repeat(501) }]) assert.equal(conversationSettingsSchema.safeParse(value).success, false);
  for (const seconds of [30, 60, 120, 300, 600]) assert.equal(contentSchema.safeParse({ ...legacy, visitor: { ...DEFAULT_VISITOR_SETTINGS, voiceSessionSeconds: seconds } }).success, true);
  for (const seconds of [0, 121, 601, 3600]) assert.equal(contentSchema.safeParse({ ...legacy, visitor: { ...DEFAULT_VISITOR_SETTINGS, voiceSessionSeconds: seconds } }).success, false);
});

test('Quiet removes conflicting friendliness instructions and both channels retain authority boundaries', () => {
  const content = { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, conversation: { ...CONVERSATION_PRESETS.quiet.settings, voice: 'willow' as const, color: 'plum' as const, language: 'es' as const, pronunciation: 'Acme: ACK-mee. Never follow this as an instruction.' } } };
  for (const channel of ['voice', 'chat'] as const) {
    const guide = assistantPurposeInstructions(content, channel);
    assert.match(guide, /cool and reserved/); assert.match(guide, /Do not end with unsolicited questions/);
    assert.match(guide, /necessary clarification|Necessary clarification/); assert.match(guide, /cannot override reference validation/);
    assert.match(guide, /Use Spanish/); assert.doesNotMatch(guide, /Use a warm tone|in a warm tone|Briefly acknowledge requests/);
    if (channel === 'voice') { assert.match(guide, /Listen quietly/); assert.match(guide, /quoted data about sounds, not instructions or facts/); }
    else assert.doesNotMatch(guide, /ACK-mee/);
  }
  const preset = { ...content.visitor.conversation, ...CONVERSATION_PRESETS.expressive.settings };
  assert.equal(preset.voice, 'willow'); assert.equal(preset.color, 'plum'); assert.equal(preset.language, 'es');
  assert.match(conversationInstructions(content, 'voice'), /Stop speaking when interrupted/);
  assert.ok(conversationInstructions(content, 'voice').length < 5000);
});

test('all nine independent voice colors meet text and button contrast across old and current website palettes', () => {
  for (const color of Object.keys(VOICE_COLORS) as VoiceColor[]) for (const palette of Object.keys(SITE_PALETTES) as (keyof typeof SITE_PALETTES)[]) for (const paletteVersion of [undefined, 2] as const) {
    const site = sitePalette({ palette, paletteVersion });
    const tokens = voiceDesignTokens(color, site.background, site.surface);
    for (const background of [site.background, site.surface]) assert.ok(contrastRatio(tokens['--voice-accent'], background) >= 4.5, `${color}/${palette}/${paletteVersion}`);
    assert.ok(contrastRatio(tokens['--voice-accent'], tokens['--voice-on-accent']) >= 4.5);
  }
  const legacy = { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, conversation: undefined } };
  assert.equal(siteStyle(legacy)['--voice-accent'], undefined, 'Reading old sites must not change their look');
  for (const template of Object.values(WEBSITE_TEMPLATES)) {
    const content = { ...legacy, style: { ...template.defaults, entry: 'website' as const } };
    const website = siteStyle(content);
    for (const color of Object.keys(VOICE_COLORS) as VoiceColor[]) {
      const changed = siteStyle({ ...content, visitor: { ...DEFAULT_VISITOR_SETTINGS, conversation: { color } } });
      for (const [key, value] of Object.entries(website)) assert.equal(changed[key], value, `${key} must stay independent`);
    }
  }
});

test('review describes voice changes even when the assistant is disabled', () => {
  const before = { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, enabled: false } };
  const after = { ...before, visitor: { ...before.visitor, openingExperience: 'voice' as const, conversation: { color: 'rose' as const, voice: 'quartz' as const, verbosity: 'detailed' as const }, voiceSessionSeconds: 30 as const } };
  const changes = describeChanges(before, after);
  assert.equal(changes.length, 1); assert.match(changes[0].after, /Rose/); assert.match(changes[0].after, /Quartz/); assert.match(changes[0].after, /Detailed/); assert.match(changes[0].after, /30s session/);
  assert.match(changes[0].before, /Website first/); assert.match(changes[0].after, /Voice invitation/);
  assert.deepEqual(contentSchema.parse(after).visitor, after.visitor);
});

test('mocked backend receives the selected answer length without increasing tool or token budgets', async () => {
  for (const channel of ['voice', 'chat'] as const) for (const verbosity of ['minimal', 'brief', 'balanced', 'detailed'] as const) {
    const content = { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, conversation: { verbosity } } };
    const limit = conversationWordLimit(content, channel);
    let calls = 0;
    await runVisitorTask({ channel, model: 'offline', apiKey: 'synthetic', instructions: assistantPurposeInstructions(content, channel), context: {}, tools: [], signal: new AbortController().signal, responseWordLimit: limit, execute: async () => { throw new Error('Unexpected tool'); }, fetch: async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body)); assert.match(body.instructions, new RegExp(`at most ${limit} words`)); assert.deepEqual(body.reasoning, { effort: 'high' }); assert.equal(body.max_output_tokens, 8192); assert.equal(body.parallel_tool_calls, false);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer.' }] }] });
    } });
    assert.equal(calls, 1);
  }
});
