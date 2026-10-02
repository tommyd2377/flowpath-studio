import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebsiteSection } from '@thevoice/platform-ui';
import { validateMediaLibrary } from '@thevoice/platform-ui/media';
import { WEBSITE_TEMPLATES } from '@thevoice/platform-ui/site-design';
import { WEBSITE_COMPOSITION_MAX_SECTIONS, websiteCompositionPlanSchema } from '@thevoice/platform-ui/website-composition';
import { templateFixtures } from '../fixtures/template-sites';
import { applyWebsiteCompositionSections, buildWebsiteCompositionManifest, eligibleWebsiteHeroAssets, proposeWebsiteComposition, resolveWebsiteComposition, validateWebsiteCompositionPlan, websiteCompositionSnapshot } from '../lib/website-composition';
import { publicationContent } from '../lib/site-opening';
import { hasChanges, sampleContent, type Site } from '../lib/site-model';
import { compositionMatchesContent } from '../lib/website-composition-snapshot';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { websiteSections } from '../lib/website-presentation';

const fixture = () => structuredClone(templateFixtures[1]);
const extra = (count: number): WebsiteSection[] => Array.from({ length: count }, (_, index) => ({ id: `extra-${index}`, title: `Approved destination ${index}`, kind: 'collection', entries: [{ id: `entry-${index}`, name: `Item ${index}`, body: 'Includes the original qualification.' }] }));

test('offline composition leads with services, shortens navigation and preserves every original record and qualification', () => {
  const { content, catalog } = fixture(), before = structuredClone({ content, catalog });
  const sections = websiteSections(publishedWorkspace(content, catalog), content, catalog);
  assert.equal(sections[0].id, 'introduction');
  const manifest = buildWebsiteCompositionManifest(content, catalog), plan = proposeWebsiteComposition(manifest);
  assert.equal(plan.sectionOrder[0], 'collection-services');
  assert.deepEqual(plan.primaryAction, { actionId: 'section:collection-services', label: 'Services' });
  assert.equal(plan.navigation.find(item => item.sectionId === 'collection-services')?.label, 'Services');
  const applied = applyWebsiteCompositionSections(sections, plan);
  assert.equal(applied[0].title, 'Ways we can work together');
  assert.equal(applied[0].navLabel, 'Services');
  assert.equal(applied[0].entries, sections.find(section => section.id === applied[0].id)?.entries);
  assert.deepEqual([...applied].sort((a, b) => a.id.localeCompare(b.id)).map(section => section.entries), [...sections].sort((a, b) => a.id.localeCompare(b.id)).map(section => section.entries));
  assert.match(JSON.stringify(applied), /scope agreed after an initial conversation/);
  assert.deepEqual({ content, catalog }, before);
  assert.deepEqual(proposeWebsiteComposition(manifest), plan, 'the offline proposal is deterministic');
});

test('all saved design choices remain exact, including legacy palette, custom accent, motion and opening', () => {
  const { content, catalog } = fixture();
  content.style = { ...WEBSITE_TEMPLATES.editorial.defaults, palette: 'linen', paletteVersion: undefined, customAccent: true, textSize: 'larger', websiteMotion: 'off', entry: 'assistant', customized: ['palette', 'customAccent', 'websiteMotion'] };
  const manifest = buildWebsiteCompositionManifest(content, catalog), plan = proposeWebsiteComposition(manifest);
  assert.deepEqual(plan.style, content.style);
  for (const style of [{ ...plan.style, paletteVersion: 2 }, { ...plan.style, entry: 'website' }, { ...plan.style, websiteMotion: 'expressive' }, { ...plan.style, customAccent: false }]) {
    assert.throws(() => validateWebsiteCompositionPlan({ ...plan, style }, manifest), /saved publisher styling/);
  }
  assert.deepEqual(resolveWebsiteComposition({ ...content, websiteComposition: plan }, catalog)?.style, content.style);
});

test('schema and references reject code, invented destinations, duplicate or dropped sections, navigation changes and false action labels', () => {
  const { content, catalog } = fixture(), manifest = buildWebsiteCompositionManifest(content, catalog), plan = proposeWebsiteComposition(manifest);
  const cases = [
    { ...plan, html: '<script>alert(1)</script>' },
    { ...plan, primaryAction: { actionId: 'checkout', label: 'Buy now' } },
    { ...plan, primaryAction: { actionId: 'contact', label: 'Book instantly' } },
    { ...plan, primaryAction: { actionId: 'contact', label: 'Contact', url: 'https://unapproved.example' } },
    { ...plan, sectionOrder: plan.sectionOrder.slice(1) },
    { ...plan, sectionOrder: plan.sectionOrder.map(() => plan.sectionOrder[0]) },
    { ...plan, sectionOrder: ['missing', ...plan.sectionOrder.slice(1)] },
    { ...plan, navigation: plan.navigation.slice(1) },
    { ...plan, navigation: plan.navigation.map(() => plan.navigation[0]) },
    { ...plan, navigation: plan.navigation.map(item => ({ ...item, label: 'Guaranteed appointments' })) },
    { ...plan, navigation: [{ ...plan.navigation[0], label: '<b>Services</b>' }, ...plan.navigation.slice(1)] },
  ];
  for (const candidate of cases) assert.throws(() => validateWebsiteCompositionPlan(candidate, manifest));
  assert.equal(websiteCompositionPlanSchema.safeParse({ ...plan, version: 2 }).success, false);
});

test('binding survives Apply and Publish but rejects content edits, new revisions and altered opening choices', () => {
  const { content, catalog } = fixture();
  const plan = proposeWebsiteComposition(buildWebsiteCompositionManifest(content, catalog));
  const applied = { ...content, style: plan.style, websiteComposition: plan };
  assert.deepEqual(websiteCompositionSnapshot(applied), websiteCompositionSnapshot(content));
  assert.ok(resolveWebsiteComposition(applied, catalog));
  assert.ok(resolveWebsiteComposition(publicationContent(applied), catalog));
  const changed = [
    { ...applied, description: `${applied.description} New qualification.` },
    { ...applied, sections: applied.sections.map(section => ({ ...section, body: 'Reimported body.' })) },
    { ...applied, knowledgeRevisionId: 'new-knowledge-revision' },
    { ...applied, mediaRevisionId: 'new-media-revision' },
    { ...applied, catalogPublicationId: 'new-catalog-publication' },
    { ...applied, opening: { highlights: [], featuredEntityIds: [], capabilityIds: [], initialSections: ['approach'], tone: 'warm' as const } },
    { ...applied, style: { ...plan.style, textSize: 'larger' as const } },
  ];
  for (const next of changed) assert.equal(resolveWebsiteComposition(next, catalog), null);
});

test('review notes and object key ordering are excluded from the content binding', () => {
  const { content, catalog } = fixture(), plan = proposeWebsiteComposition(buildWebsiteCompositionManifest(content, catalog));
  const notesChanged = { ...content, websiteComposition: { ...plan, reviewNotes: ['Publisher review only.'] } };
  assert.deepEqual(websiteCompositionSnapshot(notesChanged), websiteCompositionSnapshot(content));
  const reordered = Object.fromEntries(Object.entries(content).reverse()) as typeof content;
  assert.deepEqual(websiteCompositionSnapshot(reordered), websiteCompositionSnapshot(content));
});

test('publishing strips private review notes without leaving an unchanged site dirty', () => {
  const { content, catalog } = fixture(), plan = proposeWebsiteComposition(buildWebsiteCompositionManifest(content, catalog));
  const draft = { ...content, style: plan.style, websiteComposition: plan };
  const site: Site = { id: 'site', slug: 'synthetic', ownerId: 'owner', template: 'voice-v1', revision: 1, draft, published: null, publishedAt: null, history: [], files: [], messages: [] };
  assert.equal(hasChanges(site), true, 'a site that has never been published still needs publication');
  site.published = publicationContent(site.draft);
  assert.deepEqual(site.published.websiteComposition?.reviewNotes, []);
  assert.ok(site.draft.websiteComposition?.reviewNotes.length, 'the publisher keeps the review notes in the draft');
  assert.equal(hasChanges(site), false);
  site.draft = { ...site.draft, description: `${site.draft.description} New information.` };
  assert.equal(hasChanges(site), true, 'real content changes still require publication');
});

test('publishing omits stale composition and reports a clean draft while retaining its private review history', () => {
  const { content, catalog } = fixture(), plan = proposeWebsiteComposition(buildWebsiteCompositionManifest(content, catalog));
  const draft = { ...content, style: plan.style, websiteComposition: plan, description: `${content.description} Updated after layout review.` };
  const site: Site = { id: 'site', slug: 'synthetic', ownerId: 'owner', template: 'voice-v1', revision: 1, draft, published: publicationContent(draft), publishedAt: null, history: [], files: [], messages: [] };
  assert.equal(compositionMatchesContent(draft), false);
  assert.equal(site.published?.websiteComposition, undefined);
  assert.equal(site.draft.websiteComposition, plan, 'publication does not mutate the saved draft or review history');
  assert.equal(hasChanges(site), false);
  site.draft = { ...site.draft, contact: 'new-contact@example.test' };
  assert.equal(hasChanges(site), true);
  const restyled = { ...content, websiteComposition: plan, style: { ...plan.style, websiteMotion: 'off' as const } };
  assert.equal(compositionMatchesContent(restyled), false);
  assert.equal(publicationContent(restyled).websiteComposition, undefined);
});

test('compact binding includes long source tails and stays well below the save-request budget', () => {
  const content = sampleContent('general');
  content.sections = Array.from({ length: 12 }, (_, index) => ({ id: `section-${index}`, title: `Section ${index}`, body: 'x'.repeat(2499) + 'A' }));
  const before = websiteCompositionSnapshot(content);
  assert.ok(before.contentBinding.length < 100);
  content.sections[11].body = 'x'.repeat(2499) + 'B';
  assert.notEqual(websiteCompositionSnapshot(content).contentBinding, before.contentBinding, 'same-length content changes at the final character invalidate the plan');
});

test('hero eligibility excludes logos, evidence-only uploads and album-only images; example labels and credit survive', () => {
  const content = { ...sampleContent('general'), logoAssetId: 'logo', mediaRevisionId: 'reviewed-media' };
  const media = validateMediaLibrary({ schemaVersion: 1, id: 'reviewed-media', assets: ['logo', 'evidence', 'album', 'opening'].map(id => ({ id, width: 1600, height: 1000, caption: `Reviewed ${id}`, alt: `Image ${id}`, credit: 'Approved credit' })),
    albums: [{ id: 'reviewed-album', title: 'Our work', description: '', assetIds: ['album', 'opening'] }],
    associations: [{ id: 'lead', assetId: 'opening', targetType: 'site', primary: true, role: 'example' }, { id: 'logo-lead', assetId: 'logo', targetType: 'site', role: 'depicts' }] });
  const before = structuredClone(media), manifest = buildWebsiteCompositionManifest(content, null, media), plan = proposeWebsiteComposition(manifest);
  assert.deepEqual(eligibleWebsiteHeroAssets(content, media).map(asset => asset.id), ['opening']);
  assert.equal(plan.heroAssetId, 'opening');
  assert.equal(manifest.eligibleHeroAssets[0].example, true);
  assert.equal(manifest.eligibleHeroAssets[0].credit, 'Approved credit');
  for (const heroAssetId of ['logo', 'evidence', 'album', 'missing']) assert.throws(() => validateWebsiteCompositionPlan({ ...plan, heroAssetId }, manifest), /reviewed opening photo/);
  assert.deepEqual(media, before);
  assert.match(plan.reviewNotes.join(' '), /cannot establish image quality or subject identity/);
});

test('missing or weak unselected opening imagery produces a text introduction, never a fabricated hero', () => {
  const content = sampleContent('general');
  const media = validateMediaLibrary({ schemaVersion: 1, id: 'photos', assets: [{ id: 'tiny', width: 100, height: 100, caption: 'Small image', alt: '' }], albums: [], associations: [{ id: 'site', assetId: 'tiny', targetType: 'site', role: 'depicts' }] });
  assert.equal(proposeWebsiteComposition(buildWebsiteCompositionManifest(content)).heroAssetId, null);
  assert.equal(proposeWebsiteComposition(buildWebsiteCompositionManifest(content, null, media)).heroAssetId, null);
});

test('more than twelve eligible sections are preserved; exceeding the planning cap keeps complete fallback content', () => {
  const content = sampleContent('general'), sections = extra(20), manifest = buildWebsiteCompositionManifest(content, null, null, sections);
  const plan = proposeWebsiteComposition(manifest);
  assert.equal(plan.sectionOrder.length, 20);
  assert.equal(applyWebsiteCompositionSections(sections, plan).length, 20);
  const tooMany = extra(WEBSITE_COMPOSITION_MAX_SECTIONS + 1), oversized = buildWebsiteCompositionManifest(content, null, null, tooMany);
  assert.equal(oversized.sections.length, tooMany.length, 'even the rejected manifest identifies every section');
  assert.match(oversized.guidance.join(' '), /no sections have been omitted/);
  assert.throws(() => proposeWebsiteComposition(oversized), /planning limit/);
  assert.equal(applyWebsiteCompositionSections(tooMany, plan), tooMany);
});

test('contact and assistant are available only when explicitly supported; no available action is also valid', () => {
  const content = sampleContent('general');
  assert.equal(proposeWebsiteComposition(buildWebsiteCompositionManifest(content)).primaryAction, null);
  assert.deepEqual(proposeWebsiteComposition(buildWebsiteCompositionManifest({ ...content, contact: 'hello@example.test' })).primaryAction, { actionId: 'contact', label: 'Contact' });
  const enabled = { ...content, visitor: { enabled: true, mode: 'chat' as const, voiceTier: 'standard' as const, chatDailyLimit: 25, voiceDailyLimit: 0 } };
  assert.deepEqual(proposeWebsiteComposition(buildWebsiteCompositionManifest(enabled)).primaryAction, { actionId: 'assistant', label: 'Ask a question' });
  const disabled = buildWebsiteCompositionManifest({ ...enabled, visitor: { ...enabled.visitor, enabled: false } });
  assert.equal(disabled.actions.some(action => action.kind === 'assistant'), false);
});

test('manifest reports representative-text omissions without allowing a plan to alter canonical content', () => {
  const content = sampleContent('general'), sections = extra(1);
  sections[0].title = 'A long expressive title that would overwhelm compact navigation';
  sections[0].entries = Array.from({ length: 4 }, (_, index) => ({ id: `long-${index}`, name: `Long item ${index}`, body: 'Qualified material. '.repeat(50) }));
  const manifest = buildWebsiteCompositionManifest(content, null, null, sections), section = manifest.sections[0];
  assert.equal(section.omittedEntries, 2);
  assert.ok(section.omittedTextCharacters > 0);
  assert.ok(section.labels[0].length <= 32);
  assert.equal(section.sampleEntries.length, 2);
  const plan = proposeWebsiteComposition(manifest);
  assert.equal(applyWebsiteCompositionSections(sections, plan)[0].entries, sections[0].entries);
});
