// Pure game logic. No canvas, no DOM, no timers — everything here is a
// deterministic transform, so it can be tested without a browser.

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export const cellKey = (x, y) => `${x},${y}`;

function makeSlug(id, name, color, x, y, dir) {
  return {
    id, name, color, dir,
    head: { x, y },
    pending: dir,
    path: [{ x, y }],
    occupied: new Set([cellKey(x, y)]),
    alive: true,
    deathAt: null,
  };
}

export function createGame({ cols = 60, rows = 40 } = {}) {
  // Offset rows on purpose: same-row starts make running straight an instant
  // mutual head-on, which ends the round before anyone has turned.
  return {
    cols, rows,
    tick: 0,
    phase: 'countdown', // countdown | playing | over
    winner: null,       // null | slug id | 'draw'
    slugs: [
      makeSlug('p1', 'Cyan', '#22e0ff', Math.floor(cols * 0.2), Math.floor(rows * 0.3), 'right'),
      makeSlug('p2', 'Magenta', '#ff2d95', Math.floor(cols * 0.8), Math.floor(rows * 0.7), 'left'),
    ],
  };
}

export function startPlaying(state) {
  return { ...state, phase: 'playing' };
}

// Buffer a turn. Rejected if it reverses the slug's *committed* direction —
// comparing against the committed dir rather than the pending one is what
// stops a fast left-then-up mash within a single tick from turning into a
// 180 and killing you on your own neck.
export function queueTurn(state, slugId, dir) {
  if (!DIRS[dir]) return state;
  const slugs = state.slugs.map((s) => {
    if (s.id !== slugId || !s.alive) return s;
    if (dir === OPPOSITE[s.dir]) return s;
    return { ...s, pending: dir };
  });
  return { ...state, slugs };
}

export function step(state) {
  if (state.phase !== 'playing') return state;

  const slugs = state.slugs.map((s) => ({ ...s }));
  const living = slugs.filter((s) => s.alive);

  for (const s of living) {
    if (s.pending !== OPPOSITE[s.dir]) s.dir = s.pending;
  }

  // Every cell any slug currently occupies is lethal — including the cells
  // heads are about to vacate. Without that, two slugs could swap places
  // through each other.
  const blocked = new Set();
  for (const s of slugs) for (const k of s.occupied) blocked.add(k);

  // Resolve all next positions BEFORE committing any move, so a head-on
  // collision reads as a draw instead of a win for whichever slug the loop
  // happened to visit first.
  const nexts = new Map();
  for (const s of living) {
    const d = DIRS[s.dir];
    nexts.set(s.id, { x: s.head.x + d.x, y: s.head.y + d.y });
  }

  const dead = new Set();
  for (const s of living) {
    const n = nexts.get(s.id);
    const offGrid = n.x < 0 || n.y < 0 || n.x >= state.cols || n.y >= state.rows;
    if (offGrid || blocked.has(cellKey(n.x, n.y))) dead.add(s.id);
  }

  const claimed = new Map();
  for (const s of living) {
    const n = nexts.get(s.id);
    const k = cellKey(n.x, n.y);
    if (claimed.has(k)) {
      dead.add(s.id);
      dead.add(claimed.get(k));
    } else {
      claimed.set(k, s.id);
    }
  }

  for (const s of living) {
    const n = nexts.get(s.id);
    if (dead.has(s.id)) {
      s.alive = false;
      s.deathAt = n;
      continue;
    }
    s.head = n;
    s.path = [...s.path, n];
    s.occupied = new Set(s.occupied);
    s.occupied.add(cellKey(n.x, n.y));
  }

  const survivors = slugs.filter((s) => s.alive);
  let phase = 'playing';
  let winner = null;
  if (survivors.length === 0) {
    phase = 'over';
    winner = 'draw';
  } else if (survivors.length === 1 && slugs.length > 1) {
    phase = 'over';
    winner = survivors[0].id;
  }

  return { ...state, slugs, tick: state.tick + 1, phase, winner };
}

export function outcomeText(state) {
  if (state.phase !== 'over') return '';
  if (state.winner === 'draw') return 'DRAW';
  const w = state.slugs.find((s) => s.id === state.winner);
  return w ? `${w.name.toUpperCase()} WINS` : '';
}
