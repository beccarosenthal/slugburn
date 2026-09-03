// Headless runner. Requires Node 18+ (nothing else) and is not needed to run
// the suite — tests.html runs the same tests in the browser.
//
//   node tests/run.js

import { run } from './index.js';

const { results, summary } = run();

let lastSuite = null;
for (const r of results) {
  if (r.suite !== lastSuite) {
    console.log(`\n  ${r.suite}`);
    lastSuite = r.suite;
  }
  console.log(`    ${r.ok ? '✓' : '✗'} ${r.name}${r.ms > 40 ? ` (${r.ms}ms)` : ''}`);
  if (!r.ok) console.log(`        ${r.error.message}`);
}

console.log(
  `\n  ${summary.passed}/${summary.total} passed` +
  (summary.failed ? `, ${summary.failed} failed` : '') +
  ` in ${summary.ms}ms\n`,
);

process.exit(summary.failed ? 1 : 0);
