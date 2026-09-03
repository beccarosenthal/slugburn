import { createGame, startPlaying, queueTurn, step, outcomeText } from './state.js';
import { render } from './render.js';
import { ALGORITHMS, byId, driveAI } from './ai.js';

const COLS = 60;
const ROWS = 40;
const CELL = 16;
const TICK_MS = 85; // game speed

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const banner = document.getElementById('banner');
const bannerText = document.getElementById('banner-text');
const bannerSub = document.getElementById('banner-sub');

canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

const KEYS = {
  KeyW: ['p1', 'up'], KeyS: ['p1', 'down'], KeyA: ['p1', 'left'], KeyD: ['p1', 'right'],
  ArrowUp: ['p2', 'up'], ArrowDown: ['p2', 'down'], ArrowLeft: ['p2', 'left'], ArrowRight: ['p2', 'right'],
};

// 'human' or an algorithm id from ai.js
const controllers = { p1: 'human', p2: 'hugger' };

let state;
let frame = 0;
let acc = 0;
let last = performance.now();
let countdown = 3;
let countdownAt = 0;
let paused = false;

function reset() {
  state = createGame({ cols: COLS, rows: ROWS });
  countdown = 3;
  countdownAt = performance.now();
  acc = 0;
  paused = false;
  setBanner('3', 'get ready');
}

function setBanner(text, sub) {
  if (text === null) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  bannerText.textContent = text;
  bannerSub.textContent = sub ?? '';
}

// --- seat / controller UI ---------------------------------------------------

function buildSeat(slugId) {
  const select = document.getElementById(`ctrl-${slugId}`);
  const blurb = document.getElementById(`blurb-${slugId}`);
  const keys = document.getElementById(`keys-${slugId}`);

  const human = new Option('Human', 'human');
  select.add(human);
  for (const algo of ALGORITHMS) select.add(new Option(`AI — ${algo.name}`, algo.id));
  select.value = controllers[slugId];

  const sync = () => {
    controllers[slugId] = select.value;
    const algo = byId(select.value);
    blurb.textContent = algo ? algo.blurb : '';
    keys.hidden = Boolean(algo);
  };

  select.addEventListener('change', () => {
    sync();
    reset(); // swapping a driver mid-round would be unfair to the survivor
  });

  sync();
}

buildSeat('p1');
buildSeat('p2');

// --- input ------------------------------------------------------------------

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') { reset(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state.phase === 'playing') {
      paused = !paused;
      setBanner(paused ? 'PAUSED' : null, paused ? 'P to resume' : '');
    }
    return;
  }
  const bind = KEYS[e.code];
  if (!bind) return;
  if (controllers[bind[0]] !== 'human') return; // don't fight the AI for the wheel
  e.preventDefault(); // stop arrow keys scrolling the page
  state = queueTurn(state, bind[0], bind[1]);
});

document.getElementById('restart').addEventListener('click', reset);

function loop(now) {
  const dt = now - last;
  last = now;
  frame++;

  if (state.phase === 'countdown') {
    const elapsed = now - countdownAt;
    const remaining = 3 - Math.floor(elapsed / 800);
    if (remaining !== countdown) {
      countdown = remaining;
      if (countdown > 0) setBanner(String(countdown), 'get ready');
    }
    if (remaining <= 0) {
      state = startPlaying(state);
      setBanner(null);
      acc = 0;
    }
  } else if (state.phase === 'playing' && !paused) {
    acc += dt;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      state = driveAI(state, controllers);
      const before = state;
      state = step(state);
      if (state.phase === 'over') {
        for (const s of state.slugs) if (!s.alive && s.deathFrame == null) s.deathFrame = frame;
        setBanner(outcomeText(state), 'press R to play again');
        break;
      }
      if (before === state) break;
    }
  }

  render(ctx, state, CELL, frame);
  requestAnimationFrame(loop);
}

reset();
requestAnimationFrame(loop);
