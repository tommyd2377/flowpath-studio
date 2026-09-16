import './check-node.mjs';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const groups = {
  templates: ['templates.spec.ts'],
  carousel: ['ai-carousel.spec.ts'],
  // Source imports create several sites. Give them fresh data rather than
  // exhausting the unchanged 12-site pilot cap in the runtime group.
  tasks: ['visitor-tasks.spec.ts'],
  ingestion: ['source-review.spec.ts', 'semantic-ingestion.spec.ts'],
  workspace: ['adaptive-workspace.spec.ts'],
  website: ['published-website.spec.ts', 'website-import.spec.ts'],
  brochure: ['brochure-review.spec.ts'],
  core: ['media.spec.ts', 'media-runtime.spec.ts', 'motion.spec.ts', 'platform.spec.ts', 'shared-reveal.spec.ts'],
  voice: ['visitor-realtime.spec.ts'],
  speed: ['visitor-speed.spec.ts'],
  quality: ['visitor-quality.spec.ts', 'studio-runtime.spec.ts'],
  search: ['search-explore.spec.ts'],
  billing: ['billing.spec.ts'],
};

function run(args) {
  const result = spawnSync(process.execPath, [cli, 'test', ...args], { cwd: project, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
if (args.length) {
  // Preserve focused Playwright selectors/options exactly, in a single invocation.
  run(args);
} else {
  const discovered = readdirSync(new URL('../tests/browser/', import.meta.url), { recursive: true })
    .filter(name => /\.spec\.[cm]?[jt]sx?$/.test(name)).sort();
  const grouped = Object.values(groups).flat().sort();
  if (JSON.stringify(discovered) !== JSON.stringify(grouped)) {
    console.error('Update scripts/test-browser.mjs so every browser spec belongs to exactly one isolated group.');
    process.exit(1);
  }
  for (const [name, files] of Object.entries(groups)) {
    console.log(`Running browser group: ${name}`);
    // Each new Playwright process creates its own server and temporary demo data.
    // Separate output directories retain artifacts from both successful groups.
    run([...files.map(file => `tests/browser/${file}`), `--output=test-results/platform/${name}`]);
  }
}
