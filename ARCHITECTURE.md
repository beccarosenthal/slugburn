# Slugburn — architecture

Two slugs move continuously on a grid, leave lethal trails, and die on contact
with a wall or any trail. Vanilla ES modules, no dependencies, no build step.

There is a visual version of this document with diagrams:
<https://claude.ai/code/artifact/c3856918-c13d-4994-b0df-80fb10abb268>

---

## 1. Start here when it breaks

Ordered by how often each actually happens. The first two are setup problems
that look like code problems.

| Symptom | Cause | Where to look |
|---|---|---|
| Blank page; console shows CORS / "failed to load module script" | Opened `index.html` off disk. Browsers refuse ES modules over `file://` | Serve over HTTP: `python3 serve.py` |
| Edits do nothing; **tests report green against changed code** | Stale ES module cache. Dangerous — it produces a *passing* run against code that no longer exists | `serve.py` sends `no-store`. Swapping in plain `http.server` loses that |
| Keys do nothing for one slug | That seat is set to an AI; the keydown handler ignores non-human seats so the player can't fight the algorithm | `controllers` in `main.js` |
| A slug drives into a wall | The AI had no safe move. Algorithms fall back to their current direction when boxed in — choosing how to die, not failing to notice | `safeDirs()` in `ai.js` |
| Movement freezes, page still responsive | Phase is stuck. `step()` returns its input untouched unless `phase === 'playing'` | `state.phase`; countdown branch of `loop()` |
| Burst of movement after switching tabs | Background tabs throttle rAF; one frame arrives with a huge `dt` and the catch-up loop runs every missed tick at once | `while (acc >= TICK_MS)` in `main.js`, and §6 |
| Frame rate degrades over a round | Trails redraw as full polylines every frame; Strategist runs six flood fills per tick | `drawTrail()` in `render.js`; `strategist` in `ai.js` |
| Trails disagree with collision | They read the same `path` array and cannot legitimately disagree — something mutated state outside `state.js` | See §6 |

---

## 2. What the pieces are

Four source modules. The split is not by feature but by whether a module
touches the browser — that line is also the line tests can reach.

```
        PURE · TESTED · RUNS IN NODE       │      BROWSER · DOM · CANVAS
                                           │
   ┌───────────────────────────┐  driveAI()│  ┌───────────────────────────┐
   │ ai.js                     │◀──────────┼──│ main.js                   │
   │ 5 algorithms, BFS over    │           │  │ loop, input, seat wiring  │
   │ a Uint8Array              │           │  └─────────┬────────┬────────┘
   └────────────┬──────────────┘           │            │        │
                │ queueTurn()              │  step()    │        │ render(state)
                ▼                          │  queueTurn │        ▼
   ┌───────────────────────────┐◀──────────┼────────────┘  ┌───────────────────┐
   │ state.js                  │           │               │ render.js         │
   │ step, queueTurn           │           │               │ draws state       │
   │ imports nothing           │           │               │ imports nothing   │
   └───────────────────────────┘           │               └───────────────────┘
```

Dependencies only point toward purity. `state.js` imports nothing, which is why
the tests need no DOM shim and no headless browser. Everything on the left is
covered by tests; `main.js` and `render.js` are not.

**Reading order:** `state.js` first — it is the whole game, in 136 lines. Then
`main.js`, the only file that knows a browser exists. `ai.js` and `render.js`
are leaves, read them when you need them.

---

## 3. One frame, end to end

**There are two clocks.** Drawing runs on the display's clock; game logic runs
on a fixed 85 ms clock. Most timing confusion comes from assuming they're one.

```
  rAF frame  ──▶  acc += dt  ──▶ ┌ while (acc >= 85ms) ──────────┐ ──▶  render
  variable dt      time bank     │   driveAI ──▶ step            │      draws state
                                 │      ▲            │           │
                                 │      └── acc -= 85ms, repeat ─┘           │
  once per frame                 └───────────────────────────────┘   once per frame
                                  0, 1, or several times per frame
```

The accumulator decouples them: elapsed real time goes into a bank, whole 85 ms
ticks are withdrawn. On a 144 Hz display most frames run *zero* ticks and just
redraw; after a stall one frame may run several. Game speed stays identical
across machines.

Input is buffered, not applied: a keypress writes `pending`, and the direction
is committed at the top of a tick.

---

## 4. Inside one tick

`step()` runs in a fixed order. Steps 2–5 are deliberately separated so no
slug's move commits before every slug's outcome is known.

1. **Commit buffered turns** — `pending` becomes `dir`, unless it's a reversal.
2. **Build the lethal set** — every occupied cell, *including cells heads are
   about to vacate*. Without this, adjacent slugs could swap through each other.
3. **Compute all next positions** — read-only, nothing has moved.
4. **Mark deaths** — off-grid or into the lethal set; then separately, any two
   slugs targeting the same cell both die (head-on).
5. **Commit survivors** — only now does anything move.
6. **Decide the outcome** — none left → draw; one left → winner.

Collapsing 3–5 into one loop is the tempting refactor, and it's wrong:
committing as you iterate makes a head-on resolve in favour of whichever slug
the loop visited first. There's a test named for exactly this.

---

## 5. Invariants

Asserted after every tick of complete AI-vs-AI games in
`tests/integration.test.js`, so a violation names the rule it broke.

- **State is replaced, never mutated.** One documented exception, in §6.
- **`path.length === occupied.size`** — the array and the Set are two views of
  one trail; divergence means a slug revisited a cell.
- **Trails never overlap between slugs** — a slug entering another's cell dies
  without committing the move.
- **Consecutive trail cells are adjacent** — Manhattan distance exactly 1.
- **No slug ever reverses** — checked geometrically (cell *n+1* is never cell
  *n−1*), so it catches an illegal 180 from any code path, human or AI.

**Randomness is injected, not reached for.** Drunk and Cautious take an `rng`
argument that defaults to `Math.random`, and `driveAI` threads it through. The
browser passes nothing and behaves exactly as before; tests pass a seeded
mulberry32 from `tests/helpers.js`, so any game — including one involving the
random algorithms — replays identically and a failure is reproducible from its
seed. Before this, asserting anything about a Drunk or Cautious game was a coin
flip, and the suite went red roughly one run in five.

---

## 6. Known warts

- **One place mutates state outside `state.js`.** `main.js` writes `deathFrame`
  onto slug objects to time the explosion. Render bookkeeping, but it breaks the
  purity claim. Bites when anything snapshots or replays states. Fix: a
  render-side `Map` keyed by slug id.
- **The catch-up loop has no clamp.** After a long stall the accumulator can
  hold many ticks and runs them all in one frame. Fix: clamp `dt`.
- **Trails redraw in full every frame** — three strokes over the whole polyline
  at 60 Hz, while the trail only changes at 11.8 Hz. Fix: offscreen canvas.
- **Strong AIs draw against each other often.** Strategist maximises territory
  but ignores where the opponent will be *next* tick. Fix: treat the opponent's
  reachable next cells as risky.
- **`render.js` and `main.js` are untested** — deliberate, they're the
  browser-bound half. Loop and drawing bugs are caught only by playing.

---

## 7. Verify it works

```bash
python3 serve.py
# game  → http://localhost:8123
# tests → http://localhost:8123/tests.html   expect 67/67

node tests/run.js   # optional, needs Node 18+
```

Smoke test the whole stack in a minute: set both seats to **AI — Strategist**
and watch a round. That exercises input queueing, the tick pipeline, collision
resolution, the win banner, and rendering without touching a key.

Confidence check on the tests themselves: break the reversal rule in
`queueTurn()` on purpose (compare against `s.pending` instead of `s.dir`) and
confirm the suite drops to 66/67. If it stays green you're looking at a cached
module, not a passing test.
