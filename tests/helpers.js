// Shared test fixtures: hand-built board positions, a headless game runner,
// and the invariant checks used by the integration tests.

import { cellKey, createGame, startPlaying, step } from '../src/state.js';
import { driveAI } from '../src/ai.js';

// Build an exact board position. Handy for collision tests, where the point is
// to place two slugs one cell apart rather than play a hundred ticks to get
// them there.
//
// Each slug spec is { id, head, dir, path?, alive? }. `path` defaults to just
// the head, and `occupied` is always derived from `path` so the two can't drift
// apart in a fixture.
export function scenario({ cols = 20, rows = 12, phase = 'playing', slugs }) {
  return {
    cols,
    rows,
    tick: 0,
    phase,
    winner: null,
    slugs: slugs.map((s) => {
      const path = s.path ?? [s.head];
      return {
        id: s.id,
        name: s.name ?? s.id,
        color: s.color ?? '#ffffff',
        dir: s.dir,
        pending: s.pending ?? s.dir,
        head: s.head,
        path,
        occupied: new Set(path.map((p) => cellKey(p.x, p.y))),
        alive: s.alive ?? true,
        deathAt: null,
      };
    }),
  };
}

export const get = (state, id) => state.slugs.find((s) => s.id === id);

// A horizontal run of cells, for building walls out of a slug's trail.
export function row(y, fromX, toX) {
  const cells = [];
  for (let x = fromX; x <= toX; x++) cells.push({ x, y });
  return cells;
}

// Play a complete game with no browser involved. Returns the final state, how
// many ticks it took, and every state along the way for invariant checking.
export function playGame(p1Algo, p2Algo, { cols = 24, rows = 16, maxTicks = 2000 } = {}) {
  const controllers = { p1: p1Algo, p2: p2Algo };
  let state = startPlaying(createGame({ cols, rows }));
  const history = [state];
  let ticks = 0;

  while (state.phase === 'playing' && ticks < maxTicks) {
    state = driveAI(state, controllers);
    state = step(state);
    history.push(state);
    ticks++;
  }

  return { state, ticks, history, hitCap: ticks >= maxTicks };
}

const OPPOSITE_DELTA = (a, b) => a.x === b.x && a.y === b.y;

// Everything that must be true of any legal board, at any tick. Throws with a
// specific message rather than returning false, so a failure names the rule it
// broke instead of just failing an assertion.
export function checkInvariants(state) {
  const seenAcrossSlugs = new Set();

  for (const s of state.slugs) {
    // The Set and the array are two views of the same trail. If they disagree,
    // the slug revisited a cell — which collision detection should have caught.
    if (s.path.length !== s.occupied.size) {
      throw new Error(`${s.id}: path length ${s.path.length} != occupied ${s.occupied.size} (revisited a cell)`);
    }

    for (let i = 0; i < s.path.length; i++) {
      const p = s.path[i];

      if (p.x < 0 || p.y < 0 || p.x >= state.cols || p.y >= state.rows) {
        throw new Error(`${s.id}: trail cell (${p.x},${p.y}) is outside the arena`);
      }

      // Trails may never overlap between slugs: a slug that would enter another
      // slug's cell dies without committing the move.
      const key = cellKey(p.x, p.y);
      if (seenAcrossSlugs.has(key)) {
        throw new Error(`${s.id}: cell (${p.x},${p.y}) is claimed by two slugs`);
      }
      seenAcrossSlugs.add(key);

      if (i > 0) {
        const prev = s.path[i - 1];
        const distance = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        if (distance !== 1) {
          throw new Error(`${s.id}: teleported from (${prev.x},${prev.y}) to (${p.x},${p.y})`);
        }
      }

      // A 180 would put the cell two steps back at the same place as the cell
      // ahead. Checking the trail geometry catches an illegal reversal no
      // matter which code path produced it.
      if (i > 1 && OPPOSITE_DELTA(s.path[i - 2], p)) {
        throw new Error(`${s.id}: reversed direction at (${p.x},${p.y})`);
      }
    }
  }
}

export function checkHistory(history) {
  for (const state of history) checkInvariants(state);
}
