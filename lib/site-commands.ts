import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';
import { retainedMediaReferences, updateDraft, type StoredSite } from './local-store';
import { contentSchema } from './site-model';
import { proposeEdit } from './demo-editor';

const revision = z.number().int().positive();
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), revision, content: contentSchema }).strict(),
  z.object({ action: z.literal('chat'), revision, text: z.string().trim().min(1).max(4000),
    requestId: z.string().uuid().optional(), fileIds: z.array(z.string().uuid()).max(3).default([]) }).strict(),
  z.object({ action: z.literal('apply'), revision, messageId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('discard'), revision, messageId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('publish'), revision }).strict(),
  z.object({ action: z.literal('undo'), revision }).strict(),
  z.object({ action: z.literal('remove-file'), revision, fileId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('use-logo'), revision, fileId: z.string().uuid() }).strict(),
]);

export function applyCommand(site: StoredSite, command: z.infer<typeof commandSchema>) {
  switch (command.action) {
    case 'save':
      if (command.content.knowledgeRevisionId !== site.draft.knowledgeRevisionId) throw new AppError('Use Knowledge review to change the catalog in this draft.');
      if (command.content.mediaRevisionId !== site.draft.mediaRevisionId) throw new AppError('Use Photos review to change the media library in this draft.');
      updateDraft(site, command.content); break;
    case 'chat': {
      const reply = proposeEdit(site, command.text, site.files);
      if (reply.proposal) contentSchema.parse(reply.proposal.content);
      site.messages.push({ id: randomUUID(), role: 'user', text: command.text, createdAt: new Date().toISOString() }, reply);
      site.messages = site.messages.slice(-60);
      break;
    }
    case 'apply':
    case 'discard': {
      const proposal = site.messages.find(message => message.id === command.messageId)?.proposal;
      if (!proposal || proposal.status !== 'pending') throw new AppError('That proposal is no longer available.');
      if (command.action === 'apply') {
        if (proposal.baseContent !== JSON.stringify(site.draft)) throw new AppError('Your draft has changed since this proposal. Ask for a fresh edit.', 409);
        if (proposal.content.mediaRevisionId !== site.draft.mediaRevisionId) throw new AppError('Use Photos review to change the media library in this draft.');
        updateDraft(site, proposal.content);
      }
      proposal.status = command.action === 'apply' ? 'applied' : 'discarded';
      break;
    }
    case 'publish': site.published = structuredClone(site.draft); site.publishedAt = new Date().toISOString(); break;
    case 'undo': {
      const previous = site.history.pop();
      if (!previous) throw new AppError('There are no draft changes to undo.');
      if (previous.logoAssetId && !site.files.some(file => file.id === previous.logoAssetId)) previous.logoAssetId = null;
      site.draft = previous;
      break;
    }
    case 'use-logo': updateDraft(site, { ...site.draft, logoAssetId: command.fileId }); break;
    case 'remove-file': {
      if (!site.files.some(file => file.id === command.fileId)) throw new AppError('File not found.', 404);
      if ([site.draft, site.published, ...site.history].some(content => content?.logoAssetId === command.fileId)
        || retainedMediaReferences(site).some(id => !site.mediaRefs?.[id] || site.mediaRefs[id].includes(command.fileId))) throw new AppError('This file is used by your draft, publication or retained Undo history. Remove its use first; photos can be unlinked in Photos without deleting their originals.');
      if (site.published?.logoAssetId === command.fileId) throw new AppError('This logo is on your published site. Replace or remove the logo and publish before deleting the file.');
      if (site.draft.logoAssetId === command.fileId) updateDraft(site, { ...site.draft, logoAssetId: null });
      site.files = site.files.filter(file => file.id !== command.fileId);
      break;
    }
  }
}
