import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, symlink, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Exercise the packed JS/CSS artifact from a separate consumer with no Studio aliases.
const project = process.cwd();
const consumer = await mkdtemp(join(tmpdir(), 'voice-package-consumer-'));
try {
  const output = JSON.parse(execFileSync('npm', ['pack', '--workspace', '@thevoice/platform-ui', '--ignore-scripts', '--json', '--cache', join(consumer, 'cache'), '--userconfig', '/dev/null', '--globalconfig', join(consumer, 'npmrc'), '--pack-destination', consumer], { cwd: project, encoding: 'utf8' }));
  const directory = join(consumer, 'node_modules', '@thevoice', 'platform-ui');
  await mkdir(directory, { recursive: true });
  execFileSync('tar', ['-xzf', join(consumer, output[0].filename), '--strip-components=1', '-C', directory]);
  for (const name of await readdir(join(project, 'node_modules'))) {
    if (name === '@thevoice' || name === '.bin' || name.startsWith('.')) continue;
    await symlink(resolve(project, 'node_modules', name), join(consumer, 'node_modules', name));
  }
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(consumer, 'catalog.json'), await readFile(join(project, 'fixtures/catalogs/bookstore.json')));
  await writeFile(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptiveWorkspace, CatalogExplorer, MediaGallery, compilePresentation, preflightPresentation, defaultPresentation, validateCatalog } from '@thevoice/platform-ui';
import { emptyWorkspace, applyWorkspaceBatch } from '@thevoice/platform-ui/workspace';
import { validateMediaLibrary } from '@thevoice/platform-ui/media';
import { planForIntent } from '@thevoice/platform-ui/interaction';
import { knowledgeFacts, retrieveKnowledge, projectKnowledgeCatalog } from '@thevoice/platform-ui/knowledge';
const catalog = validateCatalog(JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url))));
const knowledge = retrieveKnowledge(catalog, {revisionId:catalog.id,entityIds:[catalog.entities[0].id],expansion:0});
assert.equal(knowledge.revisionId, catalog.id);
assert.equal(knowledge.entities[0].id, catalog.entities[0].id);
assert.ok(knowledge.facts.length);
assert.ok(knowledgeFacts(catalog).some(fact => fact.id === knowledge.facts[0].id));
assert.equal(projectKnowledgeCatalog(catalog).id, catalog.id);
const program = compilePresentation(catalog, defaultPresentation(catalog));
assert.ok(preflightPresentation(program).root);
const authority = { publicationId: 'packed-publication', catalog, records: catalog.entities.map(entity => ({reference:{kind:'entity',id:entity.id,revisionId:catalog.id},name:entity.name,component:'detail'})) };
const workspace = applyWorkspaceBatch(emptyWorkspace(authority.publicationId), {schemaVersion:1,publicationId:authority.publicationId,requestId:'packed-request',baseRevision:0,operations:authority.records.slice(0,2).map((record,index)=>({kind:'add',object:{instanceId:'instance-'+index,component:'detail',references:[record.reference]}}))}, authority).state;
assert.equal(workspace.objects.length,2);
const workspaceHtml = renderToStaticMarkup(createElement(AdaptiveWorkspace,{objects:workspace.objects,focusedId:null,authority,onOperation:()=>{},render:object=>createElement('p',null,object.instanceId)}));
assert.match(workspaceHtml,/instance-0/); assert.match(workspaceHtml,/instance-1/);
const html = renderToStaticMarkup(createElement(CatalogExplorer, {catalog, showComposer:false}));
assert.match(html, /The Imaginary Harbor/);
assert.match(html, /Explore the collection/);
const criteriaPlan = defaultPresentation(catalog);
assert.ok(!criteriaPlan.components.some(component => component.type === 'criteria'));
assert.doesNotMatch(renderToStaticMarkup(createElement(CatalogExplorer, {catalog, plan:criteriaPlan, showComposer:false})), /Find your fit/);
const media = validateMediaLibrary({schemaVersion:1,id:'media-1',assets:[{id:'photo-1',width:1200,height:800,caption:'Publisher photo',alt:'A publisher-provided photo'}],albums:[],associations:[]});
const photoPlan = planForIntent(catalog, 'show photos', undefined, media);
assert.ok(preflightPresentation(compilePresentation(catalog, photoPlan, catalog.id, media)).root);
const photos = renderToStaticMarkup(createElement(MediaGallery, {library:media,resolveAssetUrl:id=>'/photos/'+id}));
assert.match(photos, /Publisher photo/);
assert.match(photos, /width="1200" height="800"/);
const css = readFileSync(new URL('./node_modules/@thevoice/platform-ui/dist/styles.css', import.meta.url), 'utf8');
assert.match(css, /platform-explorer/);
assert.match(css, /platform-lightbox/);
assert.match(css, /platform-workspace-flight/);
assert.ok(readFileSync(new URL('./node_modules/@thevoice/platform-ui/dist/index.d.ts', import.meta.url), 'utf8'));
console.log('Packed platform-ui independently retrieves knowledge and renders catalog, media, controls, and CSS.');
`);
  process.stdout.write(execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, encoding: 'utf8' }));
} finally { await rm(consumer, { recursive: true, force: true }); }
