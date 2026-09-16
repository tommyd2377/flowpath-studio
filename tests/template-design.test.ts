import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_PALETTES, WEBSITE_TEMPLATES, contrastRatio, resetWebsiteStyle, selectWebsiteTemplate, websiteDesignTokens } from '@thevoice/platform-ui/site-design';
import { contentSchema, sampleContent } from '../lib/site-model';
import { siteStyle } from '../lib/site-style';
import { websiteSections, websiteHeroId } from '../lib/website-presentation';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { applyWebsiteDesign } from '../lib/website-import-model';
import { templateFixtures } from '../fixtures/template-sites';
import { interpretStructuredSource } from '../lib/source-extractors';
import { visitorDraft, DEFAULT_VISITOR_SETTINGS } from '../lib/visitor-model';
import { initialSite } from '../lib/local-store';

test('new sites have a complete template while editor loads preserve explicit assistant settings', () => {
  assert.equal(initialSite('general').draft.style?.template, 'clarity');
  const content = { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, enabled: false } };
  assert.equal(visitorDraft(content), content);
  assert.equal(visitorDraft({ ...content, visitor: undefined }).visitor?.enabled, true);
});

test('template settings survive serialization, independent updates, switching and reset', () => {
  const content = { ...sampleContent('general'), style: { ...WEBSITE_TEMPLATES.editorial.defaults, entry: 'assistant' as const, spacing: 'compact' as const, textSize: 'larger' as const, customAccent: true } };
  const canonical = JSON.stringify({ ...content, style: undefined });
  for (const template of ['showcase', 'clarity', 'editorial'] as const) {
    content.style = selectWebsiteTemplate(content.style, template) as typeof content.style;
    const saved = contentSchema.parse(JSON.parse(JSON.stringify(content)));
    assert.equal(saved.style?.entry, 'assistant'); assert.equal(saved.style?.spacing, 'compact'); assert.equal(saved.style?.textSize, 'larger'); assert.equal(saved.style?.customAccent, true);
    assert.equal(JSON.stringify({ ...saved, style: undefined }), canonical);
  }
  const reset = { ...content, style: resetWebsiteStyle(content.style) };
  assert.equal(reset.style.entry, 'assistant'); assert.equal(reset.style.customAccent, false);
  assert.equal(JSON.stringify({ ...reset, style: undefined }), canonical);
});

test('template defaults follow the design while deliberate choices including a matching default survive', () => {
  const style = { ...WEBSITE_TEMPLATES.clarity.defaults, customized: ['palette' as const], entry: 'website' as const };
  const editorial = selectWebsiteTemplate(style, 'editorial');
  assert.equal(editorial.palette, 'cloud'); assert.equal(editorial.typography, 'literary'); assert.equal(editorial.spacing, 'spacious');
  assert.equal(selectWebsiteTemplate(editorial, 'showcase').palette, 'cloud');
});

test('legacy snapshots are unchanged until explicit template selection and designs preserve opening selections', () => {
  const legacy = { ...sampleContent('general'), style: { layout: 'compact' as const, palette: 'forest' as const, entry: 'assistant' as const } };
  assert.deepEqual(contentSchema.parse(legacy), legacy); assert.equal(siteStyle(legacy)['--platform-bg'], SITE_PALETTES.forest.background);
  const chosen = selectWebsiteTemplate(legacy.style, 'editorial'); assert.equal(chosen.entry, 'assistant'); assert.equal(chosen.palette, 'linen');
  const content = { ...legacy, style: chosen, opening: { highlights: ['Publisher wording'], featuredEntityIds: ['stable'], capabilityIds: [], tone: 'warm' as const } };
  const applied = applyWebsiteDesign(content, { name: 'New name', headline: 'New headline', description: 'New description', accent: '#111111', style: { layout: 'balanced', palette: 'midnight', entry: 'website' } });
  assert.deepEqual(applied.style, chosen); assert.deepEqual(applied.opening?.featuredEntityIds, ['stable']); assert.deepEqual(applied.opening?.highlights, ['Publisher wording']);
});

test('all palette foregrounds and custom accent fallbacks maintain WCAG text contrast', () => {
  for (const [id, palette] of Object.entries(SITE_PALETTES)) {
    for (const bg of [palette.background, palette.surface]) {
      assert.ok(contrastRatio(palette.text, bg) >= 4.5, palette.label); assert.ok(contrastRatio(palette.muted, bg) >= 4.5, palette.label); assert.ok(contrastRatio(palette.accent, bg) >= 4.5, palette.label);
    }
    const content = contentSchema.parse({ ...sampleContent('general'), style: { ...WEBSITE_TEMPLATES.editorial.defaults, palette: id } });
    const tokens = siteStyle(content);
    assert.ok(contrastRatio(tokens['--platform-accent'], tokens['--platform-on-accent']) >= 4.5, `${palette.label} button`);
  }
  for (const color of ['#ffff00', '#000000', '#ffffff', '#735039']) {
    const tokens = websiteDesignTokens({ ...WEBSITE_TEMPLATES.editorial.defaults, customAccent: true }, color);
    assert.ok(contrastRatio(tokens['--platform-accent'], tokens['--platform-bg']) >= 4.5);
    assert.ok(contrastRatio(tokens['--platform-accent'], tokens['--platform-on-accent']) >= 4.5);
  }
});

test('refreshed palettes preserve saved colors until selection, including through unrelated styling and template changes', () => {
  const originals = { linen: '#f6f2ea', ink: '#191d20', cloud: '#fafbf9', sage: '#edf0e6' } as const;
  for (const palette of Object.keys(originals) as (keyof typeof originals)[]) {
    const style = { ...WEBSITE_TEMPLATES.clarity.defaults, palette, paletteVersion: undefined, customized: ['palette' as const], entry: 'assistant' as const };
    const content = contentSchema.parse({ ...sampleContent('general'), style });
    assert.equal(siteStyle(content)['--platform-bg'], originals[palette]);
    const restyled = { ...content, style: { ...style, typography: 'literary' as const, textSize: 'larger' as const } };
    assert.equal(siteStyle(restyled)['--platform-bg'], originals[palette]);
    assert.equal(siteStyle({ ...restyled, style: selectWebsiteTemplate(restyled.style, 'showcase') })['--platform-bg'], originals[palette]);
    const selected = contentSchema.parse(JSON.parse(JSON.stringify({ ...restyled, style: { ...restyled.style, paletteVersion: 2 } })));
    assert.equal(siteStyle(selected)['--platform-bg'], SITE_PALETTES[palette].background);
    assert.equal(selected.style?.entry, 'assistant');
    assert.equal(selected.style?.textSize, 'larger');
    assert.equal(siteStyle({ ...content, style: { layout: 'compact', palette } })['--platform-bg'], originals[palette]);
  }
  assert.equal(contentSchema.safeParse({ ...sampleContent('general'), style: { ...WEBSITE_TEMPLATES.clarity.defaults, paletteVersion: 3 } }).success, false);
});

test('nine content/template compositions preserve identities, full details and qualified values', () => {
  for (const fixture of templateFixtures) for (const template of Object.values(WEBSITE_TEMPLATES)) {
    const content = { ...fixture.content, style: template.defaults }, original = JSON.stringify(fixture.catalog);
    const sections = websiteSections(publishedWorkspace(content, fixture.catalog), content, fixture.catalog);
    const entries = sections.flatMap(section => section.entries);
    for (const entity of fixture.catalog.entities) assert.ok(entries.some(entry => entry.id.includes(entity.id)), entity.name);
    if (fixture.id === 'menu') { assert.equal(entries.filter(entry => entry.name === 'The shared table').length, 2); assert.match(JSON.stringify(entries), /72 hours/); }
    if (fixture.id === 'guide') assert.ok(entries.some(entry => entry.blocks?.some(block => block.text.length > 1500)));
    assert.equal(JSON.stringify(fixture.catalog), original);
    assert.equal(websiteHeroId(content, { schemaVersion: 1, id: 'media', assets: [{ id: 'menu-screenshot', width: 300, height: 400, caption: 'Menu', alt: 'Menu' }], albums: [], associations: [] }), undefined);
  }
});

test('qualified menu prices stay source wording rather than false exact money amounts', () => {
  const catalog = interpretStructuredSource('menu.csv', { format: 'csv', text: 'ID,Name,Price [USD]\nsupper,Shared supper,from 18 per person - minimum 6 - 48 hours notice' })!;
  assert.equal(catalog.attributes[0].type, 'text'); assert.match(String(catalog.entities[0].attributes['price-usd']), /from 18 per person/);
  assert.throws(() => interpretStructuredSource('empty.csv', { format: 'csv', text: 'ID,Name\n' }), /no item rows|at least|between 1 and 100/i);
});
