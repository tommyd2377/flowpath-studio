import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSite, modifySite, uploadFile } from './site-store';
import { clientSite, updateDraft } from './local-store';
import { discoverWebsite, readWebsitePageSource, extractWebsitePage } from './website-import';
import { discoverWebsiteAssets } from './website-assets';
import { prepareWebsiteImage } from './website-images';
import { prepareMigrationMedia } from './media-store';
import { migrationSchema, type WebsiteMigration } from './website-migration-model';
import type { WorkspaceUser } from './firebase/types';
import type { WebsiteTransport } from './website-fetch';
import { AppError } from './errors';
async function save(user:WorkspaceUser,id:string,revision:number,migration:WebsiteMigration){migrationSchema.parse(migration);if(Buffer.byteLength(JSON.stringify(migration))>250000)throw new AppError('Migration exceeds the review size limit. Import a smaller section.');const site=await modifySite(user,id,revision,s=>{s.websiteMigration=migration});return{site,migration};}
export async function discoverMigration(user:WorkspaceUser,id:string,revision:number,url:string,io?:WebsiteTransport){const current=await getSite(user,id);if(current.revision!==revision)throw new AppError('Reload the changed draft.',409);const discovery=await discoverWebsite(url,io);const previous=current.websiteMigration?.url===discovery.url?current.websiteMigration:undefined;
 const migration:WebsiteMigration={id:previous?.id??randomUUID(),url:discovery.url,pages:discovery.pages,selectedPages:previous?.selectedPages??discovery.pages.filter(p=>p.status==='ready').slice(0,24).map(p=>p.url),images:(discovery.images??[]).map(i=>previous?.images.find(p=>p.url===i.url)??{...i,status:'excluded',caption:i.alt,placement:'source',role:'depicts'}),notes:discovery.notes,updatedAt:new Date().toISOString()};
 if(previous){migration.brandAccent=previous.brandAccent;migration.images=[...new Map([...previous.images,...migration.images].map(image=>[image.url,image])).values()].slice(0,100);}
 return save(user,id,revision,migration);}
export async function updateMigration(user:WorkspaceUser,id:string,revision:number,input:{selectedPages?:string[];images?:WebsiteMigration['images']}){const site=await getSite(user,id);if(!site.websiteMigration)throw new AppError('Discover a website first.');const migration=migrationSchema.parse(site.websiteMigration);
 if(input.selectedPages){if(input.selectedPages.some(url=>!migration.pages.some(p=>p.url===url&&p.status==='ready')))throw new AppError('Choose discovered pages.');migration.selectedPages=input.selectedPages;}
 if(input.images){for(const update of input.images){const original=migration.images.find(i=>i.url===update.url);if(!original)throw new AppError('Choose a discovered image.');if(update.fileId!==original.fileId||update.pageUrl!==original.pageUrl||JSON.stringify(update.variants)!==JSON.stringify(original.variants))throw new AppError('Image provenance cannot be changed.');if(!['excluded','selected',...(original.fileId?['imported']:[]),original.status].includes(update.status))throw new AppError('Image status is server-owned.');Object.assign(original,update);}}
 migration.updatedAt=new Date().toISOString();return save(user,id,revision,migration);}
export async function discoverMigrationImages(user:WorkspaceUser,id:string,revision:number,io?:WebsiteTransport){
 const site=await getSite(user,id);if(site.revision!==revision||!site.websiteMigration)throw new AppError('Reload the website migration.',409);
 const migration=migrationSchema.parse(site.websiteMigration);if(!migration.selectedPages.length)throw new AppError('Select pages first.');
 const sources=new Map<string,{url:string;html:string}>();for(const url of migration.selectedPages){const source=await readWebsitePageSource(migration.url,url,io);sources.set(source.url.replace(/\/$/,''),source);}
 const pages=new Map([...sources].map(([key,source])=>[key,extractWebsitePage(source.html,source.url)]));
 const assets=await discoverWebsiteAssets([...sources.values()],io);if(assets.brandAccent)migration.brandAccent=assets.brandAccent;
 const images=new Map(migration.images.map(image=>[image.url,image]));for(const image of [...pages.values()].flatMap(page=>page.images).concat(assets.images)){if(!images.has(image.url)&&images.size<100)images.set(image.url,{...image,status:'excluded',caption:image.alt,placement:'source',role:'depicts'});}
 migration.images=[...images.values()];migration.notes=[...new Set([...migration.notes.filter(note=>note.startsWith('Discovery reached')), ...assets.notes,`${pages.size} pages read for conventional design and image discovery. Review captions and placements before applying.`,...(images.size>=100?['Image discovery reached its 100-reference limit. Review remaining source images separately.']:[])])].slice(0,50);
 return save(user,id,revision,migration);
}
export async function importMigrationImage(user:WorkspaceUser,id:string,revision:number,url:string,io?:WebsiteTransport){let site=await getSite(user,id);if(site.revision!==revision||!site.websiteMigration)throw new AppError('Reload the website migration.',409);const migration=migrationSchema.parse(site.websiteMigration),item=migration.images.find(i=>i.url===url);if(!item||item.status==='excluded')throw new AppError('Select this image before importing.');
 try{const file=await prepareWebsiteImage(migration.url,item.pageUrl,item.url,io,item);const duplicate=site.files.find(f=>f.image?.hash===file.image?.hash);let fileId=duplicate?.id;
 if(!fileId){const uploaded=await uploadFile(user,id,revision,file);revision=uploaded.revision;fileId=file.id;}site=await getSite(user,id);if(site.revision!==revision)throw new AppError('Draft changed during download; reload to reconcile files.',409);
 item.fileId=fileId;item.status='imported';delete item.error;return save(user,id,revision,migration);
 }catch(error){if(error instanceof AppError&&error.status===409)throw error;item.status='failed';item.error=error instanceof AppError?error.message:'Image could not be imported.';return save(user,id,revision,migration);}}
export async function applyMigrationPhotos(user:WorkspaceUser,id:string,revision:number){
 const current=await getSite(user,id);if(current.revision!==revision||!current.websiteMigration)throw new AppError('Reload the website migration.',409);
 const migration=migrationSchema.parse(current.websiteMigration);
 if(migration.images.some(i=>i.status==='selected'||i.status==='failed'))throw new AppError('Import or explicitly exclude each selected/failed image before applying.');
 const selected=migration.images.filter(i=>i.status==='imported'&&i.fileId);
 if(!selected.length)throw new AppError('Import and review photos first.');
 if(selected.filter(i=>i.placement==='logo').length>1)throw new AppError('Choose one logo placement; use photo library placement for the others.');
 const media=await prepareMigrationMedia(user,id,migration.images);
 const site=await modifySite(user,id,revision,state=>{const logo=selected.find(i=>i.placement==='logo');state.mediaRefs={...state.mediaRefs,[media.id]:media.assets.map(a=>a.id)};
 updateDraft(state,{...state.draft,mediaRevisionId:media.id,...(logo?{logoAssetId:logo.fileId!}:{}),style:{...state.draft.style??{layout:'balanced',palette:'parchment'},entry:'website'}});state.websiteMigration=migration;});return{site,migration};
}
export async function readMigration(user:WorkspaceUser,id:string){const site=await getSite(user,id);return{site:clientSite(site),migration:site.websiteMigration?migrationSchema.parse(site.websiteMigration):null};}
