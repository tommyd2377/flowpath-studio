# Local prototype boundaries

The session route accepts same-origin loopback HTTP requests only. Live access is disabled by default and in production. Before any paid test, obtain explicit authorization for this application, host, task and budget.

The local controller admits one session, up to three starts per minute and at most three provider starts across the whole process, including failed starts. It caps created sessions at 180 seconds and requires confirmed sideband closure before allowing another paid start. An uncertain creation/cleanup blocks further starts. These are single-process development guards, not public trial/account entitlements. Restarting does not grant authorization for additional paid tests.

No audio/transcripts are stored or logged. Provider IDs and credentials stay server-side. Owner accounts, public quotas and payment handling are future milestones. Private Studio data/credentials and existing deployment files remain untouched.
