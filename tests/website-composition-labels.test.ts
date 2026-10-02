import test from 'node:test';
import assert from 'node:assert/strict';
import { templateFixtures } from '../fixtures/template-sites';
import { applyWebsiteCompositionSections, buildWebsiteCompositionManifest, proposeWebsiteComposition, validateWebsiteCompositionPlan, websiteCompositionSnapshot } from '../lib/website-composition';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { websiteSections } from '../lib/website-presentation';

const sectionId = 'collection-services', actionId = `section:${sectionId}`;
function fixture(title: string) {
  const value = structuredClone(templateFixtures[1]);
  value.catalog.collections[0].name = title;
  return value;
}

test('explicit collection headings register useful navigation and actions before the generic service label', () => {
  for (const [title, label] of [
    ['Acting classes', 'Classes'], ['Our courses', 'Courses'], ['Treatment programs', 'Programs'],
    ['Admissions', 'Admissions'], ['About the studio', 'About'], ['Studio policies', 'Policies'],
    ['Admission process', 'Admissions'], ['Refund policy', 'Policies'], ['About us', 'About'],
  ]) {
    const { content, catalog } = fixture(title), original = structuredClone({ content, catalog });
    const sections = websiteSections(publishedWorkspace(content, catalog), content, catalog);
    const manifest = buildWebsiteCompositionManifest(content, catalog), plan = proposeWebsiteComposition(manifest);
    assert.deepEqual(manifest.sections.find(section => section.id === sectionId)?.labels, [label, 'Services']);
    assert.deepEqual(manifest.actions.find(action => action.actionId === actionId), {
      actionId, kind: 'section', sectionId, labels: [label, `View ${label}`, 'Services', 'View Services'],
    });
    assert.deepEqual(plan.primaryAction, { actionId, label });
    assert.equal(plan.navigation.find(item => item.sectionId === sectionId)?.label, label);
    const rendered = applyWebsiteCompositionSections(sections, plan).find(section => section.id === sectionId)!;
    assert.equal(rendered.title, title);
    assert.equal(rendered.entries, sections.find(section => section.id === sectionId)!.entries);
    assert.deepEqual(plan.snapshot, websiteCompositionSnapshot(content));
    assert.deepEqual({ content, catalog }, original, 'labels do not change canonical content, qualifications or revisions');
    assert.deepEqual(proposeWebsiteComposition(manifest), plan);
  }
});

test('ambiguous headings, similar words and record prose do not authorize a semantic label', () => {
  for (const title of ['Courses and programs', 'Admission policies', 'About our classes', 'About to begin', 'About six years', 'Programming services', 'Classical training', 'Ways we can work together']) {
    const { content, catalog } = fixture(title);
    catalog.entities[0].name = 'Classes';
    catalog.entities[0].summary = 'Read about courses, programs and admissions. This body is not the collection heading.';
    const manifest = buildWebsiteCompositionManifest(content, catalog), plan = proposeWebsiteComposition(manifest);
    assert.deepEqual(manifest.sections.find(section => section.id === sectionId)?.labels, ['Services'], title);
    assert.deepEqual(plan.primaryAction, { actionId, label: 'Services' });
  }
});

test('a serialized plan from the previous label registry remains valid after semantic labels are added', () => {
  const { content, catalog } = fixture('Acting classes');
  const manifest = buildWebsiteCompositionManifest(content, catalog);
  const previousManifest = structuredClone(manifest);
  previousManifest.sections.find(section => section.id === sectionId)!.labels = ['Services'];
  previousManifest.actions.find(action => action.actionId === actionId)!.labels = ['Services', 'View Services'];
  const savedPlan = JSON.parse(JSON.stringify(proposeWebsiteComposition(previousManifest)));
  assert.deepEqual(savedPlan.primaryAction, { actionId, label: 'Services' });
  assert.deepEqual(validateWebsiteCompositionPlan(savedPlan, manifest), savedPlan);
  assert.deepEqual(validateWebsiteCompositionPlan({ ...savedPlan, primaryAction: { actionId, label: 'View Services' } }, manifest).snapshot, savedPlan.snapshot);
  assert.deepEqual(proposeWebsiteComposition(manifest).primaryAction, { actionId, label: 'Classes' });
});

test('semantic labels do not authorize a different destination, arbitrary copy or a new capability', () => {
  const { content, catalog } = fixture('Treatment programs'), manifest = buildWebsiteCompositionManifest(content, catalog);
  const plan = proposeWebsiteComposition(manifest);
  assert.deepEqual(validateWebsiteCompositionPlan({ ...plan, primaryAction: { actionId, label: 'View Programs' } }, manifest).primaryAction, { actionId, label: 'View Programs' });
  for (const label of ['Classes', 'Admissions', 'Book a program', 'Guaranteed admission', 'Programs available now']) {
    assert.throws(() => validateWebsiteCompositionPlan({ ...plan, primaryAction: { actionId, label } }, manifest), /approved action registry/);
    assert.throws(() => validateWebsiteCompositionPlan({ ...plan, navigation: plan.navigation.map(item => item.sectionId === sectionId ? { ...item, label } : item) }, manifest), /approved short label/);
  }
  assert.throws(() => validateWebsiteCompositionPlan({ ...plan, primaryAction: { actionId: 'book:program', label: 'Programs' } }, manifest), /approved action registry/);
  assert.throws(() => validateWebsiteCompositionPlan({ ...plan, primaryAction: { actionId, label: 'Programs', url: 'https://unapproved.example/book' } }, manifest));
  assert.deepEqual(manifest.actions.find(action => action.actionId === actionId)?.sectionId, sectionId);
});
