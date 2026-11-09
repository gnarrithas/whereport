import type { MultiPolygon, Polygon, Position } from 'geojson';

/**
 * world-atlas is meant for spherical rendering (d3-geo); a few rings (Russia, Fiji,
 * Antarctica) jump from +180 to -180 mid-ring, which a planar renderer draws as
 * lines across the whole map. Split such rings at the antimeridian.
 */
export function splitAntimeridian(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polys.some((p) => p.some(hasJump))) return geometry;
  return { type: 'MultiPolygon', coordinates: polys.flatMap(splitPolygon) };
}

function hasJump(ring: Position[]): boolean {
  return ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);
}

/** Make longitudes continuous along the ring (values may leave [-180, 180]). */
function unwrap(ring: Position[]): Position[] {
  let offset = 0;
  return ring.map((p, i) => {
    if (i > 0) {
      const d = p[0] - ring[i - 1][0];
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    return [p[0] + offset, p[1]];
  });
}

/** Sutherland–Hodgman clip of a closed ring against the half-plane `inside`. */
function clip(ring: Position[], line: number, inside: (x: number) => boolean): Position[] {
  const out: Position[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const ina = inside(a[0]), inb = inside(b[0]);
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (line - a[0]) / (b[0] - a[0]);
      out.push([line, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length < 3) return [];
  out.push(out[0]);
  return out;
}

const shift = (ring: Position[], dx: number) => ring.map(([x, y]) => [x + dx, y]);

/** Returns [west-of-line part, east-of-line part], both normalised into [-180, 180]. */
function splitRing(ring: Position[]): [Position[], Position[]] | null {
  if (!hasJump(ring)) return null;
  const u = unwrap(ring);
  // A ring encircling a pole doesn't close after unwrapping; its jump runs along the pole edge, off-screen in Mercator.
  if (Math.abs(u[u.length - 1][0] - u[0][0]) > 1e-9) return null;
  const xs = u.map((p) => p[0]);
  const line = Math.max(...xs) > 180 ? 180 : -180;
  const west = clip(u, line, (x) => x <= line);
  const east = clip(u, line, (x) => x >= line);
  return line === 180 ? [west, shift(east, -360)] : [shift(west, 360), east];
}

function splitPolygon([outer, ...holes]: Position[][]): Position[][][] {
  const parts = splitRing(outer);
  const outers = parts ? parts.filter((r) => r.length) : [outer];
  const result: Position[][][] = outers.map((r) => [r]);
  for (const hole of holes) {
    const hp = splitRing(hole);
    const pieces = hp ? hp.filter((r) => r.length) : [hole];
    for (const piece of pieces) {
      // Attach each hole piece to the outer part on the same side of the antimeridian.
      const side = Math.sign(piece[0][0]);
      const owner = result.find((p) => Math.sign(p[0][0][0]) === side) ?? result[0];
      owner.push(piece);
    }
  }
  return result;
}
