import './check-node.mjs';
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Development-only routes need a development build. A disposable source copy
// avoids taking the main server's .next/dev lock or using its credentials/data.
const snapshot = mkdtempSync(join(tmpdir(), 'flowpath-recorder-browser-'));
try {
  for (const file of ['app', 'components', 'lib', 'public', 'packages', 'fixtures', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs']) {
    if (existsSync(file)) cpSync(file, join(snapshot, file), { recursive: true, filter: path => !path.split('/').includes('node_modules') });
  }
  symlinkSync(join(process.cwd(), 'node_modules'), join(snapshot, 'node_modules'), 'dir');
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const result = spawnSync(process.execPath, [cli, 'test', '--config=playwright.recorder.config.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, FLOWPATH_RECORDER_TEST_ROOT: snapshot } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(snapshot, { recursive: true, force: true }); }
