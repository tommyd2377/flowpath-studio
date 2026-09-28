import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import { getEditorStatus } from './editor-config';
import { readDatabaseSnapshot, withDatabase } from './local-store';
import { AppError } from './errors';
import { contentSchema, nativeWebsiteContent } from './site-model';
import { visitorSettings } from './visitor-model';
import { availability, currentLedger, reserveDictation, reserveReply } from './visitor-quota';
import { reserveSearch, searchRemaining } from './explore-quota';

export async function visitorAccess(slug: string, request?: { requestId: string; kind: 'chat' | 'voice' | 'search' | 'dictation'; greeting?: boolean }) {
  const live = getEditorStatus().mode === 'openai';
  const useContent = (raw: unknown, siteId: string, storedUsage: unknown) => {
    const content = contentSchema.parse(nativeWebsiteContent(raw));
    if (request?.greeting && content.visitorSpeaksFirst) throw new AppError('This site lets the visitor speak first.', 403);
    const settings = visitorSettings(content);
    const ledger = currentLedger(storedUsage);
    if (request?.kind === 'search') reserveSearch(ledger, siteId, request.requestId, content);
    const state = request?.kind === 'dictation' ? reserveDictation(ledger, siteId, request.requestId, settings, live)
      : request && request.kind !== 'search' ? reserveReply(ledger, siteId, request.requestId, request.kind, settings, live)
      : availability(ledger, siteId, settings, live);
    return { content, siteId, ledger, availability: { ...state, searchRemaining: searchRemaining(ledger, siteId, content) } };
  };
  if (getBackendMode() === 'demo') return (request ? withDatabase : readDatabaseSnapshot)(db => {
    const site = db.sites.find(site => site.slug === slug && site.ownerId === 'local-demo');
    if (!site?.published) throw new AppError('Published site not found.', 404);
    const result = useContent(site.published, site.id, db.visitorUsage);
    if (request) db.visitorUsage = result.ledger;
    return { content: result.content, siteId: result.siteId, availability: result.availability };
  });
  if (request && !live) throw new AppError('The site assistant is not available right now.', 503);
  const db = getFirestore(getFirebaseAdminApp());
  const siteRef = db.collection('voicePublished').doc(slug);
  // One small shared document bounds total attempts across every site and process.
  // Counts are reserved before provider work, including failed or cancelled attempts.
  const usageRef = db.collection('voiceVisitorUsage').doc('current');
  return db.runTransaction(async transaction => {
    const [siteRecord, usageRecord] = await transaction.getAll(siteRef, usageRef);
    const site = siteRecord.data();
    if (!site || typeof site.siteId !== 'string') throw new AppError('Published site not found.', 404);
    const result = useContent(site.content, site.siteId, usageRecord.data());
    if (request) transaction.set(usageRef, result.ledger);
    return { content: result.content, siteId: result.siteId, availability: { ...result.availability, enabled: result.availability.enabled && live } };
  }, { maxAttempts: 3 });
}
