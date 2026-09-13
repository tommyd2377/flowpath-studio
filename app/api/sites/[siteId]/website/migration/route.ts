import { z } from 'zod';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { readJson, respond } from '@/lib/http';
import { discoverMigration, updateMigration, discoverMigrationImages, importMigrationImage, applyMigrationPhotos, readMigration } from '@/lib/website-migration';
import { migrationImageSchema } from '@/lib/website-migration-model';
export const runtime='nodejs';
const command=z.object({action:z.enum(['discover','select','discover-images','import-image','apply']),revision:z.number().int().positive(),url:z.string().max(2048).optional(),selectedPages:z.array(z.string().max(2048)).max(24).optional(),images:z.array(migrationImageSchema).max(100).optional()}).strict();
type Context={params:Promise<{siteId:string}>};
export async function GET(request:Request,{params}:Context){return respond(async()=>readMigration(await requireWorkspaceUser(request),(await params).siteId));}
export async function POST(request:Request,{params}:Context){return respond(async()=>{const user=await requireWorkspaceUser(request),{siteId}=await params,input=command.parse(await readJson(request));switch(input.action){case'discover':return discoverMigration(user,siteId,input.revision,input.url??'');case'select':return updateMigration(user,siteId,input.revision,input);case'discover-images':return discoverMigrationImages(user,siteId,input.revision);case'import-image':return importMigrationImage(user,siteId,input.revision,input.url??'');case'apply':return applyMigrationPhotos(user,siteId,input.revision);}});}
