/**
 * What stands at the side of the road: crash barriers, oil drums, tyre
 * stacks.
 *
 * All of it is placed from the circuit rather than by hand, because the
 * circuit changes — a barrier list written for one seed is scenery in a field
 * on the next. So this reads the curvature round the lap and puts things
 * where a circuit puts them: barriers on the outside of the corners you would
 * actually run off at, tyres against the barrier where the corner is
 * tightest, drums marking the apex on the inside and loose in the run-off.
 *
 * Everything here is solid. A barrier you can drive through is worse than no
 * barrier: it tells you where the edge is and then lies about it. The drums
 * and the tyre stacks are circles, which the truck already knows how to be
 * pushed out of; the barriers are segments, which it did not, and `game.ts`
 * grew a case for them.
 *
 * Scale. The truck is 300 long and about 130 to the top of its cab, which
 * puts this arena at about 1:15 — so a real Armco rail, 750mm to the top of
 * the beam, is 50 here. That is correct and it is too short to read at
 * driving distance against a truck twice its height, so the rail top is 85
 * and the drums are a little over scale too. What makes a barrier visible is
 * that it is continuous, but it has to clear the wheels to look like it is
 * holding anything.
 */
import type { Mesh } from 'artshape-render/mesh/types';
import { TRACK_HALF, TRACK_LIFT, centreline, curveRadius, radiusAt, tangentAt } from './track';
import { height, normal } from './terrain';
import { COLUMNS } from './scene';
import { underWater } from './water';
import { box, prism } from './scene';

/** A corner worth protecting: anything tighter than this gets a barrier. */
const CORNER = 1900;
/** How far out from the middle of the road the barrier face stands. */
const BARRIER_OUT = TRACK_HALF + 300;
/** One rail's length. Short enough to follow a bend without a visible kink. */
const RAIL = 440;
/** Where the middle of the beam sits above the ground. */
const RAIL_MID = 62;
const RAIL_DEEP = 22;
const RAIL_TALL = 46;
/** The post that holds it up, and how often one appears. */
const POST_EVERY = 2;

const DRUM_R = 24;
const DRUM_H = 70;
const TYRE_R = 34;
const TYRE_H = 96;

/** Something round the truck has to go round. */
export interface Bollard { x: number; y: number; r: number; kind: 'drum' | 'tyre'; turn: number; }
/** A run of barrier, as the line its face follows. */
export interface Rail { x1: number; y1: number; x2: number; y2: number; }

export let RAILS: Rail[] = [];
export let BOLLARDS: Bollard[] = [];

export const railMesh = (): Mesh => box(RAIL, RAIL_DEEP, RAIL_TALL);
export const railPostMesh = (): Mesh => box(30, 30, RAIL_MID + RAIL_TALL / 2);
export const drumMesh = (): Mesh => prism(DRUM_R, DRUM_H, 12);
export const tyreMesh = (): Mesh => prism(TYRE_R, TYRE_H, 10);

/** A deterministic generator, so a circuit's furniture is the same every time. */
function random(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Too near a lamp post to stand something else there. */
function clearOfPosts(x: number, y: number, room: number): boolean {
  for (const p of COLUMNS) {
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < room * room) return false;
  }
  return true;
}

/**
 * Walk the lap and put the furniture where the circuit asks for it.
 *
 * The walk is by angle but stepped by arc length, because a polar circuit is
 * not travelled at a constant rate: the same step of angle covers half again
 * as much road on the outside of the loop as on the inside, and barriers
 * spaced by angle come out bunched at one end of every corner.
 */
export function rebuildFurniture(seed = 5) {
  const rnd = random(seed + 991);
  RAILS = [];
  BOLLARDS = [];

  /**
   * Which way is out, and how hard the road is turning.
   *
   * From the tangent and the sign of the turn, not from `curveOutward`. That
   * returns the direction away from the circumcentre of three points on the
   * road, which is exactly right in a corner and means nothing on a straight
   * — three nearly collinear points have a circumcentre anywhere at all. The
   * first version used it for the lead-in samples either side of each corner,
   * which are straights by definition, and put lengths of barrier across the
   * road.
   */
  const at = (t: number) => {
    const d = 240 / Math.max(radiusAt(t), 200);
    const a = centreline(t - d), b = centreline(t), c = centreline(t + d);
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const [tx, ty] = tangentAt(t);
    return { b, left: [-ty, tx] as [number, number], turn, r: curveRadius(t, 240), t };
  };
  /** The road's edge, `BARRIER_OUT` out on the side given. */
  const edge = (s: ReturnType<typeof at>, side: number): [number, number] =>
    [s.b[0] + s.left[0] * side * BARRIER_OUT, s.b[1] + s.left[1] * side * BARRIER_OUT];

  // Walk the lap by arc length rather than by angle: the same step of angle
  // covers half again as much road on the outside of the loop as the inside,
  // and barriers spaced by angle come out bunched at one end of every corner.
  const samples: ReturnType<typeof at>[] = [];
  let th = -Math.PI;
  while (th < Math.PI) {
    samples.push(at(th));
    th += RAIL / Math.max(radiusAt(th), 200);
  }

  const n = samples.length;
  const wanted = samples.map((s) => s.r < CORNER);

  // Runs of corner, each taking one side for its whole length.
  //
  // Which side is out has to be decided once per corner and not once per
  // sample. It comes from the sign of the turn, and on the straight either
  // side of a corner that sign is the difference of two nearly equal numbers
  // — so a per-sample answer flaps from one side of the road to the other
  // along the lead-in, every join between two flapped samples gets thrown
  // out as crossing the tarmac, and a circuit that should carry a hundred
  // rails carries thirteen in ones and twos. The apex is where the sign
  // means something, so the apex decides for the corner.
  const seen = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!wanted[i] || seen[i]) continue;
    const core: number[] = [];
    let j = i;
    while (wanted[j % n] && !seen[j % n] && core.length < n) {
      seen[j % n] = true;
      core.push(j % n);
      j++;
    }
    if (core.length < 2) continue;

    // the apex, and the side it says is out
    let apex = core[0];
    for (const k of core) if (samples[k].r < samples[apex].r) apex = k;
    const side = samples[apex].turn > 0 ? -1 : 1;

    // A barrier starts before the corner and ends after it: the place you
    // leave the road is past the apex, not at it.
    const LEAD = 3;
    const run: number[] = [];
    for (let k = -LEAD; k < core.length + LEAD; k++) run.push((core[0] + k + n * 2) % n);

    let prev: [number, number] | null = null;
    for (const k of run) {
      const [x, y] = edge(samples[k], side);
      if (underWater(x, y, 10)) { prev = null; continue; }
      if (prev) RAILS.push({ x1: prev[0], y1: prev[1], x2: x, y2: y });
      prev = [x, y];
    }

    const s = samples[apex];
    const [tx, ty] = tangentAt(s.t);
    const [ex, ey] = edge(s, side);
    const ax = ex - s.left[0] * side * (TYRE_R + RAIL_DEEP);
    const ay = ey - s.left[1] * side * (TYRE_R + RAIL_DEEP);
    for (let k = -1; k <= 1; k++) {
      const x = ax + tx * k * (TYRE_R * 2.1), y = ay + ty * k * (TYRE_R * 2.1);
      if (underWater(x, y, 10)) continue;
      BOLLARDS.push({ x, y, r: TYRE_R, kind: 'tyre', turn: rnd() * Math.PI });
    }
    // and drums on the inside, which is where an apex marker goes
    for (let k = -1; k <= 1; k++) {
      const out = TRACK_HALF + 265 + rnd() * 90;
      const x = s.b[0] - s.left[0] * side * out + tx * k * 150;
      const y = s.b[1] - s.left[1] * side * out + ty * k * 150;
      if (underWater(x, y, 10) || !clearOfPosts(x, y, 150)) continue;
      BOLLARDS.push({ x, y, r: DRUM_R, kind: 'drum', turn: rnd() * Math.PI * 2 });
    }
  }

  // Loose drums in the run-off, in twos and threes, well back from the road:
  // scenery rather than obstacle, and the reason the verge is not empty.
  for (let i = 0; i < 26; i++) {
    const s = at(-Math.PI + rnd() * Math.PI * 2);
    const side = rnd() < 0.5 ? -1 : 1;
    const out = TRACK_HALF + 620 + rnd() * 420;
    const bx = s.b[0] + s.left[0] * side * out, by = s.b[1] + s.left[1] * side * out;
    for (let k = 0; k < 2 + Math.floor(rnd() * 2); k++) {
      const x = bx + (rnd() - 0.5) * 130, y = by + (rnd() - 0.5) * 130;
      if (underWater(x, y, 10) || !clearOfPosts(x, y, 130)) continue;
      BOLLARDS.push({ x, y, r: DRUM_R, kind: 'drum', turn: rnd() * Math.PI * 2 });
    }
  }
}

/** The placements, ready for the renderer. */
export function furnitureBuffers(): {
  rails: Float32Array; railCount: number;
  posts: Float32Array; postCount: number;
  drums: Float32Array; drumCount: number; drumTint: Float32Array;
  tyres: Float32Array; tyreCount: number;
} {
  const rails = new Float32Array(RAILS.length * 16);
  const posts = new Float32Array(RAILS.length * 16);
  let railCount = 0, postCount = 0;
  RAILS.forEach((r, i) => {
    const mx = (r.x1 + r.x2) / 2, my = (r.y1 + r.y2) / 2;
    const yaw = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
    const g = height(mx, my), nrm = normal(mx, my);
    // Stretched to its own length along the run. The mesh is one fixed
    // length and the line the barrier follows is offset outward from the
    // centreline, so its arc is longer than the centreline's — at a fixed
    // length the rails came out as a dashed line with daylight between them.
    const span = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
    placeUp(rails, railCount++, mx, my, g, yaw, nrm, RAIL_MID, span / RAIL);
    if (i % POST_EVERY === 0) {
      const px = r.x1, py = r.y1;
      const pg = height(px, py), pn = normal(px, py);
      placeUp(posts, postCount++, px, py, pg, yaw, pn, (RAIL_MID + RAIL_TALL / 2) / 2);
    }
  });

  const drumsOf = BOLLARDS.filter((b) => b.kind === 'drum');
  const tyresOf = BOLLARDS.filter((b) => b.kind === 'tyre');
  const drums = new Float32Array(drumsOf.length * 16);
  const drumTint = new Float32Array(drumsOf.length * 4);
  drumsOf.forEach((b, i) => {
    const g = height(b.x, b.y), nrm = normal(b.x, b.y);
    placeUp(drums, i, b.x, b.y, g, b.turn, nrm, 0);
    // rust, faded red, faded blue: a yard's worth rather than a set
    const c: [number, number, number] = i % 3 === 0 ? [0.42, 0.17, 0.10]
      : i % 3 === 1 ? [0.52, 0.13, 0.11] : [0.14, 0.22, 0.38];
    drumTint.set([...c, 0.62], i * 4);
  });
  const tyres = new Float32Array(tyresOf.length * 16);
  tyresOf.forEach((b, i) => {
    const g = height(b.x, b.y), nrm = normal(b.x, b.y);
    placeUp(tyres, i, b.x, b.y, g, b.turn, nrm, 0);
  });

  return { rails, railCount, posts, postCount, drums, drumCount: drumsOf.length, drumTint, tyres, tyreCount: tyresOf.length };
}

/** On the ground, along a heading, lifted along the ground's own normal. */
function placeUp(
  out: Float32Array, i: number, x: number, y: number, z: number,
  yaw: number, n: [number, number, number], lift: number, stretch = 1,
) {
  let fx = Math.cos(yaw), fy = Math.sin(yaw), fz = 0;
  const along = fx * n[0] + fy * n[1];
  fx -= n[0] * along; fy -= n[1] * along; fz -= n[2] * along;
  const len = Math.hypot(fx, fy, fz) || 1;
  fx /= len; fy /= len; fz /= len;
  const lx = n[1] * fz - n[2] * fy, ly = n[2] * fx - n[0] * fz, lz = n[0] * fy - n[1] * fx;
  const o = i * 16;
  out[o] = fx * stretch; out[o + 1] = fy * stretch; out[o + 2] = fz * stretch; out[o + 3] = 0;
  out[o + 4] = lx; out[o + 5] = ly; out[o + 6] = lz; out[o + 7] = 0;
  out[o + 8] = n[0]; out[o + 9] = n[1]; out[o + 10] = n[2]; out[o + 11] = 0;
  out[o + 12] = x + n[0] * lift; out[o + 13] = y + n[1] * lift; out[o + 14] = z + n[2] * lift;
  out[o + 15] = 1;
}

/** How far off the road the barrier stands, for anything that needs to know. */
export { BARRIER_OUT, RAIL_DEEP, TRACK_LIFT };
