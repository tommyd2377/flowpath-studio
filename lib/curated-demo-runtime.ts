import { applicationDatabase } from './application-database';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { createCuratedDemo } from './curated-demo';
import { FRANKLIN_DEMO_ID } from './public-voice-identity';
import { CreationSafetyError } from './creation-safety';

export const curatedDemo = createCuratedDemo(applicationDatabase(), {
  findOwner: async () => {
    const project = configuredFirebaseProjectId();
    if (process.env.FLOWPATH_ACCOUNT_MODE !== 'firebase' || !project) return null;
    const result = await getFirebaseAccountServices(project, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)')
      .db.collection('ownerWaveforms').where('id', '==', FRANKLIN_DEMO_ID).limit(2).get();
    return result.size === 1 ? result.docs[0].id : null;
  },
  requireAllowed: async (tx, uid, waveform) => {
    if (!creationSafetyEnabled()) throw new CreationSafetyError('The demonstration needs safety review.', 503);
    return creationReviewStore().requireSnapshotAllowed(tx, uid, waveform);
  },
  followUp: async (uid, waveform) => { await creationReviewStore().followUp(uid, waveform); },
});
