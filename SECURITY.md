# Voice and account boundaries

Local sessions accept same-origin loopback HTTP requests only and live access is disabled by default. Personal Firebase waveforms require an explicit HTTPS origin, verified server cookies, active invitation membership, durable admission and a configured independent deadline. Before any paid test, obtain explicit authorization for this application, host, task and budget.

The explicitly enabled homepage demo uses a separate opaque visitor cookie, not Firebase account authority. Its 180-second reservations and pre-cancellations share global limits; private waveform access still requires the invited owner. Browser cookie resets can change visitor identity, so the shared global limit is the spending bound. Visitor hashes are stored only for usage and lifecycle control; no prompt, transcript or audio is logged.

The local controller admits one session, up to three starts per minute and at most three provider starts across the whole process, including failed starts. Its normal conversation cap is 15 minutes. Restarting does not grant authorization for additional paid tests.

Public admission uses Firestore transactions to reserve a full 900 seconds per attempt and enforce per-member/global daily bounds and concurrency. It atomically checks the active application session. Early endings and failed attempts do not refund reservations. UTC date changes reset the daily allowance but never release an unconfirmed active session. Account changes block admission before confirmed cleanup, and settings writes recheck authority within their transaction.

Cloud Tasks schedules authenticated closure before provider creation; the server also keeps its normal timer and sideband connection. Queue delivery can be late. Unknown creation or unconfirmed finalization keeps admission blocked; it is not a guarantee that a provider session whose identifier was never received has stopped. No automatic paid creation retries are performed. The queue must use finite closure retries. See [launch configuration](docs/firebase-launch.md).

Invitation codes are single-use, random and stored only as hashes in Firestore. Private plaintext batches are Git-ignored and excluded from source deployment. Google and verified password identities receive application access only after invitation redemption. A Firebase identity may exist before redemption, but it cannot read settings or start paid voice. Firestore browser access remains denied; only owner-checked server routes use Admin SDK.

No audio/transcripts are stored or logged. Provider IDs, session-cookie values and credentials stay server-side; only cookie hashes are persisted as application-session identifiers. News, Studio's archive and private runtime data remain separate. Customer billing is outside this milestone.
