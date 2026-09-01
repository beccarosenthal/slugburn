// Unit tests for the pure game core. No browser, no canvas, no timers.

import { suite, test, assert, eq, notEq, deepEq } from './harness.js';
import { scenario, get, row } from './helpers.js';
import { createGame, startPlaying, queueTurn, step, outcomeText, cellKey } from '../src/state.js';

suite('createGame', () => {
  test('starts two live slugs facing each other', () => {
    const s = createGame({ cols: 40, rows: 20 });
    eq(s.slugs.length, 2);
    assert(s.slugs.every((x) => x.alive), 'both slugs should start alive');
    eq(s.slugs[0].dir, 'right');
    eq(s.slugs[1].dir, 'left');
  });

  test('starts on different rows so a straight run is not an instant draw', () => {
    const s = createGame({ cols: 40, rows: 20 });
    notEq(s.slugs[0].head.y, s.slugs[1].head.y);
  });

  test('opens in countdown, not playing', () => {
    eq(createGame().phase, 'countdown');
    eq(startPlaying(createGame()).phase, 'playing');
  });
});

suite('queueTurn', () => {
  const facingRight = () =>
    scenario({ slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right' }] });

  test('accepts a perpendicular turn', () => {
    const after = queueTurn(facingRight(), 'p1', 'up');
    eq(get(after, 'p1').pending, 'up');
  });

  test('rejects an immediate reversal', () => {
    const after = queueTurn(facingRight(), 'p1', 'left');
    eq(get(after, 'p1').pending, 'right', 'a 180 must not reach pending');
  });

  // The bug this guards against: if legality were checked against `pending`
  // instead of the committed `dir`, then right -> queue "up" -> queue "left"
  // would pass (left is perpendicular to up) and the slug would reverse into
  // its own neck. Mashing two keys inside one tick is easy to do by accident.
  test('rejects a reversal even when another turn is already buffered', () => {
    let s = facingRight();
    s = queueTurn(s, 'p1', 'up');
    s = queueTurn(s, 'p1', 'left');
    eq(get(s, 'p1').pending, 'up', 'the illegal second turn must not overwrite the legal one');
  });

  test('ignores unknown directions', () => {
    const after = queueTurn(facingRight(), 'p1', 'sideways');
    eq(get(after, 'p1').pending, 'right');
  });

  test('ignores dead slugs', () => {
    const s = scenario({ slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right', alive: false }] });
    eq(get(queueTurn(s, 'p1', 'up'), 'p1').pending, 'right');
  });

  test('returns a new state rather than mutating', () => {
    const before = facingRight();
    const after = queueTurn(before, 'p1', 'up');
    notEq(after, before, 'should return a fresh state object');
    eq(get(before, 'p1').pending, 'right', 'the original state must be untouched');
  });
});

suite('step — movement', () => {
  test('advances one cell per tick', () => {
    const s = step(scenario({ slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right' }] }));
    deepEq(get(s, 'p1').head, { x: 6, y: 5 });
    eq(s.tick, 1);
  });

  test('leaves the vacated cell behind as trail', () => {
    const s = step(scenario({ slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right' }] }));
    const p1 = get(s, 'p1');
    eq(p1.path.length, 2);
    assert(p1.occupied.has(cellKey(5, 5)), 'the old head cell should still be lethal');
    assert(p1.occupied.has(cellKey(6, 5)), 'the new head cell should be lethal too');
  });

  test('commits the buffered turn', () => {
    let s = scenario({ slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right' }] });
    s = step(queueTurn(s, 'p1', 'down'));
    eq(get(s, 'p1').dir, 'down');
    deepEq(get(s, 'p1').head, { x: 5, y: 6 });
  });

  test('does nothing unless the game is playing', () => {
    const s = scenario({ phase: 'countdown', slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right' }] });
    eq(step(s), s, 'a non-playing state should be returned unchanged');
  });

  test('is pure — same input, same output, original untouched', () => {
    const before = scenario({ slugs: [{ id: 'p1', head: { x: 5, y: 5 }, dir: 'right' }] });
    const a = step(before);
    const b = step(before);
    deepEq(get(a, 'p1').head, get(b, 'p1').head);
    deepEq(get(before, 'p1').head, { x: 5, y: 5 }, 'stepping must not mutate its input');
    eq(before.tick, 0);
  });
});

suite('step — collisions', () => {
  const walls = [
    ['left', { x: 0, y: 5 }],
    ['right', { x: 19, y: 5 }],
    ['up', { x: 5, y: 0 }],
    ['down', { x: 5, y: 11 }],
  ];

  for (const [dir, head] of walls) {
    test(`dies driving into the ${dir} wall`, () => {
      const s = step(scenario({ slugs: [{ id: 'p1', head, dir }] }));
      assert(!get(s, 'p1').alive, `should have died going ${dir}`);
      eq(s.phase, 'over');
    });
  }

  test('dies on its own trail', () => {
    // A tight clockwise loop that closes on itself: the slug is one cell from
    // re-entering the square it already drew.
    const s = scenario({
      slugs: [{
        id: 'p1',
        head: { x: 5, y: 6 },
        dir: 'up',
        path: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 7 }, { x: 5, y: 6 }],
      }],
    });
    assert(!get(step(s), 'p1').alive, 'should have died on its own trail');
  });

  test('dies on the opponent trail', () => {
    const s = scenario({
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
        { id: 'p2', head: { x: 6, y: 8 }, dir: 'right', path: row(8, 3, 6).concat([{ x: 6, y: 5 }]) },
      ],
    });
    const after = step(s);
    assert(!get(after, 'p1').alive, 'p1 drove into p2 trail and should be dead');
  });

  // The ordering test. If deaths were resolved slug-by-slug with moves
  // committed as we go, whichever slug happened to be checked first would
  // "win" a head-on. Resolving all next positions before committing any move
  // is what makes this a draw.
  test('a head-on into the same cell is a draw, not a win for either', () => {
    const s = step(scenario({
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
        { id: 'p2', head: { x: 7, y: 5 }, dir: 'left' },
      ],
    }));
    assert(!get(s, 'p1').alive && !get(s, 'p2').alive, 'both should die');
    eq(s.winner, 'draw');
    eq(outcomeText(s), 'DRAW');
  });

  // Two adjacent slugs moving into each other's cell. Neither lands on the
  // same cell as the other, so the head-on rule does not fire — this is caught
  // only because cells the heads are vacating stay lethal for the tick.
  test('two slugs cannot swap through each other', () => {
    const s = step(scenario({
      slugs: [
        { id: 'p1', head: { x: 5, y: 5 }, dir: 'right' },
        { id: 'p2', head: { x: 6, y: 5 }, dir: 'left' },
      ],
    }));
    assert(!get(s, 'p1').alive && !get(s, 'p2').alive, 'swapping places must not be survivable');
    eq(s.winner, 'draw');
  });

  test('the survivor wins when the other slug dies', () => {
    const s = step(scenario({
      slugs: [
        { id: 'p1', head: { x: 0, y: 5 }, dir: 'left' },  // into the wall
        { id: 'p2', head: { x: 10, y: 8 }, dir: 'right' }, // clear road
      ],
    }));
    eq(s.winner, 'p2');
    eq(s.phase, 'over');
    assert(get(s, 'p2').alive);
  });

  test('records where a slug died, for the explosion', () => {
    const s = step(scenario({ slugs: [{ id: 'p1', head: { x: 0, y: 5 }, dir: 'left' }] }));
    deepEq(get(s, 'p1').deathAt, { x: -1, y: 5 });
  });
});

suite('outcomeText', () => {
  test('is empty while the game is still running', () => {
    eq(outcomeText(startPlaying(createGame())), '');
  });

  test('names the winner', () => {
    const s = step(scenario({
      slugs: [
        { id: 'p1', name: 'Cyan', head: { x: 0, y: 5 }, dir: 'left' },
        { id: 'p2', name: 'Magenta', head: { x: 10, y: 8 }, dir: 'right' },
      ],
    }));
    eq(outcomeText(s), 'MAGENTA WINS');
  });
});
