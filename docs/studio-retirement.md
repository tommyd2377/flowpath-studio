# Studio retirement — October 13, 2026

The active Studio source was retired after a complete source recovery was verified. The local archive is archives/studio-2026-10-13, excluded from Git. Preserve it separately when moving this checkout to another machine.

The archive contains source.tar.gz, history.bundle, manifest.json, git-status-before.txt, verification.json and restore instructions. All 1,540 present source files, including uncommitted/untracked work, matched SHA-256 hashes in both the original working tree and an isolated restore. The Git bundle and restored Git object connectivity were verified. No absent tracked source paths were found.

The source baseline was ca66533e77066ae03d0d7f00da7cddeb10730448; existing work was carried to the local codex/simple-waveform branch before archiving. At the initial archive checkpoint no commits, pushes or shared history changes were made.

The previously uncommitted Studio source was subsequently committed on the separate local archive/studio-2026-10-13 branch as c196226b3b4fa954993838a9f75fddfaf2bf4e6a. All 1,540 committed source files were checked against the original manifest. The additional studio-snapshot.bundle and git-snapshot.json provide a self-contained committed recovery path. Original verified archive files remain unchanged. The active waveform branch continues with normal commits; no history was rewritten.

Credentials, private data, visitor recordings, machine configuration and generated outputs were not included in the source recovery files. Private data and credentials remain untouched at the original location. Old generated Next/package outputs were moved aside separately inside the archive directory to prevent stale build types from entering the new application. This archive preserves source recovery; it does not back up private application data.

News removed its sibling byte-comparison test and updated its independent runtime ownership documentation. Its runtime, hostname and deployment settings were unchanged.

Review on January 11, 2027 (90 days). No deletion or reminder is scheduled. Record any renewed Studio use and reconsider the review date before deleting anything. Restore only into a separate directory, using the archive's instructions.
