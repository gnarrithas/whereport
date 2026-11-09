import type { LngLatLike, Map as MlMap } from 'maplibre-gl';

const COLORS = ['#fbbf24', '#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#e879f9', '#ffffff'];
const ROCKETS = 10;
/** Rockets go up over this long, so the show lasts about this plus one burst. */
const LAUNCH_SPAN_MS = 3200;
const RISE_MS = 700;
const BURST_MS = 1600;
const SPARKS = 80;
const GRAVITY = 90; // px/s²

interface Rocket {
  start: number;
  /** Where it bursts, in px relative to the airport. */
  dx: number;
  dy: number;
  color: string;
  sparks: { angle: number; speed: number }[];
}

/**
 * Fireworks on a canvas overlaid on the map, bursting above `at` and following it as the map moves.
 * Returns a function that stops the show early; the canvas is removed when it ends either way.
 */
export function launchFireworks(map: MlMap, at: LngLatLike): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const container = map.getContainer();
  const canvas = document.createElement('canvas');
  canvas.className = 'fireworks';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return () => {};
  }

  const begin = performance.now();
  const rockets: Rocket[] = Array.from({ length: ROCKETS }, (_, i) => ({
    start: begin + (i / ROCKETS) * LAUNCH_SPAN_MS + Math.random() * 200,
    dx: (Math.random() - 0.5) * 260,
    dy: -(130 + Math.random() * 150),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    sparks: [],
  }));
  // Sparks of a burst share roughly one speed, so each burst opens as a ring.
  for (const r of rockets) {
    const size = 45 + Math.random() * 40;
    r.sparks = Array.from({ length: SPARKS }, (_, i) => ({
      angle: (i / SPARKS) * Math.PI * 2 + Math.random() * 0.08,
      speed: size * (0.85 + Math.random() * 0.3),
    }));
  }
  const end = Math.max(...rockets.map((r) => r.start)) + RISE_MS + BURST_MS;

  let frame = 0;
  const draw = (now: number) => {
    const ratio = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = container;
    if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const origin = map.project(at);

    for (const r of rockets) {
      const t = now - r.start;
      if (t < 0) continue;
      if (t < RISE_MS) {
        // Rising trail, easing out as it nears the top.
        const p = 1 - (1 - t / RISE_MS) ** 2;
        const x = origin.x + r.dx * p;
        const y = origin.y + r.dy * p;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fde68a';
        ctx.shadowColor = '#fde68a';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const s = (t - RISE_MS) / 1000;
      const life = (t - RISE_MS) / BURST_MS;
      if (life >= 1) continue;
      ctx.globalAlpha = 1 - life * life;
      ctx.fillStyle = r.color;
      ctx.shadowColor = r.color;
      ctx.shadowBlur = 10;
      for (const spark of r.sparks) {
        const slow = 1 - life * 0.5;
        const x = origin.x + r.dx + Math.cos(spark.angle) * spark.speed * s * slow;
        const y = origin.y + r.dy + Math.sin(spark.angle) * spark.speed * s * slow + 0.5 * GRAVITY * s * s;
        ctx.beginPath();
        ctx.arc(x, y, 3 * (1 - life * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (now < end) frame = requestAnimationFrame(draw);
    else canvas.remove();
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    canvas.remove();
  };
}
