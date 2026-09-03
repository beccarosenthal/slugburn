// Unit tests for the opponents. These assert the *properties* each algorithm
// claims — never an exact move, which would break the moment a heuristic is
// tuned.

import { suite, test, assert, eq, includes } from './harness.js';
import { scenario, get, row, makeRng } from './helpers.js';
import { ALGORITHMS, byId, driveAI } from '../src/ai.js';
import { DIRS, step } from '../src/state.js';

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const SIGHTED = ['cautious', 'hugger', 'cartographer', 'strategist'];

// A slug at (5,5) heading right, with an opponent parked well out of the way.
function open() {
  return scenario({
    cols: 20,
    rows: 12,
    slugs: [
      { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
      { id: 'p2', head: { x: 18, y: 1 }, dir: 'left' },
    ],
  });
}

suite('every algorithm', () => {
  for (const algo of ALGORITHMS) {
    test(`${algo.name} returns a real direction`, () => {
      const s = open();
      includes(Object.keys(DIRS), algo.pick(s, get(s, 'p1'), get(s, 'p2')));
    });

    test(`${algo.name} never tries to reverse`, () => {
      // Sampled, because three of the five make random choices.
      for (let i = 0; i < 40; i++) {
        const s = open();
        const dir = algo.pick(s, get(s, 'p1'), get(s, 'p2'));
        assert(dir !== OPPOSITE['right'], `${algo.name} attempted a 180`);
      }
    });

    test(`${algo.name} has a name and an explanation for the UI`, () => {
      assert(algo.id && algo.name && algo.blurb, `${algo.id} is missing metadata`);
    });
  }
});

suite('sighted algorithms avoid immediate death', () => {
  // A corridor with exactly one way out: walls above and below, trail behind.
  // Anything that looks even one cell ahead must turn down.
  function corridor() {
    return scenario({
      cols: 20,
      rows: 12,
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right', path: [{ x: 4, y: 5 }, { x: 5, y: 5 }] },
        { id: 'p2', head: { x: 6, y: 5 }, dir: 'up', path: row(4, 5, 10).concat([{ x: 6, y: 5 }]) },
      ],
    });
  }

  for (const id of SIGHTED) {
    test(`${byId(id).name} takes the only safe exit`, () => {
      const s = corridor();
      // Blocked: right by p2's head, up by p2's trail, left is a reversal.
      eq(byId(id).pick(s, get(s, 'p1'), get(s, 'p2')), 'down');
    });
  }

  // Play an empty board for 30 ticks under a known seed. Deterministic, so a
  // failure is reproducible from the seed rather than a coin flip.
  function survives(id, seed, ticks = 30) {
    const rng = makeRng(seed);
    let s = open();
    for (let i = 0; i < ticks && s.phase === 'playing'; i++) {
      s = driveAI(s, { p1: id, p2: id }, rng);
      s = step(s);
    }
    return get(s, 'p1').alive;
  }

  // The space-aware three see the whole reachable region, so surviving an open
  // board is a guarantee, not a tendency. One seed is enough to pin it.
  for (const id of ['hugger', 'cartographer', 'strategist']) {
    test(`${byId(id).name} survives 30 ticks of an empty board`, () => {
      assert(survives(id, 1), `${id} died on an open board`);
    });
  }

  // Cautious is deliberately not in that loop. It looks exactly one cell ahead,
  // so it genuinely does wander into a dead end sometimes — that weakness is
  // the whole reason Cartographer exists. Asserting it *always* survives is
  // what made this suite fail roughly one run in six; over a fixed seed set the
  // rate is stable, so the test can state the real property instead.
  test('Cautious survives 30 ticks under most seeds', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const lived = seeds.filter((seed) => survives('cautious', seed));
    assert(
      lived.length >= 14,
      `expected Cautious to survive most of ${seeds.length} seeded runs, survived ${lived.length}`,
    );
  });
});

suite('space-aware algorithms', () => {
  // (5,4) is a sealed one-cell pocket: walled north, west and east by p2's
  // trail, and south by p1's own head. Stepping up is safe for exactly one
  // tick and then fatal.
  function pocket() {
    return scenario({
      cols: 20,
      rows: 12,
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
        {
          id: 'p2',
          head: { x: 6, y: 4 },
          dir: 'up',
          path: [{ x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }, { x: 4, y: 4 }, { x: 6, y: 4 }],
        },
      ],
    });
  }

  // This is the whole point of flood fill: one-cell lookahead calls the pocket
  // safe, because it only dies on the tick *after* the one being evaluated.
  for (const id of ['cartographer', 'strategist']) {
    test(`${byId(id).name} refuses a dead-end pocket`, () => {
      const s = pocket();
      assert(
        byId(id).pick(s, get(s, 'p1'), get(s, 'p2')) !== 'up',
        `${id} walked into a one-cell pocket`,
      );
    });
  }

  test('Strategist still plays sensibly with a dead opponent', () => {
    const s = scenario({
      cols: 20,
      rows: 12,
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
        { id: 'p2', head: { x: 18, y: 1 }, dir: 'left', alive: false },
      ],
    });
    includes(Object.keys(DIRS), byId('strategist').pick(s, get(s, 'p1'), get(s, 'p2')));
  });
});

suite('driveAI', () => {
  test('leaves human seats alone', () => {
    const s = open();
    const after = driveAI(s, { p1: 'human', p2: 'human' });
    eq(get(after, 'p1').pending, 'right');
    eq(get(after, 'p2').pending, 'left');
  });

  test('drives only the AI seat in a mixed game', () => {
    const s = corridorish();
    const after = driveAI(s, { p1: 'human', p2: 'cartographer' });
    eq(get(after, 'p1').pending, 'right', 'the human seat must not be touched');
  });

  test('skips dead slugs', () => {
    const s = scenario({
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right', alive: false },
        { id: 'p2', head: { x: 15, y: 8 }, dir: 'left' },
      ],
    });
    eq(get(driveAI(s, { p1: 'strategist', p2: 'strategist' }), 'p1').pending, 'right');
  });

  function corridorish() {
    return scenario({
      cols: 20,
      rows: 12,
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
        { id: 'p2', head: { x: 15, y: 8 }, dir: 'left' },
      ],
    });
  }
});
