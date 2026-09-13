import './check-node.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// No .env loading: browser tests use the isolated demo server and fake providers.
const unitOnly = process.argv.includes('--unit-only');
if (process.argv.slice(2).some(arg => arg !== '--unit-only')) throw new Error('Usage: node scripts/test-visitor-qa.mjs [--unit-only]');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'flowpath-visitor-qa-'));
const steps = [
  ['Shared package', ['node_modules/typescript/bin/tsc', '-p', 'packages/platform-ui/tsconfig.json']],
  ['Package assets', ['packages/platform-ui/build.mjs']],
  ['Startup, context and answers', ['--conditions=react-server', '--import', 'tsx', '--test', 'tests/visitor-diagnostics.test.ts', 'tests/visitor-realtime-session.test.ts', 'tests/visitor-realtime-control.test.ts', 'tests/visitor-realtime-client.test.ts']],
  ['Search, navigation and capacity', ['--conditions=react-server', '--import', 'tsx', '--test', 'tests/search-workspace.test.ts', 'tests/explore-voice.test.ts', 'tests/home-browse.test.ts', 'tests/adaptive-workspace.test.ts']],
  ...(!unitOnly ? [
    ['Production build', ['node_modules/next/dist/bin/next', 'build']],
    ['Voice browser lifecycle', ['scripts/test-browser.mjs', 'tests/browser/visitor-realtime.spec.ts']],
    ['Voice and chat browser quality', ['scripts/test-browser.mjs', 'tests/browser/visitor-quality.spec.ts']],
    ['Search browser', ['scripts/test-browser.mjs', 'tests/browser/search-explore.spec.ts']],
    ['Workspace browser', ['scripts/test-browser.mjs', 'tests/browser/adaptive-workspace.spec.ts']],
    ['Website browser', ['scripts/test-browser.mjs', 'tests/browser/published-website.spec.ts']],
  ] : []),
];
const results = [];
for (const [name, args] of steps) {
  console.log(`Checking: ${name}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, ...(args.includes('--test') ? { NODE_ENV: 'test' } : {}) } });
  const log = join(output, `${results.length + 1}.log`);
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`);
  results.push({ name, passed: result.status === 0, durationMs: Date.now() - start, log });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'}: ${name} (${log})`);
  if (result.status !== 0) break;
}
const report = { scope: 'Synthetic/offline. Does not evaluate live model decisions, real microphone or speaker latency.', completed: results.length === steps.length && results.every(item => item.passed), results };
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Report: ${join(output, 'report.json')}`);
if (!report.completed) process.exitCode = 1;
