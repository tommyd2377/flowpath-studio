import './check-node.mjs';
import { readFileSync } from 'node:fs';
import { sanitizeVisitorDiagnostic } from '../lib/visitor-diagnostics.ts';

const file = process.argv[2];
if (!file || process.argv.length !== 3) throw new Error('Usage: node scripts/summarize-visitor-diagnostics.mjs /path/to/local-server.log');
const events = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const marker = line.indexOf('[flowpath:visitor] ');
  if (marker < 0) continue;
  try {
    const parsed = JSON.parse(line.slice(marker + '[flowpath:visitor] '.length));
    const event = sanitizeVisitorDiagnostic(parsed, Number.isFinite(parsed.at) ? parsed.at : 0);
    if (event) events.push(event);
  } catch { /* Ignore unrelated or incomplete lines, never echo their contents. */ }
}
const groups = new Map();
for (const event of events) {
  const key = `${event.channel}/${event.stage}/${event.status}`;
  const group = groups.get(key) ?? { count: 0, durations: [] };
  group.count++; if (event.durationMs !== undefined) group.durations.push(event.durationMs);
  groups.set(key, group);
}
console.log(JSON.stringify({ events: events.length, traces: new Set(events.map(event => event.traceId)).size,
  note: 'Startup durations are cumulative from start on each side; browser/server clocks have separate origins. Backend/search durations measure the operation. Percentiles need repeated real runs, not a single trace.',
  groups: [...groups].map(([stage, group]) => {
    const sorted = group.durations.sort((a, b) => a - b);
    const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
    return { stage, count: group.count, p50Ms: percentile(.5), p95Ms: percentile(.95) };
  }), failures: events.filter(event => event.status === 'failed'),
}, null, 2));
