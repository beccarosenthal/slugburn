# Slugburn — Project Plan

Rocket-powered cyberpunk slugs battle on a neon grid, Tron-lightcycle style. Two
players move continuously, leave lethal trails, and the last slug standing wins.

This doc is the working outline for the exercise: scope, architecture, and the
order we'll build in. Nothing here is built yet — this is the plan to align on
before writing game code.

## Goals & constraints (from the prompt)

- Bounded arena.
- Two slugs, distinct controls or behaviors.
- Continuous movement in four directions.
- No immediate reversal (can't turn 180° into your own neck).
- Persistent, lethal trails.
- Collision detection → announce winner or draw.
- Restart.
- A sprite sheet is available but optional — can lean on it fully, partially,
  or not at all.
- Priority order: **playable core > polish > extensions.** One extension,
  chosen after the core works, beats several half-done ones.

## Sprite sheet inventory

The sheet has been reviewed. Frame counts below are read off a
screen-resolution view and need confirming against the real file, but the
categories are clear:

| Group | Contents | Use |
|---|---|---|
| Title art | "SLUGBURN" logo card, two slugs on a neon grid | Title / menu screen |
| Gameplay mockup | Full arena with border frame, obstacles, trails, pickups | **Reference design for the target look** |
| Arena tiles | Dark wall blocks, grid floor tiles, hazard-stripe blocks, port/X blocks, cyan + magenta border corners and edges | Arena frame, obstacles |
| Hazards | Spiked mine ball, crystal/ring pedestals | Obstacle variants |
| Blue slug | ~8 frames, multiple headings | Player 1 head |
| Red slug | ~8 frames, matching set | Player 2 head |
| Exhaust plumes | Blue + orange, several sizes | Layer behind slug head |
| **Trail tiles (cyan + red)** | Straight, dashed/decaying, 4 elbows, T-junctions, cross, end-cap dots, burst node | **Trail rendering — see below** |
| Impact FX | Cyan/magenta/orange starbursts, debris explosion, splatters, scorch decal | Death effects |
| Power-ups | Green capsule, blue shield, yellow bolt | Matches the "power-ups" extension |
| HUD | Hearts (full/half/empty), cyan + magenta diamonds, **3 / 2 / 1 numerals**, pause / restart / play buttons | Lives, countdown, controls |

**The trail tileset settles the movement-model question.** A set containing
straights, four elbows, T-junctions, a cross, and end-caps is a
connectivity-autotiling set: each trail cell picks its sprite from a bitmask of
which of its four neighbors are also trail. That only works on a grid, which
confirms grid-stepped movement over free pixel movement. It also means trails
render as *proper neon tubing* — corners actually bend — rather than a chain of
squares, for roughly the cost of one lookup table.

The sheet also pre-answers two design questions: the **3/2/1 numerals** mean a
start countdown is expected, and the **pause/restart/play buttons** mean those
controls get real art rather than HTML buttons.

Things the sheet implies but the core doesn't need: hearts (a lives system, so
multiple rounds rather than one-and-done), diamonds (score or player markers),
capsule/shield/bolt (three distinct power-ups).

## Open questions to settle before/at build start

1. **The sprite sheet file.** I can see the image but there's no PNG in the
   folder — needs saving to `slugburn/assets/`. Two things to check when it
   lands: whether the background is **transparent** (the review copy shows
   sprites sitting on decorative backing panels — if those panels are baked
   into the pixels, every sprite needs tight cropping or the plate shows), and
   the file's true pixel dimensions.
2. **How to slice it.** The sheet is laid out as an *art presentation* —
   grouped panels with rounded borders — not as a uniform machine-readable
   atlas, so there's no single tile size to divide by. Options: hand-measure
   rects into an atlas JSON; write a one-off script that finds sprite bounding
   boxes by scanning for background gaps; or slice to individual PNGs. My
   lean: **measure by hand, but only the ~25 rects the core actually needs**
   (2 slug sets, 2 trail tilesets, 1 death FX, border tiles) and hardcode them
   in a JS atlas object. Auto-detection is a fun problem that isn't the
   exercise.
3. ~~**Extension pick**~~ — **chosen: AI opponents** (`src/ai.js`). Five
   algorithms, selectable per seat, so either slug can be human or AI and
   AI-vs-AI is watchable. They form a ladder by how much of the board each one
   looks at: Drunk (nothing) → Cautious (one cell) → Wall Hugger (one cell plus
   its surroundings) → Cartographer (flood fill of reachable space) →
   Strategist (flood fill from both slugs, maximising Voronoi territory).
   AI moves are queued through the same `queueTurn` a keypress uses, so the
   no-reversal rule applies to them and they can't write to state directly.
   Original candidate list below, kept for context. The sheet
   shifts the ranking, since art already exists for several: obstacles
   (tiles + mines supplied) > power-ups (three sprites + HUD supplied) >
   increasing speed (no art needed) > AI opponent (no art, most logic).

## Settled decisions

- **Render procedurally, not from the sprite sheet (for now).** The supplied
  PNG (1224×1285) is malformed as an atlas: 0.0% of its pixels are fully
  opaque and only 0.6% fully transparent — everything is semi-transparent at
  arbitrary alpha, sitting on mottled backing panels. Blitting rects out of it
  drags the panels along. Canvas `shadowBlur` reproduces the neon-tube look
  closely, and round `lineJoin` bends corners for free — which also means the
  autotiling lookup table is unnecessary. Sprites can be revisited later by
  extracting and cleaning individual frames.

- **`slugburn/` is the real repo.** Work here is the deliverable. Scratch files
  during development are fine but get cleaned up before the end.
- **Pure-function core.** Step resolution and collision live in `state.js` as
  `nextState(state, inputs) → state`, with zero canvas/DOM references.
  Rendering is a separate function that reads state and draws it.

  Worth noting *why this is even a decision*: the standard game-loop idiom
  mutates one shared state object in place every frame, because at 60fps
  allocation used to matter and the renderer reads straight off that mutable
  object. Nearly every game tutorial is written that way, and it's what makes
  game code awkward to test — collision logic ends up interleaved with canvas
  draw calls, so you can't exercise it without a browser. At our scale (~2400
  cells, 12 ticks/sec) that perf argument doesn't apply, so we use the ordinary
  backend shape instead: pure transform, separate serializer.

## Defaults I'll assume unless told otherwise

- Grid-stepped movement (now confirmed by the trail tileset).
- Arena ~60×40 cells, tile size set by the sprite sheet's native trail tile
  size once measured, ~12 ticks/sec, tuned by feel.
- Single round, no lives, no score. Hearts/diamonds are there if we want
  best-of-N later.
- 3-2-1 countdown before each round (sheet supplies the numerals).
- Restart on `R` plus the sprite button; pause on `P`/`Esc` plus its button.

## Proposed architecture

**Stack:** vanilla HTML + CSS + JS, no build step, no framework. Keeps the
whole thing readable in one sitting and avoids tooling questions eating into
the exercise. Canvas 2D throughout — with a real sprite sheet in play, canvas
is now clearly right over DOM elements.

**File layout (tentative):**
```
slugburn/
  index.html         # canvas + HUD
  style.css          # neon theme, page framing
  src/
    state.js         # pure: game state, step resolution, collision
    atlas.js         # sprite rects measured off the sheet
    render.js        # canvas drawing, autotiling lookup
    input.js         # keyboard → buffered direction
    main.js          # loop, wiring
  assets/
    slugburn.png     # the sprite sheet  ← still needed
  project.md
```
The split exists to keep `state.js` free of canvas/DOM so it stays testable
(open question 4). If we drop that goal, this collapses to one `game.js`.

**Core data model:**
- Grid: `COLS × ROWS` cells, each cell a fixed pixel size.
- Each slug: `{ id, head: {x,y}, direction, pendingDirection, trail: Set<"x,y">, color, alive }`.
- `pendingDirection` buffers the latest keypress and is applied once per tick
  (not immediately), and is rejected if it's the reverse of the current
  `direction` — this is how "no immediate reversal" gets enforced cleanly even
  with fast key mashing.

**Game loop:**
- Fixed-tick loop (`requestAnimationFrame` + accumulator) — tick rate is the
  game's speed knob, and the hook for the "increasing speed" extension.
- Each tick, per living slug: apply buffered direction → compute next head cell
  → check collisions → if clear, move head, add old head cell to trail.

**Collision detection (per tick, before committing a move):**
1. Next head cell out of bounds → dead.
2. Next head cell in any obstacle set → dead.
3. Next head cell in own trail or opponent's trail → dead.
4. Both slugs' next head cells land on the same cell (head-on) → both dead,
   draw.

Compute both slugs' next positions and check collisions *before* mutating
either slug's state, so simultaneous head-on and trail-cross cases resolve
correctly regardless of iteration order.

**Trail rendering (autotiling):** for each trail cell, build a 4-bit mask from
which orthogonal neighbors are also that slug's trail, then look up the sprite:
0 neighbors → dot, 1 → end-cap, 2 opposite → straight, 2 adjacent → elbow,
3 → T, 4 → cross. A 16-entry table per player color. Only cells adjacent to a
change need remasking, so this stays cheap even with long trails.

**Controls:**
- Player 1: `WASD`. Player 2: `Arrow keys`. Separate `pendingDirection`, no
  shared state.

**Win/draw/restart:**
- On any death, freeze the loop, play the impact FX at the death cell, render
  the outcome: "Player 1 wins" / "Player 2 wins" / "Draw".
- Restart resets positions, directions, and trails, then runs the countdown.

## Build order

1. Static arena render — canvas, bounded grid, neon background, border tiles.
2. Sprite atlas: measure the rects we need, get one sprite drawing correctly.
3. Single slug: continuous movement, keyboard input, reversal prevention.
4. Trail: persist visited cells, render with the autotiling lookup.
5. Wall + own-trail collision → death + outcome overlay.
6. Second slug, its own controls, trail-vs-trail and head-on collision.
7. Winner/draw announcement.
8. Restart flow + 3-2-1 countdown.
9. Polish pass with the sheet's FX: death explosion, exhaust plumes, scorch
   decal.
10. Pick and build one extension (see open question 5).

Steps 1–8 are the required core. Everything from 9 on is optional and gets cut
first if time runs short.

## Testing / verification approach

If `state.js` stays pure, the interesting cases become real assertions rather
than manual clicking:

- Wall collision from each of the four directions.
- Self-trail collision.
- Opponent-trail collision.
- Simultaneous head-on → draw, not a false win for whoever's checked first.
- Rapid opposite-key mashing within one tick → reversal rejected, not merely
  delayed.
- Autotiling mask → correct tile for all 16 neighbor combinations.
- Restart from mid-game and from post-game → state fully resets either way.

Manual passes still needed for feel: tick rate, input responsiveness, whether
collisions *look* fair at speed.

## Things to be ready to explain

- Why grid-stepped movement — and that the sprite sheet's trail tileset
  independently confirms it.
- Why collisions resolve by computing all next-positions first, then
  committing (simultaneous head-on correctness).
- How reversal prevention survives key-mash timing, not just "last key wins."
- The autotiling bitmask, and why it's a lookup table rather than branching.
- What was deliberately cut for time, and how the chosen extension builds on
  the core loop without a rewrite.
