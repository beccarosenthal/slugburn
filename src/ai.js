// AI opponents, ordered weakest to strongest.
//
// Every algorithm has the same job: given the current state and which slug it
// controls, return a direction. They never mutate state — they only read it
// and answer, so the game loop stays in charge.
//
// The interesting progression here is how much of the board each one looks at:
//   drunk        — nothing
//   cautious     — one cell ahead
//   hugger       — one cell ahead + its immediate surroundings
//   cartographer — every cell it could ever reach (flood fill)
//   strategist   — every cell, plus every cell the OPPONENT could reach
//
// Randomness is injected, never reached for. Drunk and Cautious take an `rng`
// argument defaulting to Math.random, so the browser behaves exactly as before
// while tests can pass a seeded generator and get a reproducible game. Without
// this the two random algorithms make the suite non-deterministic, and a test
// like "Cautious survives 30 ticks" is a coin flip rather than an assertion.

import { DIRS, queueTurn } from './state.js';

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const ORDER = ['up', 'right', 'down', 'left'];

// ---------------------------------------------------------------------------
// Grid helpers
//
// The pure state stores trails as Sets of "x,y" strings, which is convenient
// for game logic but slow to hammer in a search loop. The AI flattens the
// board into a Uint8Array indexed by (y * cols + x) once per decision — same
// information, but neighbor lookups become integer arithmetic instead of
// string building and hashing.
// ---------------------------------------------------------------------------

function buildGrid(state) {
  const grid = new Uint8Array(state.cols * state.rows);
  for (const slug of state.slugs) {
    for (const p of slug.path) grid[p.y * state.cols + p.x] = 1;
  }
  return grid;
}

const idx = (state, x, y) => y * state.cols + x;

function destOf(slug, dir) {
  const d = DIRS[dir];
  return { x: slug.head.x + d.x, y: slug.head.y + d.y };
}

function onBoard(state, p) {
  return p.x >= 0 && p.y >= 0 && p.x < state.cols && p.y < state.rows;
}

// Directions that aren't an illegal 180.
function legalDirs(slug) {
  return ORDER.filter((d) => d !== OPPOSITE[slug.dir]);
}

// Legal directions that don't kill us on the very next tick.
function safeDirs(state, slug, grid) {
  return legalDirs(slug).filter((d) => {
    const n = destOf(slug, d);
    return onBoard(state, n) && !grid[idx(state, n.x, n.y)];
  });
}

// Breadth-first search from one cell. Returns the distance map (-1 = never
// reached) and how many cells were reachable in total. This single function
// powers both flood fill and the territory comparison below.
function bfs(state, startIndex, grid) {
  const { cols, rows } = state;
  const size = cols * rows;
  const dist = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  dist[startIndex] = 0;
  queue[tail++] = startIndex;

  while (head < tail) {
    const c = queue[head++];
    const cx = c % cols;
    const cy = (c / cols) | 0;
    const next = dist[c] + 1;

    if (cy > 0)        { const n = c - cols; if (dist[n] < 0 && !grid[n]) { dist[n] = next; queue[tail++] = n; } }
    if (cy < rows - 1) { const n = c + cols; if (dist[n] < 0 && !grid[n]) { dist[n] = next; queue[tail++] = n; } }
    if (cx > 0)        { const n = c - 1;    if (dist[n] < 0 && !grid[n]) { dist[n] = next; queue[tail++] = n; } }
    if (cx < cols - 1) { const n = c + 1;    if (dist[n] < 0 && !grid[n]) { dist[n] = next; queue[tail++] = n; } }
  }

  return { dist, reachable: tail };
}

function pickRandom(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Score every candidate direction and take the best, breaking ties in favour
// of carrying straight on (turning for no reason wastes space).
function bestBy(candidates, slug, scoreFn) {
  let best = null;
  let bestScore = -Infinity;
  for (const dir of candidates) {
    const score = scoreFn(dir) + (dir === slug.dir ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The opponents
// ---------------------------------------------------------------------------

export const ALGORITHMS = [
  {
    id: 'drunk',
    name: 'Drunk',
    blurb: 'Picks any legal turn at random. Looks at nothing, dies to its own trail almost immediately. The baseline that shows why lookahead matters.',
    pick(state, slug, opponent, rng = Math.random) {
      return pickRandom(legalDirs(slug), rng);
    },
  },

  {
    id: 'cautious',
    name: 'Cautious',
    blurb: 'Checks one cell ahead and picks randomly among moves that do not kill it this tick. Survives far longer than Drunk, but happily wanders into a dead end it cannot see.',
    pick(state, slug, opponent, rng = Math.random) {
      const grid = buildGrid(state);
      const safe = safeDirs(state, slug, grid);
      if (!safe.length) return slug.dir;
      return safe.includes(slug.dir) && rng() < 0.8
        ? slug.dir
        : pickRandom(safe, rng);
    },
  },

  {
    id: 'hugger',
    name: 'Wall Hugger',
    blurb: 'Prefers moves that keep it pressed against a wall or trail, so the open space it leaves behind stays in one usable piece. A cheap heuristic that plays a recognisably tidy game without any search.',
    pick(state, slug) {
      const grid = buildGrid(state);
      const safe = safeDirs(state, slug, grid);
      if (!safe.length) return slug.dir;

      return bestBy(safe, slug, (dir) => {
        const n = destOf(slug, dir);
        let walls = 0;
        for (const d of ORDER) {
          const v = DIRS[d];
          const p = { x: n.x + v.x, y: n.y + v.y };
          if (!onBoard(state, p) || grid[idx(state, p.x, p.y)]) walls++;
        }
        return walls;
      });
    },
  },

  {
    id: 'cartographer',
    name: 'Cartographer',
    blurb: 'Flood fills from each candidate move and takes whichever leaves the most reachable space. This is the first opponent that genuinely avoids trapping itself, because it sees the whole open region rather than the next cell.',
    pick(state, slug) {
      const grid = buildGrid(state);
      const safe = safeDirs(state, slug, grid);
      if (!safe.length) return slug.dir;

      return bestBy(safe, slug, (dir) => {
        const n = destOf(slug, dir);
        return bfs(state, idx(state, n.x, n.y), grid).reachable;
      });
    },
  },

  {
    id: 'strategist',
    name: 'Strategist',
    blurb: 'Runs a flood fill from itself AND from its opponent, then counts the cells it would reach first — a Voronoi split of the board. It maximises its own territory, which naturally produces cutting-off moves without any explicit aggression rule.',
    pick(state, slug, opponent) {
      const grid = buildGrid(state);
      const safe = safeDirs(state, slug, grid);
      if (!safe.length) return slug.dir;

      // With no live opponent there is no territory to contest, so this
      // degrades to pure space-maximising.
      if (!opponent || !opponent.alive) {
        return bestBy(safe, slug, (dir) => {
          const n = destOf(slug, dir);
          return bfs(state, idx(state, n.x, n.y), grid).reachable;
        });
      }

      const oppIndex = idx(state, opponent.head.x, opponent.head.y);

      return bestBy(safe, slug, (dir) => {
        const n = destOf(slug, dir);
        const myIndex = idx(state, n.x, n.y);

        // Block the cell we would move into, so neither search runs through it.
        const after = grid.slice();
        after[myIndex] = 1;

        const mine = bfs(state, myIndex, after);
        const theirs = bfs(state, oppIndex, after);

        let territory = 0;
        for (let i = 0; i < mine.dist.length; i++) {
          const a = mine.dist[i];
          if (a < 0) continue;
          const b = theirs.dist[i];
          if (b < 0 || a < b) territory++;
        }

        // Territory is the goal, but weight raw reachable space slightly too:
        // winning the split is worthless if we win it inside a pocket that
        // suffocates us three moves later.
        return territory + mine.reachable * 0.25;
      });
    },
  },
];

export const byId = (id) => ALGORITHMS.find((a) => a.id === id) ?? null;

// Ask every AI-driven slug for a direction and queue it.
//
// `controllers` maps slug id -> 'human' | algorithm id. Anything that isn't a
// known algorithm is left alone, so human seats fall through untouched.
//
// Turns go through queueTurn — the same function a keypress calls — so the
// no-reversal rule applies to AI for free and no algorithm can write to state
// directly. Both the browser loop and the test harness call this, so tests
// exercise the real decision path rather than a reimplementation of it.
export function driveAI(state, controllers, rng = Math.random) {
  for (const slug of state.slugs) {
    if (!slug.alive) continue;
    const algo = byId(controllers[slug.id]);
    if (!algo) continue;
    const opponent = state.slugs.find((s) => s.id !== slug.id);
    const dir = algo.pick(state, slug, opponent, rng);
    if (dir) state = queueTurn(state, slug.id, dir);
  }
  return state;
}
