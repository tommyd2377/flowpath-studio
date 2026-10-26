import { accountSessionId, activeAccountSession, ACCOUNT_SESSION_COLLECTION } from './production-account-session';
import type { AccountMode, AccountUser } from './account-model';
import { applicationDatabase } from './application-database';
import { createCreationReviewStore, type CreationActor } from './creation-review';
import { createFixtureCreationReviewer } from './creation-safety-fixtures';
import { CREATION_SAFETY_CATEGORIES, CreationSafetyError, type CreationSafetyPolicy } from './creation-safety';
import type { VoiceTransaction } from './production-voice-store';

export type CreationIdentity = { owner: AccountUser; mode: AccountMode; cookie: string; accountSessionId?: string; isCurrent(): boolean | Promise<boolean> };
export const creationSafetyFixtures = process.env.NODE_ENV === 'development' && process.env.FLOWPATH_ACCOUNT_MODE === 'local' && process.env.FLOWPATH_SAFETY_FIXTURES === '1';
export const creationSafetyEnabled = () => creationSafetyFixtures || process.env.FLOWPATH_CREATION_SAFETY_ENABLED === '1';
export const creationActor = (identity: CreationIdentity): CreationActor => ({ uid: identity.owner.uid, accountSessionId: identity.accountSessionId ?? accountSessionId(identity.cookie) });

function policy(): CreationSafetyPolicy | null {
  // This policy and reviewer are synthetic fixtures, never a production classifier.
  if (creationSafetyFixtures) return { version: 'local-fixture-v1', categories: Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, 'block'])) as CreationSafetyPolicy['categories'] };
  try { return process.env.FLOWPATH_CREATION_POLICY_JSON ? JSON.parse(process.env.FLOWPATH_CREATION_POLICY_JSON) : null; } catch { return null; }
}
export function creationReviewStore(identity?: CreationIdentity) {
  const verifyOwner = async (tx: VoiceTransaction, actor: CreationActor) => {
    if (!identity || identity.owner.uid !== actor.uid || creationActor(identity).accountSessionId !== actor.accountSessionId
      || !await identity.isCurrent()) throw new CreationSafetyError('Sign in again to continue.', 403);
    if (identity.mode === 'firebase' && !activeAccountSession(await tx.get(`${ACCOUNT_SESSION_COLLECTION}/${actor.accountSessionId}`), actor.uid)) throw new CreationSafetyError('Sign in again to continue.', 403);
  };
  return createCreationReviewStore(applicationDatabase(), {
    mode: creationSafetyFixtures ? 'fixture' : 'production', policy,
    verifyOwner,
    verifyAdmin: async (tx, actor) => {
      await verifyOwner(tx, actor);
      if (identity?.owner.role !== 'admin') throw new CreationSafetyError('Admin access is required.', 403);
    },
    reviewer: creationSafetyFixtures ? createFixtureCreationReviewer({ nodeEnv: process.env.NODE_ENV, enabled: true }, async candidate => {
      const text = `${candidate.name}\n${candidate.initialPrompt}\n${candidate.textPanel?.text ?? ''}`;
      const findings = Object.fromEntries(CREATION_SAFETY_CATEGORIES.map(key => [key, 'clear'])) as Record<typeof CREATION_SAFETY_CATEGORIES[number], 'clear' | 'violation' | 'uncertain'>;
      if (/\[fixture:blocked\]|\b(?:Adolf Hitler|Osama bin Laden)\b/i.test(text)) findings['extremist-impersonation'] = 'violation';
      else if (/\[fixture:manual\]/i.test(text)) findings['fraud-impersonation'] = 'uncertain';
      return { findings };
    }) : null,
  });
}
