import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { websiteBrandAccent } from '../lib/website-brand';
import { extractWebsitePage, websitePageCatalog } from '../lib/website-import';
import { addWebsiteOfferings, websiteOfferings } from '../lib/website-structure';
import type { WebsiteTransport } from '../lib/website-fetch';
const url = 'https://bakery.example/';
const html = `<html><head><title>Bakery | Delicious</title><link rel="stylesheet" href="/site.css"></head><body class="blue"><header>Repeated navigation</header><h1>Bakery</h1><p>Freshly baked desserts for our neighborhood.</p><h2>Cakes</h2><h3>Chocolate — $20</h3><img data-sub-html="<span>cake</span>" src="/cake.png" alt="Chocolate cake"><a href="/menu">Menu</a><form action="https://evil.example"><input placeholder="Name"><button>Send</button></form><script>alert(1)</script><footer>Repeated footer</footer></body></html>`;
async function fixture() {
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const calls: string[]=[];
  const io: WebsiteTransport = { resolve:async()=>[{address:'93.184.216.34',family:4}],connect:async u=>{
    calls.push(u.toString());const contentType=u.pathname.endsWith('.png')?'image/png':u.pathname.endsWith('.css')?'text/css':u.pathname==='/robots.txt'?'text/plain':'text/html';
    return {remoteAddress:'93.184.216.34',status:u.pathname==='/sitemap.xml'?404:200,contentType,bytes:u.pathname.endsWith('.png')?image:Buffer.from(u.pathname==='/robots.txt'?'':u.pathname.endsWith('.css')?'.blue{background:#2379aa}h1{color:white}img{width:80%}':html)};
  }};return {io,calls};
}
test('structural extraction separates chrome and preserves price hierarchy and source identity',()=>{
  const page=extractWebsitePage(html,url);
  assert.ok(!page.text.includes('Repeated'));
  assert.ok(page.rawText?.includes('Repeated footer'));
  assert.ok(!page.text.includes('data-sub-html'));
  assert.equal(page.name,'Bakery');
  const first=addWebsiteOfferings(websitePageCatalog([page]),[page]);
  assert.equal(first.catalog.entities.filter(e=>e.kind==='offering').length,1);
  const shifted={...page,text:'An extra introductory line\n'+page.text};
  const corrected=structuredClone(first.catalog);corrected.entities.find(e=>e.kind==='offering')!.name='Publisher corrected chocolate';
  const again=addWebsiteOfferings(corrected,[shifted]);
  assert.equal(again.catalog.entities.filter(e=>e.kind==='offering').length,1);
  assert.ok(again.catalog.entities.some(e=>e.name==='Publisher corrected chocolate'));
  const supplied=structuredClone(first.catalog);supplied.entities.find(e=>e.kind==='offering')!.id='provider-chocolate';
  supplied.collections=supplied.collections.map(c=>({...c,entityIds:c.entityIds.map(id=>id.startsWith('offering-')?'provider-chocolate':id)}));
  assert.equal(addWebsiteOfferings(supplied,[page]).catalog.entities.filter(e=>e.kind==='offering').length,1);
});
test('migration selections and downloads persist; apply is reversible and publication stays untouched',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'website-migration-'));process.env.VOICE_DATA_DIR=directory;process.env.VOICE_BACKEND='demo';process.env.VOICE_AI_MODE='demo';
  try {
    const {listSites,getSite}=await import('../lib/site-store');
    const {discoverMigration,updateMigration,discoverMigrationImages,importMigrationImage,applyMigrationPhotos,readMigration}=await import('../lib/website-migration');
    const user={mode:'demo' as const,uid:'local-demo',email:null,displayName:null};const site=await getSite(user,(await listSites(user))[0].id);const {io}=await fixture();
    let result=await discoverMigration(user,site.id,site.revision,url,io);
    result=await updateMigration(user,site.id,result.site.revision,{selectedPages:[url,url+'menu']});
    result=await discoverMigrationImages(user,site.id,result.site.revision,io);
    result=await updateMigration(user,site.id,result.site.revision,{images:result.migration.images.map(i=>({...i,status:'selected'}))});
    result=await importMigrationImage(user,site.id,result.site.revision,result.migration.images[0].url,io);
    assert.equal((await readMigration(user,site.id)).migration?.images[0].status,'imported');
    const applied=await applyMigrationPhotos(user,site.id,result.site.revision);
    const stored=await getSite(user,site.id);assert.deepEqual(stored.published,site.published);assert.deepEqual(stored.history.at(-1),site.draft);
    assert.ok(applied.site.draft.mediaRevisionId);
    assert.equal(applied.site.draft.style?.entry,'website');
    assert.equal((await readMigration(user,site.id)).migration?.images[0].fileId,result.migration.images[0].fileId);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('price qualifications remain attached to structured offerings',()=>{
 const result=websiteOfferings([{url,text:'# Menu\n## Retail\n### Specials\n#### Peach Cobbler ~ $7.00\nAvailable on Wednesdays and Sundays.\n## Catering\n### Cakes\n#### Half Sheet ~ $150.00*\n*Starting Price - Additional charges may apply based on order.'}]);
 assert.match(String(result.entities[0].attributes.source_price_terms),/Available on Wednesdays and Sundays/);
 assert.match(String(result.entities[1].attributes.source_price_terms),/Starting Price - Additional charges/);
});

test('generic hours headings and retained primary CSS tokens inform native design',async()=>{
 const page=extractWebsitePage(html.replace('</body>','<section><div><h4>Business Hours</h4><p>Monday: Closed</p><p>Tuesday–Thursday: 12:00 PM–6:00 PM</p><p>Friday–Sunday: 12:00 PM–8:00 PM</p></div></section></body>'),url);
 assert.equal(page.hours,'Monday: Closed; Tuesday–Thursday: 12:00 PM–6:00 PM; Friday–Sunday: 12:00 PM–8:00 PM');
 assert.equal(websiteBrandAccent([':root{--merchant-color:#2759a1;--primary-color:var(--merchant-color);--primary-text-color:#fff}}']),'#2759a1');
});

test('native asset discovery finds CSS photos and brand tokens without fetching fonts or rendering styles', async()=>{
 const {discoverWebsiteAssets}=await import('../lib/website-assets');const {io,calls}=await fixture();const connect=io.connect;
 io.connect=async(u,a,s)=>u.pathname==='/site.css'?{remoteAddress:a.address,status:200,contentType:'text/css',bytes:Buffer.from(':root{--primary-color:#25559d}header{background-image:url(/cake.png)}@font-face{font-family:Private;src:url(/never.woff2)}')}:connect(u,a,s);
 const result=await discoverWebsiteAssets([{url,html}],io);
 assert.equal(result.brandAccent,'#25559d');assert.equal(result.images[0].url,url+'cake.png');
 assert.ok(!calls.some(u=>u.endsWith('.woff2')));assert.ok(!('css' in result));
});

test('obsolete layout references are ignored while other invalid content remains rejected', async()=>{
 const {nativeWebsiteContent,contentSchema,sampleContent}=await import('../lib/site-model');
 const legacy={...sampleContent('general'),websiteLayoutRevisionId:crypto.randomUUID(),websiteReadingRevisionId:crypto.randomUUID()};
 assert.deepEqual(contentSchema.parse(nativeWebsiteContent(legacy)),sampleContent('general'));
 assert.throws(()=>contentSchema.parse(nativeWebsiteContent({...legacy,unrecognized:true})));
});
