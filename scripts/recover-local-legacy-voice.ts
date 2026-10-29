import { getFirebaseAccountServices } from '../lib/firebase-accounts';
import { localAppOrigin, localFirebaseDatabase } from '../lib/local-app-runtime';
import { recoverLegacyLocalHold } from '../lib/local-legacy-voice-recovery';

const [waveformId, action, fingerprint] = process.argv.slice(2);
if (!localAppOrigin() || !/^[0-9a-f-]{36}$/i.test(waveformId ?? '')
  || action !== undefined && (action !== '--apply-approved-quarantine' || !/^[a-f0-9]{64}$/.test(fingerprint ?? ''))
  || process.argv.length > 5) throw new Error('Use the validated localhost runtime and an exact waveform; application is read-only unless explicitly confirmed');
const { db } = getFirebaseAccountServices('flowpath-studio', process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)');
try {
  // Field projection avoids reading the creator's prompt, portrait or documents.
  const matches = await db.collection('ownerWaveforms').where('id', '==', waveformId).select().limit(2).get();
  if (matches.size !== 1) throw new Error('The unique waveform owner could not be verified');
  const result = await recoverLegacyLocalHold(localFirebaseDatabase(), { ownerUid: matches.docs[0].id, waveformId }, fingerprint);
  console.log(JSON.stringify(result));
} finally { await db.terminate(); }
