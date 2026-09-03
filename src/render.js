// All canvas drawing lives here. Reads state, draws it, never mutates it.

const BG = '#080316';
const GRID = 'rgba(120, 90, 255, 0.13)';
const WALL = '#7b4dff';

// Neon is faked with two passes over the same path: a fat, heavily blurred
// stroke for the halo, then a thin bright stroke for the filament. Canvas
// shadowBlur does the glow; lineJoin/lineCap round off the corners, which is
// why we don't need a corner tile set.
function neonStroke(ctx, drawPath, color, width, glow) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;

  ctx.globalAlpha = 0.55;
  ctx.shadowBlur = glow;
  ctx.lineWidth = width * 2.1;
  drawPath();
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = glow * 0.5;
  ctx.lineWidth = width;
  drawPath();
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, width * 0.32);
  drawPath();
  ctx.stroke();
  ctx.restore();
}

function drawArena(ctx, state, cell) {
  const w = state.cols * cell;
  const h = state.rows * cell;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= state.cols; x++) {
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, h);
  }
  for (let y = 0; y <= state.rows; y++) {
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(w, y * cell + 0.5);
  }
  ctx.stroke();

  neonStroke(ctx, () => {
    ctx.beginPath();
    ctx.rect(2, 2, w - 4, h - 4);
  }, WALL, 3, 18);
}

function drawTrail(ctx, slug, cell) {
  if (slug.path.length < 2) return;
  const half = cell / 2;
  const path = () => {
    ctx.beginPath();
    slug.path.forEach((p, i) => {
      const x = p.x * cell + half;
      const y = p.y * cell + half;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  };
  neonStroke(ctx, path, slug.color, Math.max(3, cell * 0.34), cell * 1.1);
}

const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

function drawSlug(ctx, slug, cell, tick) {
  const half = cell / 2;
  const cx = slug.head.x * cell + half;
  const cy = slug.head.y * cell + half;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ANGLE[slug.dir]);

  // rocket exhaust, flickering
  const flare = cell * (1.1 + 0.35 * Math.sin(tick * 0.9));
  const g = ctx.createLinearGradient(-half, 0, -half - flare, 0);
  g.addColorStop(0, slug.color);
  g.addColorStop(0.45, 'rgba(255,190,60,0.75)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-half * 0.6, -cell * 0.26);
  ctx.lineTo(-half - flare, 0);
  ctx.lineTo(-half * 0.6, cell * 0.26);
  ctx.closePath();
  ctx.fill();

  // body
  ctx.shadowColor = slug.color;
  ctx.shadowBlur = cell;
  ctx.fillStyle = slug.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, cell * 0.72, cell * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(10,4,30,0.55)';
  ctx.fillRect(-cell * 0.18, -cell * 0.4, cell * 0.16, cell * 0.8);
  ctx.fillRect(cell * 0.16, -cell * 0.36, cell * 0.12, cell * 0.72);

  // eyestalks
  ctx.strokeStyle = slug.color;
  ctx.lineWidth = Math.max(1, cell * 0.1);
  ctx.beginPath();
  ctx.moveTo(cell * 0.42, -cell * 0.18);
  ctx.lineTo(cell * 0.82, -cell * 0.5);
  ctx.moveTo(cell * 0.42, cell * 0.18);
  ctx.lineTo(cell * 0.82, cell * 0.5);
  ctx.stroke();
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath();
  ctx.arc(cell * 0.86, -cell * 0.54, cell * 0.17, 0, Math.PI * 2);
  ctx.arc(cell * 0.86, cell * 0.54, cell * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a0630';
  ctx.beginPath();
  ctx.arc(cell * 0.9, -cell * 0.54, cell * 0.07, 0, Math.PI * 2);
  ctx.arc(cell * 0.9, cell * 0.54, cell * 0.07, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBoom(ctx, slug, cell, age) {
  if (!slug.deathAt) return;
  const p = Math.min(1, age / 26);
  const cx = slug.deathAt.x * cell + cell / 2;
  const cy = slug.deathAt.y * cell + cell / 2;
  const r = cell * (0.6 + p * 4.5);

  ctx.save();
  ctx.globalAlpha = 1 - p;
  ctx.shadowColor = slug.color;
  ctx.shadowBlur = 30;
  ctx.strokeStyle = slug.color;
  ctx.lineWidth = cell * 0.3 * (1 - p);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = cell * 0.16;
  ctx.strokeStyle = '#ffd76a';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45);
    ctx.lineTo(cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05);
    ctx.stroke();
  }
  ctx.restore();
}

export function render(ctx, state, cell, frame) {
  drawArena(ctx, state, cell);
  for (const s of state.slugs) drawTrail(ctx, s, cell);
  for (const s of state.slugs) {
    if (s.alive) drawSlug(ctx, s, cell, frame);
    else drawBoom(ctx, s, cell, frame - (s.deathFrame ?? frame));
  }
}
