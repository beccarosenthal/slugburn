// Integration tests: complete games, played headlessly through the same
// driveAI + step path the browser loop uses. Nothing here knows about canvas,
// requestAnimationFrame, or the DOM.

import { suite, test, assert, eq, includes } from './harness.js';
import { playGame, checkHistory, get } from './helpers.js';

const SMALL = { cols: 24, rows: 16, maxTicks: 1200 };

suite('a full game', () => {
  test('always terminates with a valid outcome', () => {
    const { state, hitCap } = playGame('cartographer', 'hugger', SMALL);
    assert(!hitCap, 'game ran to the tick cap instead of ending');
    eq(state.phase, 'over');
    includes(['p1', 'p2', 'draw'], state.winner);
  });

  test('ends the moment a slug dies — never leaves two winners', () => {
    const { state } = playGame('strategist', 'cautious', SMALL);
    const alive = state.slugs.filter((s) => s.alive);
    if (state.winner === 'draw') eq(alive.length, 0);
    else eq(alive.length, 1);
  });

  test('the reported winner is the slug still standing', () => {
    const { state } = playGame('cartographer', 'drunk', SMALL);
    if (state.winner !== 'draw') {
      assert(get(state, state.winner).alive, 'the winner should be alive');
    }
  });
});

suite('invariants hold across every tick', () => {
  // The strong test. Rather than asserting one outcome, this replays a whole
  // game and checks the rules of the board at every single tick: trails never
  // overlap, nothing leaves the arena, no slug revisits a cell, no slug ever
  // reverses. A collision bug anywhere shows up here as a named violation.
  const matchups = [
    ['strategist', 'cartographer'],
    ['cartographer', 'hugger'],
    ['hugger', 'cautious'],
    ['cautious', 'drunk'],
  ];

  for (const [a, b] of matchups) {
    test(`${a} vs ${b}`, () => {
      const { history } = playGame(a, b, SMALL);
      checkHistory(history);
    });
  }
});

suite('the AI ladder actually ranks', () => {
  // Statistical, because three algorithms make random choices. The margin is
  // deliberately loose — this is a smoke test that lookahead beats no
  // lookahead, not a benchmark.
  test('Strategist beats Drunk in the large majority of games', () => {
    const games = 15;
    let strategistWins = 0;
    for (let i = 0; i < games; i++) {
      const { state } = playGame('strategist', 'drunk', SMALL);
      if (state.winner === 'p1') strategistWins++;
    }
    assert(
      strategistWins >= games * 0.8,
      `expected Strategist to win at least 80% of ${games} games, won ${strategistWins}`,
    );
  });

  test('sighted algorithms outlive Drunk', () => {
    const drunkLife = averageTicks('drunk', 'drunk', 12);
    const smartLife = averageTicks('cartographer', 'cartographer', 3);
    assert(
      smartLife > drunkLife * 2,
      `expected Cartographer games (${smartLife.toFixed(1)} ticks) to last much longer than Drunk games (${drunkLife.toFixed(1)})`,
    );
  });

  function averageTicks(a, b, games) {
    let total = 0;
    for (let i = 0; i < games; i++) total += playGame(a, b, SMALL).ticks;
    return total / games;
  }
});

suite('determinism', () => {
  // The two deterministic algorithms should replay identically. This is the
  // guarantee that makes step() debuggable: a reported bug can be reproduced
  // exactly rather than hunted for.
  test('a Cartographer vs Strategist game replays identically', () => {
    const a = playGame('cartographer', 'strategist', SMALL);
    const b = playGame('cartographer', 'strategist', SMALL);
    eq(a.ticks, b.ticks, 'same matchup should take the same number of ticks');
    eq(a.state.winner, b.state.winner);
    eq(
      JSON.stringify(a.state.slugs.map((s) => s.path)),
      JSON.stringify(b.state.slugs.map((s) => s.path)),
      'both slugs should trace identical trails',
    );
  });
});
