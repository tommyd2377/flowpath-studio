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
import { CatalogExplorer, MediaGallery, compilePresentation, preflightPresentation, defaultPresentation, validateCatalog } from '@thevoice/platform-ui';
import { validateMediaLibrary } from '@thevoice/platform-ui/media';
import { planForIntent } from '@thevoice/platform-ui/interaction';
const catalog = validateCatalog(JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url))));
const program = compilePresentation(catalog, defaultPresentation(catalog));
assert.ok(preflightPresentation(program).root);
const html = renderToStaticMarkup(createElement(CatalogExplorer, {catalog, showComposer:false}));
assert.match(html, /The Imaginary Harbor/);
assert.match(html, /Explore the collection/);
const criteriaPlan = defaultPresentation(catalog);
assert.ok(criteriaPlan.components.some(component => component.type === 'criteria'));
assert.match(renderToStaticMarkup(createElement(CatalogExplorer, {catalog, plan:criteriaPlan, showComposer:false})), /Find your fit/);
const media = validateMediaLibrary({schemaVersion:1,id:'media-1',assets:[{id:'photo-1',width:1200,height:800,caption:'Publisher photo',alt:'A publisher-provided photo'}],albums:[],associations:[]});
const photoPlan = planForIntent(catalog, 'show photos', undefined, media);
assert.ok(preflightPresentation(compilePresentation(catalog, photoPlan, catalog.id, media)).root);
const photos = renderToStaticMarkup(createElement(MediaGallery, {library:media,resolveAssetUrl:id=>'/photos/'+id}));
assert.match(photos, /Publisher photo/);
assert.match(photos, /width="1200" height="800"/);
const css = readFileSync(new URL('./node_modules/@thevoice/platform-ui/dist/styles.css', import.meta.url), 'utf8');
assert.match(css, /platform-explorer/);
assert.match(css, /platform-lightbox/);
assert.ok(readFileSync(new URL('./node_modules/@thevoice/platform-ui/dist/index.d.ts', import.meta.url), 'utf8'));
console.log('Packed platform-ui independently renders catalog, media, controls, and CSS.');
`);
  process.stdout.write(execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, encoding: 'utf8' }));
} finally { await rm(consumer, { recursive: true, force: true }); }
