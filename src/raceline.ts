/**
 * The racing line: where to drive, and how fast, drawn on the road.
 *
 * The circuit knows its centreline and nothing else. A centreline is not a
 * line anybody drives — the whole of cornering is using the width of the
 * road, braking in a straight line on the outside, turning in to clip the
 * inside at the apex and running out to the far edge again — so this works
 * one out, and colours it with the speed a point mass could hold along it:
 * green where you are flat, amber where you are off the throttle, red where
 * you are braking.
 *
 * **How the line is found.** Not an optimiser: a relaxation. Every sample
 * starts on the centreline and is pulled toward the midpoint of its two
 * neighbours — the same smoothing that turns a polygon into a circle — and
 * is then put back on its own line across the road and clamped to the
 * tarmac. What that minimises is the curvature of the path, which is what a
 * racing line minimises, and it settles in a couple of hundred passes over
 * four hundred samples in under two milliseconds. It has the same fault as
 * every curvature-minimising line: it is the geometric line rather than the
 * fast one, so it takes a late apex no better than an early one. It is a
 * guide, and it says so.
 *
 * **It is drawn, not driven.** The pilot that fits par still follows the
 * centreline, and nothing here touches what the car does — a line that fed
 * the physics would move every lap time in the game and invalidate the par
 * constants fitted against them. This is an overlay.
 *
 * **What it is worth, measured.** Over four rally seeds at medium the road's
 * tightest corner is 714 to 912mm and the line's is 931 to 1378: a quarter
 * to a half more radius, which is the width of the road being used. The
 * technical is held below nine tenths of its top speed for 0 to 4% of a lap
 * on those, and an F1 on a track for 0 to 1% of one.
 */

import type { Mesh } from 'artshape-render/mesh/types';
import { TRACK_HALF, TRACK_LIFT, centreline, radialToAcross } from './track';
import { height } from './terrain';
import type { CornerRating } from './track';

/** How much of the half width the line may use: the rest is a wheel's margin. */
const USABLE = 0.82;
/**
 * How wide the painted line is, and how far over the tarmac it floats.
 *
 * The lift is the road's own `TRACK_LIFT` and a couple of millimetres more.
 * Nine of them — the figure a mark laid straight on the ground wants — put
 * the whole line thirteen millimetres *under* the tarmac, where it drew
 * perfectly and could not be seen from anywhere.
 */
const WIDTH = 70;
const LIFT = TRACK_LIFT + 2;

export interface RaceLine {
  /** The line itself, one point a sample, closed. */
  points: [number, number][];
  /** What a point mass holds there, in the game's own speed units. */
  speed: number[];
  /** The top speed those were worked out against, for colouring. */
  topSpeed: number;
}

/**
 * The line for the circuit in force, for a car of this rating.
 *
 * The samples are even in angle rather than in arc, which is what every
 * other pass over the circuit here uses, so a point can be pushed back onto
 * its own radial line after each relaxation pass without re-solving where
 * it is.
 */
export function raceLine(topSpeed: number, rating: CornerRating, samples = 400, passes = 240): RaceLine {
  const theta: number[] = [];
  const centre: [number, number][] = [];
  const radial: [number, number][] = [];
  /** How far along the radius a millimetre across the road is, here. */
  const perRadial: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = -Math.PI + (i / samples) * Math.PI * 2;
    theta.push(t);
    centre.push(centreline(t));
    radial.push([Math.cos(t), Math.sin(t)]);
    perRadial.push(1 / radialToAcross(t));
  }
  // the offset of each sample from the centreline, along its own radius
  const off = new Float64Array(samples);
  const limit = perRadial.map((p) => TRACK_HALF * USABLE * p);

  for (let pass = 0; pass < passes; pass++) {
    const next = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const a = (i + samples - 1) % samples, b = (i + 1) % samples;
      const pa: [number, number] = [centre[a][0] + radial[a][0] * off[a], centre[a][1] + radial[a][1] * off[a]];
      const pb: [number, number] = [centre[b][0] + radial[b][0] * off[b], centre[b][1] + radial[b][1] * off[b]];
      // the midpoint of the neighbours, put back on this sample's radius
      const mx = (pa[0] + pb[0]) / 2 - centre[i][0];
      const my = (pa[1] + pb[1]) / 2 - centre[i][1];
      const want = mx * radial[i][0] + my * radial[i][1];
      // eased rather than jumped, or the relaxation rings rather than settles
      const to = off[i] + (want - off[i]) * 0.5;
      next[i] = Math.max(-limit[i], Math.min(limit[i], to));
    }
    off.set(next);
  }

  const points: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    points.push([centre[i][0] + radial[i][0] * off[i], centre[i][1] + radial[i][1] * off[i]]);
  }
  return { points, speed: speedAlong(points, topSpeed, rating), topSpeed };
}

/**
 * What a point mass holds along a closed path: the corner limit at every
 * point, then braking backward into it and power forward out of it, twice
 * round each way because a braking zone can start before the line.
 *
 * The same model `speedPlan` runs on the centreline, over an arbitrary path
 * rather than a polar shape — the curvature here is measured from three
 * consecutive points rather than from the shape's derivatives.
 */
function speedAlong(points: [number, number][], topSpeed: number, rating: CornerRating): number[] {
  const n = points.length;
  const ds: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n], b = points[i], c = points[(i + 1) % n];
    ds.push(Math.hypot(c[0] - b[0], c[1] - b[1]));
    // the circumradius of the three points, which is the path's radius here
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    const radius = area < 1e-6 ? 1e9 : (ab * bc * ca) / (4 * area);
    v.push(Math.min(topSpeed, rating.corner * Math.sqrt(radius)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * rating.brake * ds[i]));
    }
    for (let i = 0; i < n; i++) {
      const prev = v[(i + n - 1) % n];
      v[i] = Math.min(v[i], Math.sqrt(prev * prev + 2 * rating.accel * ds[(i + n - 1) % n]));
    }
  }
  return v;
}

/**
 * Green where the car is flat out, amber where it is off the throttle,
 * red where it is braking hard — the colours every racing game has used
 * since they were invented, because they are the ones a driver already
 * knows from a traffic light.
 */
function colourFor(v: number, next: number, top: number): [number, number, number] {
  const slowing = (v - next) / Math.max(v, 1);
  if (slowing > 0.012) return [1.0, 0.12, 0.06];
  if (v > top * 0.985) return [0.25, 1.0, 0.35];
  return [1.0, 0.62, 0.05];
}

/** A unit quad in the ground plane: one is laid along each step of the line. */
export function lineMesh(): Mesh {
  return {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/**
 * The line as quads to draw: a matrix and a colour each, laid end to end
 * along it and riding the ground as the road does.
 */
export function lineQuads(line: RaceLine, matrices: Float32Array, materials: Float32Array): number {
  const n = line.points.length;
  const capacity = Math.floor(matrices.length / 16);
  let count = 0;
  for (let i = 0; i < n && count < capacity; i++) {
    const a = line.points[i], b = line.points[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const c = dx / len, s = dy / len;
    const o = count * 16;
    // x along the segment and a little over it, so neighbours meet; y across
    matrices[o] = c * (len + 6); matrices[o + 1] = s * (len + 6); matrices[o + 2] = 0; matrices[o + 3] = 0;
    matrices[o + 4] = -s * WIDTH; matrices[o + 5] = c * WIDTH; matrices[o + 6] = 0; matrices[o + 7] = 0;
    matrices[o + 8] = 0; matrices[o + 9] = 0; matrices[o + 10] = 1; matrices[o + 11] = 0;
    matrices[o + 12] = cx; matrices[o + 13] = cy; matrices[o + 14] = height(cx, cy) + LIFT; matrices[o + 15] = 1;
    const colour = colourFor(line.speed[i], line.speed[(i + 1) % n], line.topSpeed);
    materials.set([...colour, 0.55], count * 4);
    count++;
  }
  return count;
}

/** How many quads a line of this many samples wants. */
export const LINE_CAPACITY = 512;
