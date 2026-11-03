# Multiple waveforms (local, unreleased)

Every admitted account, including ordinary accounts, can create, list, select and edit up to ten waveforms. A private draft and its published snapshot occupy one slot. No deletion, new access mode or automatic publication is introduced. Save or discard unsaved edits before switching; selection is carried in URLs rather than an account-global selection cookie, so tabs remain independent.

## Compatibility and atomic creation

The original `ownerWaveforms/{uid}` document and its stable ID remain in place. Additional records are separate `ownerWaveforms/{uid}/waveforms/{id}` documents. Creation reads and writes `ownerWaveformLists/{uid}` in the same Firestore transaction as the new record, active session and exact-version review check. Concurrent first/additional creates cannot exceed ten. Editing an existing waveform at the limit remains allowed. The small index contains additional IDs and the optional account-wide founder testing preference, keeping portraits and prompts in separate documents below Firestore document limits.

`GET /api/waveform` retains its original `waveform` property and adds owner-only `{id,name}` summaries and the limit. `?id=` selects a saved waveform. `PUT` edits; `POST` creates and requires a new-draft UUID nonce in `?id=`. Older PUT callers without an ID still update the first waveform. A new draft's UUID nonce is scoped to the authenticated UID on the server before becoming its stable UUID, preventing a caller from claiming another owner's address. New-draft review uses `?id=<nonce>&create=1`; saved review uses its stable ID. Browser status never grants approval.

Synthetic file storage reads either the legacy single record or a waveform array; a save atomically replaces the fixture file under the existing serialized writer. Reading never rewrites a legacy record. There is no cloud migration or deployment in this change. For a Firestore rollback, additional documents/indexes can remain in place; older code still sees the first waveform and ignores them. Synthetic fixture array files require the current reader; keep the full array when reverting fixture code.

## Isolation and safeguards

Knowledge management, refresh, search, selection and removal carry the selected waveform ID. New libraries use an owner-and-waveform key. An existing owner-keyed library is used only when its stored waveform ID matches, without moving or copying it. New document review bindings include the waveform ID; old exact bindings remain valid at their old location.

Persona review heads are scoped per waveform. Legacy unscoped heads remain readable as a fallback, exact content and policy digests still govern approval, and stored published versions retain their separately checked approval. Reviewing a second waveform does not stale the first. Revocation, owner checks and policy checks remain enforced.

Voice admission resolves the requested owner record transactionally. Daily usage, active conversation guards, review spending, wallets and the platform Knowledge storage guard retain their existing account/platform keys. Ten waveforms grant no extra allowance or admin role. Founder testing follows one account-wide preference and still requires verified founder authority. Existing and new owned waveforms inherit it; legacy first-waveform values remain a read-only fallback until the next ordinary save materializes account metadata. The curated public demonstration keeps its separately approved pinned source and visitor limits.

## Verification

Use Node.js 24. Run `npm run check`, `npm run test:browser` and `npm run test:browser:paid` from a source-only test copy with existing dependencies, no private environment files, and live providers disabled. Tests use synthetic identities, transactional in-memory databases, fixture Knowledge and isolated browser profiles. The browser suite covers ordinary-user creation, independent settings/plugins, unsaved-edit protection, selected Knowledge, persisted selection, mobile width and a rejected eleventh creation. Unit coverage includes concurrent cap enforcement in both adapters, legacy settings/Knowledge compatibility, ownership rejection, review independence, publication isolation and shared UID allowances.

These are mocked/local checks. Real accounts, hosted Firestore, document processing and live voice remain manual acceptance after separate authorization; no live paid call, cloud change or deployment is authorized here.

### October 30 local evidence

Baseline: clean `001ed14` on `codex/hosted-tester-demo`. Checked using Node 24.6.0 in an isolated source copy without private environment/runtime files.

- `npm run check`: lint, typecheck, all 445 source tests and production build passed.
- `npm run test:browser`: 110 cases passed; five old link assertions expected unscoped settings/Knowledge URLs. After updating those assertions, the focused rerun passed all five, covering 115 unique mocked browser cases in total. The new multi-waveform ordinary-user scenario passed in the full run.
- `npm run test:browser:paid`: all eight fully synthetic publication/payment-preview cases passed.

No real account, live provider, hosted database, payment service or deployed runtime was tested. No cloud migration, configuration change or deployment was performed.
