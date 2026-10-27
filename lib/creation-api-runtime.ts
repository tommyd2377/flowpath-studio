import { createCreationApi } from './creation-api';
import { accountServer } from './account-runtime';
import { creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { configuredPublicOrigin } from './request-origin';
import { normalizeProfilePhoto } from './profile-photo';
import { canonicalCreationCandidate, CreationSafetyError } from './creation-safety';
import { applicationDatabase } from './application-database';
import { knowledgeDocumentForReview } from './knowledge-store';
export const creationApi = createCreationApi({ accounts: accountServer, enabled: creationSafetyEnabled, store: creationReviewStore,
  publicOrigin: process.env.NODE_ENV === 'production' ? configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN) : undefined,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  prepare: async (request, candidate) => {
    if (!candidate.profilePhoto) return candidate;
    const existing = await accountServer.resolveVoiceWaveform(request, undefined, 'cleanup');
    if (candidate.profilePhoto === existing?.waveform.profilePhoto) return candidate;
    const normalized = await normalizeProfilePhoto(candidate.profilePhoto);
    if (!normalized) throw new CreationSafetyError('Choose a valid bounded portrait.', 400);
    return canonicalCreationCandidate({ ...candidate, profilePhoto: normalized });
  },
  file: async record => {
    const file = record.candidate.document && await applicationDatabase().transaction(tx => knowledgeDocumentForReview(tx, record.ownerUid, record.candidate.document!));
    if (!file?.fileId) throw new CreationSafetyError('This document is no longer available.', 404);
    if (!process.env.OPENAI_API_KEY) throw new CreationSafetyError('The document service is unavailable.', 503);
    const response = await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(file.fileId)}/content`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new CreationSafetyError(`Original-file retrieval was unavailable (HTTP ${response.status}). No model review was started by this download.`, 503);
    return new Response(response.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' } });
  },
});
