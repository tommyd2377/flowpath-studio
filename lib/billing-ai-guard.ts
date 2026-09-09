import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import { AppError } from './errors';
import { createFirestoreStripeTestRepository, createStripeTestBillingService } from './billing-stripe-store';

/** Stripe sandbox credit is never money with which to fund a paid AI request. */
export async function assertNoStripeTestPaidAi(siteId: string, verifiedOwnerId?: string) {
  if (getBackendMode() !== 'firebase') return;
  const db = getFirestore(getFirebaseAdminApp());
  const ownerId = verifiedOwnerId ?? (await db.collection('voiceSites').doc(siteId).get()).data()?.ownerId;
  if (typeof ownerId !== 'string' || !ownerId) throw new AppError('The site assistant is unavailable.', 503);
  const service = createStripeTestBillingService({ repository: createFirestoreStripeTestRepository(db) });
  if (await service.hasTestAccount({ ownerId, siteId })) {
    throw new AppError('This site is testing Stripe billing. Test credits cannot fund live AI; browsing and publishing previews remain available.', 503);
  }
}
