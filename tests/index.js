// Single entry point that registers every suite and runs them.
// Imported by tests.html in the browser, and by tests/run.js under Node.

import './state.test.js';
import './ai.test.js';
import './integration.test.js';

import { runAll, summarize } from './harness.js';

export function run() {
  const results = runAll();
  return { results, summary: summarize(results) };
}
