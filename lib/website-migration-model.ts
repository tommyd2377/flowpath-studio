import { z } from 'zod';
import { websiteImageSchema, websitePageReportSchema } from './website-import-model';
export const migrationImageSchema=websiteImageSchema.extend({status:z.enum(['excluded','selected','imported','failed']),fileId:z.string().uuid().optional(),error:z.string().max(500).optional(),caption:z.string().max(500),placement:z.enum(['source','lead','logo']),role:z.enum(['depicts','example']),targetEntityId:z.string().max(80).optional()}).strict();
export const migrationSchema=z.object({id:z.string().uuid(),url:z.string().max(2048),pages:z.array(websitePageReportSchema).max(100),brandAccent:z.string().regex(/^#[a-f0-9]{6}$/i).optional(),selectedPages:z.array(z.string().max(2048)).max(24),images:z.array(migrationImageSchema).max(100),notes:z.array(z.string().max(1000)).max(50),updatedAt:z.string().datetime()});
export type WebsiteMigration=z.infer<typeof migrationSchema>;
