// A minimal test harness.
//
// The project has no dependencies and no build step, and the game logic is
// plain ESM with no browser APIs — so tests run identically in a browser tab
// and in Node. Pulling in a test framework would add the only toolchain in the
// repo to check a few hundred assertions.

const tests = [];
let currentSuite = 'general';

export function suite(name, body) {
  const previous = currentSuite;
  currentSuite = name;
  body();
  currentSuite = previous;
}

export function test(name, fn) {
  tests.push({ suite: currentSuite, name, fn });
}

// --- assertions -------------------------------------------------------------

export function assert(condition, message = 'expected condition to hold') {
  if (!condition) throw new Error(message);
}

export function eq(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(message ?? `expected ${format(expected)}, got ${format(actual)}`);
  }
}

export function notEq(actual, forbidden, message) {
  if (Object.is(actual, forbidden)) {
    throw new Error(message ?? `expected anything but ${format(forbidden)}`);
  }
}

export function deepEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `expected ${b}, got ${a}`);
}

export function includes(list, value, message) {
  if (!list.includes(value)) {
    throw new Error(message ?? `expected ${format(list)} to include ${format(value)}`);
  }
}

function format(value) {
  if (typeof value === 'string') return `"${value}"`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// --- running ----------------------------------------------------------------

export function runAll() {
  const results = [];
  for (const t of tests) {
    const startedAt = Date.now();
    try {
      t.fn();
      results.push({ ...t, ok: true, ms: Date.now() - startedAt });
    } catch (error) {
      results.push({ ...t, ok: false, ms: Date.now() - startedAt, error });
    }
  }
  return results;
}

export function summarize(results) {
  const failed = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    ms: results.reduce((sum, r) => sum + r.ms, 0),
  };
}
