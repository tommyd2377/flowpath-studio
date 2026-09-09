import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';
import { getEditorStatus } from './editor-config';
import { buildEditorContext, generateEditorReply } from './ai-editor';
import { getSite, modifySite, reserveAiRequest } from './site-store';
import { applyCommand, commandSchema } from './site-commands';
import type { WorkspaceUser } from './firebase/types';

type ChatCommand = Extract<z.infer<typeof commandSchema>, { action: 'chat' }>;
export async function editWithChat(user: WorkspaceUser, siteId: string, command: ChatCommand) {
  const editor = getEditorStatus();
  if (editor.mode === 'demo') return modifySite(user, siteId, command.revision, site => applyCommand(site, command));
  if (editor.mode !== 'openai') throw new AppError(editor.message, 503);
  if (!command.requestId) throw new AppError('Reload the editor before sending a message.', 400);
  const site = await getSite(user, siteId);
  if (site.revision !== command.revision) throw new AppError('This site changed in another tab. Reload before asking for an edit.', 409);
  const context = buildEditorContext(site, command.fileIds);
  // Reserve before spending. No model work can run in a retried Firestore callback.
  await reserveAiRequest(user, siteId, command.revision, command.requestId);
  const reply = await generateEditorReply(site, command.text, context);
  return modifySite(user, siteId, command.revision, current => {
    current.messages.push({ id: randomUUID(), role: 'user', text: command.text, createdAt: new Date().toISOString() }, reply);
    current.messages = current.messages.slice(-60);
  });
}
