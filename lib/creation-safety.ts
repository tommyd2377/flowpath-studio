import { validateVisualDisplay, type VisualDisplayConfiguration } from './visual-display';
import { createHash } from 'node:crypto';
import { WAVEFORM_NAME_LIMIT, WAVEFORM_PROMPT_LIMIT } from './account-model';
import { validateTextPanelConfiguration, type TextPanelConfiguration } from './text-panel';
import { validProfilePhoto } from './profile-photo';

export type CreationSafetyStatus = 'pending' | 'allowed' | 'blocked' | 'manual-review' | 'revoked';
export type CreationTextPanel = TextPanelConfiguration;
export type ReviewDocument = { waveformId?: string; id: string; digest: string; filename: string };
export type CreationCandidate = { name: string; initialPrompt: string; textPanel?: CreationTextPanel | null; visualDisplay?: VisualDisplayConfiguration | null; profilePhoto?: string | null; document?: ReviewDocument };
export type CanonicalCreationCandidate = { name: string; initialPrompt: string; textPanel: CreationTextPanel | null; visualDisplay?: VisualDisplayConfiguration; profilePhoto?: string; document?: ReviewDocument };
export const CREATION_SAFETY_CATEGORIES = [
  'extremist-impersonation', 'violent-extremism', 'sexual-content-minors',
  'hateful-abuse', 'credible-harm', 'fraud-impersonation', 'privacy-abuse',
  'living-person', 'recently-deceased-person', 'real-child-persona', 'victim-persona', 'notorious-harmful-persona',
  'sexual-companion', 'self-harm', 'coercive-dependency', 'false-professional',
  'controversial-identity', 'portrait-provenance', 'incomplete-coverage',
] as const;
export type CreationSafetyCategory = typeof CREATION_SAFETY_CATEGORIES[number];
export type CreationSafetyPolicy = {
  version: string;
  categories: Record<CreationSafetyCategory, 'block' | 'manual-review' | 'allow-and-review'>;
};
export type CreationSafetyBinding = { digest: string; policyVersion: string; policyDigest: string };
export type CreationReviewerResult = { findings: Record<CreationSafetyCategory, 'clear' | 'violation' | 'uncertain'> };
export class CreationSafetyError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export type ReviewIssue = 'budget' | 'coverage' | 'provider' | 'abandoned';
export class CreationReviewUnavailable extends Error {
  constructor(readonly issue: ReviewIssue) { super('Automated review needs a human decision.'); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Matches the existing saved name/prompt normalization; text is preserved exactly. */
export function canonicalCreationCandidate(value: unknown): CanonicalCreationCandidate {
  const row = object(value);
  if (!row || typeof row.name !== 'string' || typeof row.initialPrompt !== 'string') {
    throw new CreationSafetyError('A name and initial instructions are required.', 400);
  }
  const name = row.name.trim(), initialPrompt = row.initialPrompt.trim();
  if (!name || name.length > WAVEFORM_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)
    || !initialPrompt || initialPrompt.length > WAVEFORM_PROMPT_LIMIT
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(initialPrompt)) {
    throw new CreationSafetyError('The creation content is invalid or exceeds its limit.', 400);
  }
  let textPanel: CreationTextPanel | null = null;
  if (row.textPanel !== undefined && row.textPanel !== null) {
    const text = validateTextPanelConfiguration(row.textPanel);
    if (!text.ok || !text.value || text.value.version === 1
      && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text.value.text)) {
      throw new CreationSafetyError('Use a plain text panel of at most 4,000 characters.', 400);
    }
    textPanel = text.value;
  }
  if (row.profilePhoto !== undefined && row.profilePhoto !== null && !validProfilePhoto(row.profilePhoto)) throw new CreationSafetyError('Use a valid bounded raster portrait.', 400);
  const visual = validateVisualDisplay(row.visualDisplay);
  if (!visual.ok) throw new CreationSafetyError('Use a bounded Visual Display collection.', 400);
  const doc = object(row.document);
  if (row.document !== undefined && (!doc || Object.keys(doc).some(key => !['id', 'digest', 'filename', 'waveformId'].includes(key))
    || doc.waveformId !== undefined && (typeof doc.waveformId !== 'string' || !/^[a-f0-9-]{36}$/.test(doc.waveformId)) || typeof doc.id !== 'string' || !/^[a-f0-9-]{36}$/.test(doc.id)
    || typeof doc.digest !== 'string' || !/^[a-f0-9]{64}$/.test(doc.digest) || typeof doc.filename !== 'string'
    || !doc.filename || doc.filename.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(doc.filename))) throw new CreationSafetyError('Invalid document review binding.', 400);
  // Omit absent additions so old text-only records keep their exact digest; new assets cannot reuse it.
  return { name, initialPrompt, textPanel, ...(visual.value ? { visualDisplay: visual.value } : {}), ...(typeof row.profilePhoto === 'string' ? { profilePhoto: row.profilePhoto } : {}),
    ...(doc ? { document: { id: doc.id as string, digest: doc.digest as string, filename: doc.filename as string, ...(typeof doc.waveformId === 'string' ? { waveformId: doc.waveformId } : {}) } } : {}) };
}

export function creationContentDigest(candidate: CreationCandidate): string {
  return hash(JSON.stringify(canonicalCreationCandidate(candidate)));
}

/** Category changes stale approvals even if an operator forgets to increment the version. */
export function creationPolicyDigest(policy: CreationSafetyPolicy): string {
  const categories = object(policy?.categories);
  if (!policy || typeof policy.version !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(policy.version)
    || !categories || Object.keys(categories).length !== CREATION_SAFETY_CATEGORIES.length
    || CREATION_SAFETY_CATEGORIES.some(key => !['block', 'manual-review', 'allow-and-review'].includes(String(categories[key]))
      || categories[key] === 'allow-and-review' && key !== 'controversial-identity' && key !== 'portrait-provenance')
    || categories['extremist-impersonation'] !== 'block') {
    throw new CreationSafetyError('Creation safety policy is unavailable.', 503);
  }
  return hash(JSON.stringify({ version: policy.version,
    categories: CREATION_SAFETY_CATEGORIES.map(key => [key, categories[key]]) }));
}

export function creationSafetyBinding(candidate: CreationCandidate, policy: CreationSafetyPolicy): CreationSafetyBinding {
  return { digest: creationContentDigest(candidate), policyVersion: policy.version, policyDigest: creationPolicyDigest(policy) };
}

export function sameCreationBinding(a: CreationSafetyBinding, b: CreationSafetyBinding): boolean {
  return a.digest === b.digest && a.policyVersion === b.policyVersion && a.policyDigest === b.policyDigest;
}

/** Only completed evidence with exclusively low-risk findings may allow use with follow-up. */
export function evaluateCreationReview(result: unknown, policy: CreationSafetyPolicy): {
  status: Exclude<CreationSafetyStatus, 'pending'>; categories: CreationSafetyCategory[];
} {
  creationPolicyDigest(policy);
  const findings = object(object(result)?.findings);
  if (!findings || Object.keys(findings).length !== CREATION_SAFETY_CATEGORIES.length
    || CREATION_SAFETY_CATEGORIES.some(key => !['clear', 'violation', 'uncertain'].includes(String(findings[key])))) {
    return { status: 'manual-review', categories: [] };
  }
  const categories = CREATION_SAFETY_CATEGORIES.filter(key => findings[key] !== 'clear');
  if (categories.some(key => findings[key] === 'violation' && policy.categories[key] === 'block')) {
    return { status: 'blocked', categories };
  }
  return { status: categories.some(key => policy.categories[key] !== 'allow-and-review') ? 'manual-review' : 'allowed', categories };
}
