import { readBody, type createAccountServer } from './account-server';
import { canonicalCreationCandidate, CreationSafetyError, type CanonicalCreationCandidate } from './creation-safety';
import type { CreationReviewRecord, CreationReviewStore } from './creation-review';
import type { CreationIdentity } from './creation-runtime';
import { accountSessionId } from './production-account-session';
import { isAllowedRequest } from './request-origin';

type Options = { accounts: Pick<ReturnType<typeof createAccountServer>, 'resolveIdentity'>; enabled(): boolean;
  store(identity: CreationIdentity): CreationReviewStore; publicOrigin?: string; trustedProxyHost?: string;
  prepare?(request: Request, candidate: CanonicalCreationCandidate): Promise<CanonicalCreationCandidate>;
  file?(record: CreationReviewRecord): Promise<Response> };
const json = (data: object, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
const view = (record: CreationReviewRecord | null) => record && ({ reviewId: record.reviewId, digest: record.digest, policyVersion: record.policyVersion,
  policyDigest: record.policyDigest, status: record.status, reason: record.reason, categories: record.categories, ...(record.issue ? { issue: record.issue } : {}) });
export function createCreationApi(options: Options) {
  async function authority(request: Request, admin = false) {
    if (!options.enabled()) throw new CreationSafetyError('Creation safety is not enabled.', 503);
    if (!isAllowedRequest(request, request.method !== 'GET', options.publicOrigin, options.trustedProxyHost)) throw new CreationSafetyError('Only same-origin requests are allowed.', 403);
    const identity = await options.accounts.resolveIdentity(request);
    if (!identity || !await identity.isCurrent() || admin && identity.owner.role !== 'admin') throw new CreationSafetyError(admin ? 'Admin access is required.' : 'Sign in to continue.', 403);
    return { store: options.store(identity), actor: { uid: identity.owner.uid, accountSessionId: identity.accountSessionId ?? accountSessionId(identity.cookie) } };
  }
  const failure = (error: unknown) => json({ error: error instanceof CreationSafetyError ? error.message : 'Safety review is unavailable.' }, error instanceof CreationSafetyError ? error.status : 503);
  return {
    async GET(request: Request) {
      if (!options.enabled()) return json({ enabled: false, review: null });
      try { const { store, actor } = await authority(request); const record = await store.get(actor);
        return json({ enabled: true, review: record && { ...view(record), candidate: record.candidate } }); } catch (error) { return failure(error); }
    },
    async POST(request: Request) {
      try {
        const { store, actor } = await authority(request);
        const body = await readBody(request, 256 * 1024);
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'candidate')) throw new CreationSafetyError('Invalid review request.', 400);
        let candidate = canonicalCreationCandidate(body.candidate);
        if (candidate.document) throw new CreationSafetyError('Documents must be reviewed through their authorized Knowledge upload.', 400);
        if (options.prepare) candidate = await options.prepare(request, candidate);
        const result = await store.request(actor, candidate);
        const record = result.needsReview ? await store.runReview(result.record) : result.record;
        return json({ enabled: true, review: view(record) });
      } catch (error) { return failure(error); }
    },
    async adminGET(request: Request) {
      try { const { store, actor } = await authority(request, true); return json({ reviews: await store.listManual(actor) }); } catch (error) { return failure(error); }
    },
    async adminPOST(request: Request) {
      try {
        const { store, actor } = await authority(request, true);
        const body = await readBody(request);
        if (Object.keys(body).sort().join(',') !== 'decision,digest,ownerUid,policyDigest,policyVersion,reviewId') throw new CreationSafetyError('Invalid decision request.', 400);
        const record = await store.decide(actor, body as unknown as Parameters<CreationReviewStore['decide']>[1]);
        return json({ review: view(record) });
      } catch (error) { return failure(error); }
    },
    async adminFileGET(request: Request, id: string) {
      try {
        const { store, actor } = await authority(request, true);
        const record = await store.getForAdmin(actor, id);
        if (!record.candidate.document || !options.file) throw new CreationSafetyError('This review has no document.', 404);
        return await options.file(record);
      } catch (error) { return failure(error); }
    },
  };
}
