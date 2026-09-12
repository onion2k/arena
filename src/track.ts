import type { Mesh } from 'artshape-render/mesh/types';
import { height, normal as groundNormal } from './terrain';
import { BIOME } from './biomes';
import { kindOf, type TrackKind } from './kind';

/** How far the tarmac sits above the ground it follows: see `scene`. */
export const TRACK_LIFT = 22;

/** Over how far past the kerbs a drawn vehicle comes back down to the ground. */
const LIFT_EASE = 120;

/**
 * How far above the terrain to draw a vehicle whose wheels are on it at a
 * point: the tarmac's lift on the road and its kerbs, easing to nothing
 * just past them.
 *
 * The physics rides the terrain, and the road is drawn `TRACK_LIFT` above
 * it — a rendering matter, enough for the ribbon to win the depth test
 * against the ground mesh's facets, and not a step anything should drive
 * over. So nothing about the driving changes with it; a car drawn where its
 * physics is sat 22mm into the tarmac, and with bodies modelled round the
 * ride height that put the sills on the road. This is what is drawn instead.
 */
export function drawnLift(x: number, y: number): number {
  const off = Math.abs(where(x, y).offset);
  const edge = TRACK_HALF * KERB_OUTER;
  if (off <= edge) return TRACK_LIFT;
  return TRACK_LIFT * Math.max(0, 1 - (off - edge) / LIFT_EASE);
}
/**
 * The circuit: a closed loop the truck races round.
 *
 * It is defined in polar form, a radius that varies with the angle about the
 * middle of the arena. That is a real constraint on the shape — no hairpins
 * that double back, no figure of eight — and it buys something worth more
 * than either: the nearest point on the centreline to anywhere in the arena
 * is the point at the same angle. So how far round the lap the truck is, is
 * `atan2(y, x)`, exactly, for nothing. No search along the curve, no
 * accumulating error, and a lap line that cannot be crossed sideways.
 */

/**
 * The shape of one circuit: a base radius and a few harmonics of the angle.
 *
 * `r(theta) = r0 + sum over terms of amp * sin(k * theta + phase)`. Every
 * term is a whole number of cycles round the loop, which is what keeps the
 * curve closed; the low harmonics are the shape of the circuit and the high
 * ones are the corners in it.
 */
export interface Shape {
  r0: number;
  /** Harmonic, amplitude, phase — one triple per term. */
  terms: [number, number, number][];
  /**
   * A wild circuit's radius and its rate of change with the angle, sampled
   * evenly round the lap from -π: straights and tight corners are not a
   * handful of harmonics, so a wild shape is carried as the numbers the rest
   * of this file reads rather than as a formula. See `generateWild`. When it
   * is here, `r0` and `terms` are not used.
   */
  table?: { r: Float64Array; d: Float64Array };
}

/** A sampled table read at an angle, linearly between samples. */
function sampled(values: Float64Array, theta: number): number {
  const n = values.length;
  let u = ((theta + Math.PI) / (Math.PI * 2)) * n;
  u = ((u % n) + n) % n;
  const i = Math.floor(u), f = u - i;
  return values[i] * (1 - f) + values[(i + 1) % n] * f;
}

/**
 * The circuit the game shipped with, and the one every generated track is
 * measured against. Its numbers: a lap of 29,099mm, a radius between 2,775
 * and 5,148, a tightest corner of 638 and a worst radial-to-across of 0.672.
 */
export const CLASSIC: Shape = {
  r0: 4200,
  terms: [[2, 700, 0], [3, 300, 1.1], [5, 440, 2.3]],
};

let shape: Shape = CLASSIC;

/** The circuit in force. Everything downstream reads it through the functions below. */
export function trackShape(): Shape { return shape; }

/**
 * Half the width of the tarmac, for the kind of circuit in force.
 *
 * A live value rather than a constant, as `SIZE` is: everything that reads
 * it — the road mesh, the kerbs, where the posts and barriers stand, how far
 * back the forest starts, the racing line's clamp — is rebuilt by
 * `useTrack`, and threading a width through all of them would be a parameter
 * that never varies independently of this one.
 *
 * A rally stage stays at 380, which is the width the game shipped with: the
 * technical is 128 across, so about six of it, and a stage is meant to be
 * somewhere you cannot choose your line freely. A racing circuit is wider —
 * see `KindSpec.half`.
 */
export let TRACK_HALF = 380;

/** Put a width in force. Everything downstream has to be rebuilt after this. */
export function setTrackHalf(half: number) { TRACK_HALF = half; }

/** The radius of the centreline at an angle. */
export function radiusAt(theta: number): number {
  if (shape.table) return sampled(shape.table.r, theta);
  let r = shape.r0;
  for (const [k, amp, phase] of shape.terms) r += amp * Math.sin(k * theta + phase);
  return r;
}

/** How fast the radius is changing with the angle. */
function dRadius(theta: number): number {
  if (shape.table) return sampled(shape.table.d, theta);
  let d = 0;
  for (const [k, amp, phase] of shape.terms) d += k * amp * Math.cos(k * theta + phase);
  return d;
}

/**
 * How much of a step along the radius counts as a step across the track.
 *
 * Everything here is measured radially, because that is what makes the
 * progress round the lap free. But the radius is only perpendicular to the
 * track where the track is a circle, and this one is not: where the radius is
 * changing fast the two are well apart, and a step outward along the radius
 * is mostly a step *along* the track rather than across it.
 *
 * Ignoring that put the trackside posts far closer to the racing line than
 * their 640mm said — 437mm of real clearance at the worst corner, against the
 * 176 a truck and a post need between them — and the first fast lap ended
 * jammed against one two hundred millimetres after the start.
 */
export function radialToAcross(theta: number): number {
  const r = radiusAt(theta);
  return r / Math.hypot(r, dRadius(theta));
}

/**
 * How far a point is from the centreline, measured to the nearest point of
 * it and not along the radius. `where().offset` is the radial measure, which
 * is exact on a circle and close on a smooth circuit; on the inside of a
 * corner tighter than the thing being placed is far from the road, the
 * nearest road can be the other leg of the corner, at another angle. The
 * road near a point is never far round the loop from it, so this searches the
 * angles either side and refines.
 */
export function roadDistance(x: number, y: number): number {
  const theta = Math.atan2(y, x);
  let best = Infinity, at = theta;
  const span = 0.9, steps = 180;
  for (let i = 0; i <= steps; i++) {
    const t = theta - span + (i / steps) * span * 2;
    const [cx, cy] = centreline(t);
    const d = Math.hypot(cx - x, cy - y);
    if (d < best) { best = d; at = t; }
  }
  let h = span / steps;
  for (let k = 0; k < 12; k++) {
    for (const t of [at - h, at + h]) {
      const [cx, cy] = centreline(t);
      const d = Math.hypot(cx - x, cy - y);
      if (d < best) { best = d; at = t; }
    }
    h /= 2;
  }
  return best;
}

/** A point on the centreline. */
export function centreline(theta: number): [number, number] {
  const r = radiusAt(theta);
  return [Math.cos(theta) * r, Math.sin(theta) * r];
}

/** Which way the track runs there, as a unit vector, in the racing direction. */
export function tangentAt(theta: number): [number, number] {
  const d = 1e-3;
  const [ax, ay] = centreline(theta - d);
  const [bx, by] = centreline(theta + d);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / len, (by - ay) / len];
}

/**
 * How far round the lap a point is, 0 to 1, and how far it is from the
 * middle of the track. Off the tarmac when the offset is past TRACK_HALF.
 *
 * The angle is the progress: that is the whole reason the track is a polar
 * curve. Racing runs anticlockwise, which is the direction the angle grows.
 */
export function where(x: number, y: number): { lap: number; offset: number } {
  const theta = Math.atan2(y, x);
  const r = Math.hypot(x, y);
  return {
    lap: (theta + Math.PI) / (Math.PI * 2),
    offset: (r - radiusAt(theta)) * radialToAcross(theta),
  };
}

/**
 * Full grip everywhere, for a bench that wants a vehicle in isolation and
 * not this circuit's shoulder. `where`'s offset is polar and the circuit is
 * a few metres across; a bench drives straight for a full top-speed run,
 * which in a few seconds covers ground the polar model was never meant to
 * answer for and reads as running wide long before it actually would on
 * the real loop. See `bench.ts`.
 */
let benchGrip = false;
export function setBenchGrip(full: boolean) { benchGrip = full; }

/** How much grip the surface gives, 1 on the tarmac and less off it. */
export function gripAt(x: number, y: number): number {
  if (benchGrip) return 1;
  const off = Math.abs(where(x, y).offset);
  if (off <= TRACK_HALF) return 1;
  // A shoulder that lets go over 200mm rather than at a line, so running wide
  // is a mistake that costs rather than a wall. The forest's own loss is a
  // third and not the 55% it was written with: at 55 a car that ran wide
  // could not put its engine down at all, so a single mistake ended a race
  // rather than costing a second of it. Sand and snow take more — see
  // `Biome.offTrackLoss`.
  return 1 - BIOME.offTrackLoss * Math.min(1, (off - TRACK_HALF) / 200);
}

/**
 * The tarmac, as slabs: a few abreast, laid along the centreline and turned
 * to follow it. Returned as triples of x, y, heading for the scene to stand
 * on the ground.
 */
export function tarmac(across: number, step: number): number[] {
  const out: number[] = [];
  const gauge = (TRACK_HALF * 2) / across;
  // walk the loop in even steps of arc rather than of angle: the radius
  // varies by a third, so even angles would bunch the slabs on the inside
  for (const theta of walk(step)) {
    const r = radiusAt(theta);
    const [tx, ty] = tangentAt(theta);
    const heading = Math.atan2(ty, tx);
    const nx = -Math.sin(theta); const ny = Math.cos(theta);
    void nx; void ny;
    // a step across the track is a longer step along the radius, by however
    // much the radius is out of square with the track here
    const perRadial = 1 / radialToAcross(theta);
    for (let i = 0; i < across; i++) {
      const d = (i - (across - 1) / 2) * gauge * perRadial;
      out.push(
        Math.cos(theta) * (r + d),
        Math.sin(theta) * (r + d),
        heading,
      );
    }
  }
  return out;
}

/** Where the posts stand: both edges of the track, evenly along it. */
/** One trackside lamp post: where its foot stands, how tall, and which way
 *  its arm reaches. */
export interface Post {
  x: number;
  y: number;
  /** A little either side of one, so a row is not mechanically identical. */
  scale: number;
  /**
   * The direction the arm and the beam go, as an angle: always across the
   * road rather than away from it.
   *
   * It belongs here and not with whatever is drawing or lighting them,
   * because it is decided by which side of the track the post is on and that
   * is decided here. Two places worked it out from the post's index in the
   * list before this, and one of them had the parity backwards for a while:
   * half the floodlights spent that time lighting the empty middle of the
   * arena while the road they stood beside stayed dark.
   */
  aim: number;
}

export function posts(step: number, clearance: number): Post[] {
  const out: Post[] = [];
  let n = 0;
  for (const theta of walk(step)) {
    const perRadial = 1 / radialToAcross(theta);
    for (const side of [-1, 1]) {
      const r = radiusAt(theta) + side * (TRACK_HALF + clearance) * perRadial;
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      // toward the road: inward for a post outside it, outward for one inside
      const aim = Math.atan2(-side * Math.sin(theta), -side * Math.cos(theta));
      out.push({ x, y, scale: n % 2 === 0 ? 1.06 : 0.94, aim });
    }
    n++;
  }
  return out;
}

/** Angles round the loop spaced by roughly `step` of arc length. */
function* walk(step: number): Generator<number> {
  let theta = 0;
  const end = Math.PI * 2;
  while (theta < end) {
    yield theta - Math.PI;
    // dtheta such that r·dtheta is about one step, allowing for the radius
    theta += step / Math.max(radiusAt(theta - Math.PI), 200);
  }
}

/** The total length of the centreline, and the tightest corner on it. */
export function measure(): { length: number; tightest: number } {
  let length = 0;
  let tightest = Infinity;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI;
    const b = ((i + 1) / n) * Math.PI * 2 - Math.PI;
    const [ax, ay] = centreline(a);
    const [bx, by] = centreline(b);
    length += Math.hypot(bx - ax, by - ay);
    // radius of the circle through three consecutive points
    const c = ((i + 2) / n) * Math.PI * 2 - Math.PI;
    const [cx, cy] = centreline(c);
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    if (area > 1e-9) {
      const r = (Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by)
        * Math.hypot(cx - ax, cy - ay)) / (4 * area);
      if (r < tightest) tightest = r;
    }
  }
  return { length, tightest };
}

/**
 * The starting gantry: a post either side of the track, each carrying a
 * column of bulbs, and the line between them.
 *
 * One post with three bulbs was too easy to miss among eighty-odd trackside
 * posts that look much the same. Two of them, taller, with five bulbs each,
 * read as a start line rather than as more scenery.
 */
export const START_BULBS = 5;

export function gantry(): {
  posts: [number, number][];
  facing: number;
  bulbHeights: number[];
} {
  const theta = -Math.PI;
  const perRadial = 1 / radialToAcross(theta);
  const [tx, ty] = tangentAt(theta);
  const r = radiusAt(theta);
  const out: [number, number][] = [];
  for (const side of [-1, 1]) {
    const rr = r + side * (TRACK_HALF + 160) * perRadial;
    out.push([Math.cos(theta) * rr, Math.sin(theta) * rr]);
  }
  const bulbHeights: number[] = [];
  for (let i = 0; i < START_BULBS; i++) bulbHeights.push(300 + i * 105);
  return { posts: out, facing: Math.atan2(-ty, -tx), bulbHeights };
}

/**
 * The tarmac, as one ribbon of triangles following the centreline.
 *
 * It was three rows of slabs before, placed at even steps of arc. That is
 * fine on a straight and wrong on a corner: the arc step is measured on the
 * centreline, so the outer row spreads apart and the inner bunches, and the
 * road broke into scattered paving wherever the track turned — worst exactly
 * where you are looking hardest.
 *
 * A ribbon has no such seams. Its vertices sit on the terrain, so it follows
 * the ground the wheels are reading rather than approximating it, lifted just
 * enough to win the depth test against it.
 */
export function trackMesh(across: number, step: number, lift = 7): Mesh {
  const rings: number[] = [];
  let theta = -Math.PI;
  const end = Math.PI;
  while (theta < end) {
    rings.push(theta);
    theta += step / Math.max(radiusAt(theta), 200);
  }
  const n = rings.length;
  const w = across + 1;
  const positions = new Float32Array(n * w * 3);
  const normals = new Float32Array(n * w * 3);
  const uvs = new Float32Array(n * w * 2);
  const indices = new Uint32Array(n * across * 6);

  for (let j = 0; j < n; j++) {
    const t = rings[j];
    const r = radiusAt(t);
    const perRadial = 1 / radialToAcross(t);
    for (let i = 0; i < w; i++) {
      const d = (i / across - 0.5) * TRACK_HALF * 2 * perRadial;
      const x = Math.cos(t) * (r + d);
      const y = Math.sin(t) * (r + d);
      const o = (j * w + i) * 3;
      positions[o] = x; positions[o + 1] = y; positions[o + 2] = height(x, y) + lift;
      const gn = groundNormal(x, y);
      normals[o] = gn[0]; normals[o + 1] = gn[1]; normals[o + 2] = gn[2];
      uvs[(j * w + i) * 2] = i / across;
      uvs[(j * w + i) * 2 + 1] = j / n;
    }
  }
  let k = 0;
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;      // the last ring joins the first: it is a loop
    for (let i = 0; i < across; i++) {
      const a = j * w + i, b = a + 1, c = j2 * w + i, d = c + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = c;
      indices[k++] = c; indices[k++] = b; indices[k++] = d;
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * The kerbs: short blocks laid end to end down both edges of the tarmac,
 * alternating between two colours, which is what this returns two of.
 *
 * The tarmac and the ground either side of it are both dark, and a change of
 * shade at a grazing angle in the dark is not an edge you can drive to. Every
 * real circuit answers this the same way, and so does this one: a banded
 * strip that catches the floodlights is legible from far enough away to plan
 * a corner, and legible at the moment two wheels are on it.
 *
 * `parity` picks alternate runs of blocks, so drawing both meshes in
 * different colours gives the stripe. They are separate meshes rather than
 * one mesh with a colour per vertex because material here belongs to a draw.
 */
export function kerbMesh(parity: 0 | 1, step = 90, lift = 30): Mesh {
  const rings: number[] = [];
  let theta = -Math.PI;
  while (theta < Math.PI) {
    rings.push(theta);
    theta += step / Math.max(radiusAt(theta), 200);
  }
  const n = rings.length;
  // two sides, two vertices across each: inner lip on the tarmac, outer lip
  // just past it
  const perRing = 4;
  const positions = new Float32Array(n * perRing * 3);
  const normals = new Float32Array(n * perRing * 3);
  const uvs = new Float32Array(n * perRing * 2);
  const edges = [-KERB_OUTER, -1, 1, KERB_OUTER];

  for (let j = 0; j < n; j++) {
    const t = rings[j];
    const r = radiusAt(t);
    const perRadial = 1 / radialToAcross(t);
    for (let i = 0; i < perRing; i++) {
      const d = edges[i] * TRACK_HALF * perRadial;
      const x = Math.cos(t) * (r + d);
      const y = Math.sin(t) * (r + d);
      const o = (j * perRing + i) * 3;
      positions[o] = x; positions[o + 1] = y; positions[o + 2] = height(x, y) + lift;
      const gn = groundNormal(x, y);
      normals[o] = gn[0]; normals[o + 1] = gn[1]; normals[o + 2] = gn[2];
      uvs[(j * perRing + i) * 2] = i / (perRing - 1);
      uvs[(j * perRing + i) * 2 + 1] = j / n;
    }
  }

  // A block is BLOCK_RINGS segments long, and every other block is ours. The
  // loop closes on an even number of blocks or the stripe would meet itself,
  // so the count is rounded rather than taken as it falls.
  const blocks = Math.max(2, Math.round(n / BLOCK_RINGS / 2) * 2);
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    if (Math.floor((j / n) * blocks) % 2 !== parity) continue;
    const j2 = (j + 1) % n;
    for (const i of [0, 2]) {
      const a = j * perRing + i, b = a + 1, c = j2 * perRing + i, d = c + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  return { positions, normals, uvs, indices: new Uint32Array(idx) };
}

/** How far past the tarmac's edge a kerb reaches, as a fraction of the half width. */
const KERB_OUTER = 1.17;
/** How many ribbon steps make one block of kerb. */
const BLOCK_RINGS = 2;

/**
 * The radius of the circle through three points on the centreline spanning
 * `span` millimetres either side of an angle: how tight the track is there.
 *
 * A driver needs this and not the curvature of the tarmac under its own
 * wheels, because what it has to decide is how fast to be by the time it
 * arrives. Straight track comes back as a very large number rather than
 * infinity, which is what a caller wants to divide by.
 */
export function curveRadius(theta: number, span: number): number {
  const dt = span / Math.max(radiusAt(theta), 200);
  const [ax, ay] = centreline(theta - dt);
  const [bx, by] = centreline(theta);
  const [cx, cy] = centreline(theta + dt);
  const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  if (area < 1e-9) return 1e9;
  return (Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by)
    * Math.hypot(cx - ax, cy - ay)) / (4 * area);
}

/**
 * Generating a circuit.
 *
 * A seed in, a shape out, and the shape is always drivable — which is the
 * whole difficulty. Harmonics drawn at random make a closed loop for free
 * (that is what whole-numbered harmonics are) but they make a *good* loop
 * only some of the time: too much amplitude in a high harmonic and there is
 * a corner tighter than the truck can turn, or a stretch where the radius
 * runs so steeply that it is barely across the track at all and the posts
 * end up on the racing line.
 *
 * So the generator proposes and then measures, and if the measurement fails
 * it tames the proposal and measures again. Taming is scaling every
 * amplitude down: in the limit that is a circle, and a circle passes every
 * test, so the loop always terminates with a track. It cannot hand back
 * something undrivable, and the fallback is a duller circuit rather than a
 * broken one.
 */

/** What a circuit has to clear to be worth driving. Measured against `CLASSIC`. */
const LIMITS = {
  /** No corner tighter than this. The truck's circle is 486mm at 1200 mm/s. */
  curve: 600,
  /** Inside this and the loop crowds the middle; outside and it leaves the arena. */
  minRadius: 2500,
  maxRadius: 5300,
  /**
   * How square the radius has to stay to the track. Everything here is
   * measured radially — that is what makes the lap progress free — and where
   * the radius runs steeply it is mostly *along* the road rather than across
   * it, which is what puts a post the road's own width closer than its
   * clearance says.
   */
  across: 0.62,
  /** A lap wants to stay within a few seconds of the ones before it. */
  minLength: 24000,
  maxLength: 34000,
};

/** Everything the limits are about, measured round a whole lap. */
export function measureShape(s: Shape, steps = 1440): {
  minRadius: number; maxRadius: number; curve: number; across: number; length: number;
} {
  const was = shape;
  shape = s;
  let minRadius = Infinity, maxRadius = -Infinity, curve = Infinity, across = Infinity, length = 0;
  let prev = centreline(-Math.PI);
  for (let i = 1; i <= steps; i++) {
    const t = -Math.PI + (i / steps) * Math.PI * 2;
    const r = radiusAt(t);
    minRadius = Math.min(minRadius, r);
    maxRadius = Math.max(maxRadius, r);
    curve = Math.min(curve, curveRadius(t, 260));
    across = Math.min(across, radialToAcross(t));
    const p = centreline(t);
    length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  shape = was;
  return { minRadius, maxRadius, curve, across, length };
}

/**
 * What this kind of circuit has to clear. The arena's own bounds and how
 * square the radius stays to the road belong to the arena and do not move;
 * the tightest corner and the length of a lap belong to the racing and do.
 */
/**
 * How a track's own corner limit is drawn across its range: one is even,
 * and above one leans toward the tight end, which makes more circuits with
 * a slow corner on them. Swept against the share of tracks landing in each
 * of the five bands, pooled over the two racing classes, three hundred
 * seeds each:
 *
 *     skew  flat out  fast  balanced  technical  stop-go
 *     1.0        50%   16%       17%        13%       4%
 *     1.4        41%   15%       19%        18%       7%
 *     1.8        33%   17%       19%        22%       9%
 *     2.4        27%   15%       21%        26%      11%
 *
 * 1.8: a third of tracks flat out, which is what a set of racing circuits
 * should be, and a tail with real corners in it rather than four percent.
 */
const CURVE_SKEW = 1.8;

export function limitsFor(kind: TrackKind, seed?: number): typeof LIMITS {
  const k = kindOf(kind);
  let curve = k.curve;
  if (k.curveRange && seed !== undefined) {
    // one draw a seed, deterministic and even across the range: the circuit
    // for a seed is the circuit for that seed, whoever asks and whenever
    const [lo, hi] = k.curveRange;
    curve = lo + (hi - lo) * Math.pow(random(((seed + 1) * 0x9e3779b9) >>> 0)(), CURVE_SKEW);
  }
  return { ...LIMITS, curve, minLength: k.minLength, maxLength: k.maxLength };
}

function passes(m: ReturnType<typeof measureShape>, lim: typeof LIMITS): boolean {
  return m.curve >= lim.curve
    && m.minRadius >= lim.minRadius && m.maxRadius <= lim.maxRadius
    && m.across >= lim.across
    && m.length >= lim.minLength && m.length <= lim.maxLength;
}

/** A small deterministic generator, so a seed always gives the same circuit. */
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

/**
 * Turn the shape so its straightest point is on the start line.
 *
 * The grid sits at an angle of -pi whatever the circuit does there, and on a
 * random one that can be the apex of the tightest corner on the lap: lights
 * out, and the first thing you do is understeer into the scenery. Finding
 * where the curve is flattest and rotating the whole shape to put it there
 * costs a scan and makes every generated circuit start on a straight.
 *
 * Rotating is free in this form. Replacing theta with theta + off inside
 * `sin(k * theta + phase)` is the same as adding `k * off` to the phase, so
 * the shape turns without any of the geometry being recomputed.
 */
function turnStartToStraight(s: Shape, steps = 360): Shape {
  const was = shape;
  shape = s;
  let best = -Math.PI, flattest = -Infinity;
  for (let i = 0; i < steps; i++) {
    const t = -Math.PI + (i / steps) * Math.PI * 2;
    const r = curveRadius(t, 400);
    if (r > flattest) { flattest = r; best = t; }
  }
  shape = was;
  const off = best - -Math.PI;
  return { r0: s.r0, terms: s.terms.map(([k, amp, phase]) => [k, amp, phase + k * off]) };
}

/**
 * A circuit for a seed. Always drivable: see the note above about proposing
 * and measuring. Seed zero is the circuit the game shipped with.
 *
 * The repair is aimed rather than blanket. Scaling every amplitude down
 * fixes anything, but it fixes the shape as well as the fault: a circuit
 * with one corner too tight came back as a gentler version of itself all
 * over, and forty seeds in a row produced the same rounded blob at
 * different rotations. Curvature goes as `amp * k^2`, so a corner that is
 * too tight is nearly always the highest harmonic's doing and taking it out
 * of that one leaves the low harmonics — which are the shape of the circuit —
 * alone. The radius bounds move `r0`, which is what sets them. Only when a
 * fault will not come out any other way does everything come down together.
 */
export function generateTrack(seed: number, kind: TrackKind = 'rally'): Shape {
  // Seed zero is the circuit the game shipped with — a rally stage, with a
  // 733mm corner in it, which is half of what a racing track allows. So it
  // is seed zero of the rally only: a racing track's seed zero is generated
  // like every other, and is the fastest circuit the generator draws.
  if (seed === 0 && kind === 'rally') return CLASSIC;
  // A racing track's seeds are the rally's, stirred: `random` folds zero to
  // one, so a track's #0 and #1 came back the same circuit — and a track
  // that was the same shape as the stage of the same number, only smoothed,
  // would make the two kinds read as one circuit with a switch on it.
  const rnd = random(kind === 'track' ? (((seed + 1) * 2654435761) ^ 0x5bd1e995) >>> 0 : seed);
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];

  // One low harmonic for the shape of the circuit and two or three above it
  // for what happens round it. A first harmonic pushes the whole loop off
  // centre, which is what makes a circuit with one long side; sevens and
  // eights are the ones that put a corner between two corners.
  const low = pick([1, 2, 2, 2, 3]);
  const mid = pick([3, 3, 4, 4, 5]);
  const high = pick([5, 6, 6, 7, 8]);
  const extra = rnd() < 0.45 ? pick([2, 3, 4, 5, 9]) : 0;
  const r0 = 3700 + rnd() * 800;
  // A power rather than a flat range, so most circuits have one term that
  // dominates and the rest decorate it — which is what a circuit with a
  // character is. Flat ranges gave three terms of much the same size every
  // time, and three harmonics of equal weight average out into a circle.
  const amp = (lo: number, hi: number) => lo + (hi - lo) * Math.pow(rnd(), 0.7);
  let terms: [number, number, number][] = [
    [low, amp(350, 1150), rnd() * Math.PI * 2],
    [mid, amp(120, 620), rnd() * Math.PI * 2],
    [high, amp(90, 430), rnd() * Math.PI * 2],
  ];
  if (extra) terms.push([extra, amp(60, 280), rnd() * Math.PI * 2]);

  const lim = limitsFor(kind, seed);
  let base = r0;
  // A racing track's limits are the harder pair to satisfy — a long corner
  // and a long lap pull against each other — so it is given half as many
  // goes again before the fallback
  for (let i = 0, tries = kind === 'track' ? 36 : 24; i < tries; i++) {
    const s = turnStartToStraight({ r0: base, terms });
    const m = measureShape(s);
    if (passes(m, lim)) return s;

    // Aim the repair at whatever failed.
    if (m.minRadius < lim.minRadius || m.maxRadius > lim.maxRadius) {
      const span = (m.maxRadius - m.minRadius) / 2;
      const room = (lim.maxRadius - lim.minRadius) / 2;
      if (span > room) {
        // the loop is wider than the arena however it is centred
        terms = terms.map(([k, a, p]) => [k, a * 0.9, p]);
      } else {
        // it only needs centring
        base = (lim.minRadius + lim.maxRadius) / 2 + (base - (m.minRadius + m.maxRadius) / 2);
      }
    } else if (m.curve < lim.curve) {
      // take it out of the sharpest term, which is the one bending the road
      let worst = 0;
      for (let j = 1; j < terms.length; j++) {
        if (terms[j][1] * terms[j][0] ** 2 > terms[worst][1] * terms[worst][0] ** 2) worst = j;
      }
      terms[worst] = [terms[worst][0], terms[worst][1] * 0.78, terms[worst][2]];
    } else if (m.across < lim.across) {
      // the radius is running along the road rather than across it, which is
      // a first derivative and so goes as amp * k
      let worst = 0;
      for (let j = 1; j < terms.length; j++) {
        if (terms[j][1] * terms[j][0] > terms[worst][1] * terms[worst][0]) worst = j;
      }
      terms[worst] = [terms[worst][0], terms[worst][1] * 0.82, terms[worst][2]];
    } else {
      // the lap is the wrong length, which is mostly how big the loop is
      base *= m.length < lim.minLength ? 1.06 : 0.95;
    }
  }
  return FALLBACK[kind];
}

/**
 * What a seed falls back to when the repair cannot satisfy its limits.
 *
 * The rally's is the circuit the game shipped with. A racing track cannot
 * have that one — it has a 733mm corner in it, half of what this kind
 * allows — so it has a fallback of its own: a long oval with one kink, which
 * is dull and is meant to be. A fallback that breaks the rules of the kind
 * it stands in for is worse than a dull circuit; it is a circuit the cars
 * offered for it cannot drive.
 */
const FALLBACK: Record<TrackKind, Shape> = {
  rally: CLASSIC,
  track: { r0: 4250, terms: [[2, 620, 0.4], [3, 210, 2.2]] },
};

/** Put a circuit in force. Everything downstream has to be rebuilt after this. */
export function setTrack(s: Shape) { shape = s; }

/**
 * The same circuit, bigger or smaller. `r0` and every amplitude scale by `k`
 * and the phases are untouched, which is a similarity — the shape does not
 * change, only its size — so everything `measureShape` reports (`length`,
 * `minRadius`, `maxRadius`, `curve`) scales by `k` too and `across`, a ratio,
 * does not move at all. A shape that cleared `LIMITS` at one size therefore
 * clears the geometric limits at every size: nothing here can hand back an
 * escaped or crowded loop. `curve` is the one limit that is not geometry but
 * the truck's own turning circle, and it is not honoured below `k = 1` — the
 * smallest size is meant to be tight, and the difficulty rating (computed on
 * the scaled shape) says so honestly rather than pretending every size drives
 * the same.
 */
export function scaleShape(s: Shape, k: number): Shape {
  const scaled: Shape = { r0: s.r0 * k, terms: s.terms.map(([kk, amp, phase]) => [kk, amp * k, phase]) };
  if (s.table) scaled.table = { r: s.table.r.map((v) => v * k), d: s.table.d.map((v) => v * k) };
  return scaled;
}

/** A circuit for a seed, at a size, smooth or wild. Same seed, same shape, any size. */
export function circuitFor(seed: number, size: number, wild = false, kind: TrackKind = 'rally'): Shape {
  // a racing circuit has no wild variant: straights and hairpins are the
  // rally's idea of interesting and a racing circuit's idea of a mistake
  const shape = wild && kindOf(kind).wild ? generateWild(seed) : generateTrack(seed, kind);
  return scaleShape(shape, size);
}

/**
 * What a wild circuit has to clear. The same arena and the same road as a
 * smooth one — the radius bounds and how square the radius stays to the road
 * are unchanged — but the tightest corners the road can hold, a lap that may
 * run a little longer, and at least one straight worth the name.
 *
 * The corner was 380mm, near the technical's own circle, while the road was
 * 380 either side of the line: the inside edge of such a corner is a point,
 * and the road folded through itself there. It went unnoticed because a
 * hairpin that tight is rare even among wild seeds. Now the road is 480
 * either side and the floor is 720 — still half of what a smooth stage
 * allows, so a wild circuit keeps the hairpin that is the point of it.
 */
export const WILD_LIMITS = {
  // 450: the tightest the generator reliably places — at 520 a quarter of
  // seeds fall back and at 600 three quarters — and comfortably clear of
  // the 300 half width a wild stage is given, so the road does not fold
  curve: 450,
  maxLength: 38000,
  longestStraight: 5500,
  /** How finely the radius is sampled round the lap. */
  samples: 4096,
};

type P = [number, number];

/**
 * A wild circuit: straights, and corners that are arcs where the smooth
 * circuits have waves.
 *
 * Five to eight corner points are thrown round the middle of the arena at
 * increasing angles and different distances from it, which makes a polygon
 * that every ray from the middle crosses once — what the polar form needs.
 * Each corner is rounded off with an arc, most of them tight, some sweeping,
 * as far as the straights either side leave room for, and the lap is sampled
 * as the radius a ray at each angle meets it at. A proposal that a ray meets
 * twice — a rounded corner can bulge back past the middle's line of sight —
 * or that misses a limit is thrown away and another thrown; after two hundred
 * it falls back to a smooth circuit for the seed, which has never happened
 * in the seeds tested.
 *
 * The start line goes on the middle of the longest straight.
 */
export function generateWild(seed: number): Shape {
  const rnd = random((seed * 2654435761) ^ 0x5bd1e995);
  const n = WILD_LIMITS.samples;
  for (let attempt = 0; attempt < 200; attempt++) {
    const corners = 5 + Math.floor(rnd() * 4);
    const turn = rnd() * Math.PI * 2;
    const pts: P[] = [];
    for (let i = 0; i < corners; i++) {
      const a = turn + ((i + (rnd() - 0.5) * 0.55) / corners) * Math.PI * 2;
      const r = 3300 + rnd() * 1900;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }

    // round every corner off: an arc tangent to both straights
    type Arc = { c: P; rho: number; from: number; sweep: number; t1: P; t2: P };
    const arcs: Arc[] = [];
    let ok = true;
    for (let i = 0; i < corners; i++) {
      const A = pts[(i + corners - 1) % corners], B = pts[i], C = pts[(i + 1) % corners];
      const la = Math.hypot(B[0] - A[0], B[1] - A[1]), lc = Math.hypot(C[0] - B[0], C[1] - B[1]);
      const u: P = [(B[0] - A[0]) / la, (B[1] - A[1]) / la], v: P = [(C[0] - B[0]) / lc, (C[1] - B[1]) / lc];
      const cross = u[0] * v[1] - u[1] * v[0];
      const phi = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
      if (phi < 0.05 || phi > 2.6) { ok = false; break; }
      const want = rnd() < 0.55 ? 380 + rnd() * 340 : rnd() < 0.8 ? 900 + rnd() * 800 : 1800 + rnd() * 1400;
      let t = want * Math.tan(phi / 2);
      t = Math.min(t, 0.46 * Math.min(la, lc));
      const rho = t / Math.tan(phi / 2);
      const t1: P = [B[0] - u[0] * t, B[1] - u[1] * t], t2: P = [B[0] + v[0] * t, B[1] + v[1] * t];
      const side = cross > 0 ? 1 : -1;
      const c: P = [t1[0] - u[1] * rho * side, t1[1] + u[0] * rho * side];
      arcs.push({ c, rho, from: Math.atan2(t1[1] - c[1], t1[0] - c[0]), sweep: phi * side, t1, t2 });
    }
    if (!ok) continue;
    const straights = arcs.map((arc, i) => [arcs[(i + corners - 1) % corners].t2, arc.t1] as [P, P]);

    // where a ray from the middle meets the lap, at every sampled angle
    const r = new Float64Array(n);
    for (let j = 0; j < n && ok; j++) {
      const th = -Math.PI + (j / n) * Math.PI * 2;
      const dx = Math.cos(th), dy = Math.sin(th);
      const hits: number[] = [];
      for (const [a, b] of straights) {
        const ex = b[0] - a[0], ey = b[1] - a[1];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const dist = (a[0] * ey - a[1] * ex) / den;
        const w = (a[0] * dy - a[1] * dx) / den;
        if (dist > 0 && w >= -1e-9 && w <= 1 + 1e-9) hits.push(dist);
      }
      for (const arc of arcs) {
        const b = dx * arc.c[0] + dy * arc.c[1];
        const disc = b * b - (arc.c[0] ** 2 + arc.c[1] ** 2 - arc.rho ** 2);
        if (disc < 0) continue;
        for (const dist of [b - Math.sqrt(disc), b + Math.sqrt(disc)]) {
          if (dist <= 0) continue;
          let ang = Math.atan2(dy * dist - arc.c[1], dx * dist - arc.c[0]) - arc.from;
          ang = arc.sweep > 0 ? ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : -(((-ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
          if (Math.abs(ang) <= Math.abs(arc.sweep) + 1e-9) hits.push(dist);
        }
      }
      hits.sort((p, q) => p - q);
      const distinct = hits.filter((h, k) => k === 0 || h - hits[k - 1] > 0.5);
      if (distinct.length !== 1) ok = false;
      else r[j] = distinct[0];
    }
    if (!ok) continue;

    // the start line on the middle of the longest straight
    let longest = 0, mid: P = [1, 0];
    for (const [a, b] of straights) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > longest) { longest = len; mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    }
    if (longest < WILD_LIMITS.longestStraight) continue;
    const shift = Math.round(((Math.atan2(mid[1], mid[0]) + Math.PI) / (Math.PI * 2)) * n);
    const turned = new Float64Array(n);
    for (let j = 0; j < n; j++) turned[j] = r[(j + shift) % n];
    const d = new Float64Array(n);
    const step = (Math.PI * 2) / n;
    for (let j = 0; j < n; j++) d[j] = (turned[(j + 1) % n] - turned[(j + n - 1) % n]) / (2 * step);

    const candidate: Shape = { r0: 0, terms: [], table: { r: turned, d } };
    const m = measureShape(candidate);
    if (m.curve >= WILD_LIMITS.curve && m.minRadius >= LIMITS.minRadius && m.maxRadius <= LIMITS.maxRadius
      && m.across >= LIMITS.across && m.length >= LIMITS.minLength && m.length <= WILD_LIMITS.maxLength) {
      return candidate;
    }
  }
  return generateTrack(seed);
}

/**
 * Everything a track-select screen needs to draw a circuit it has not
 * committed to: the outline, a box round it, where the start line goes, and
 * what the thing measures.
 *
 * It swaps the shape in, reads what it needs, and puts the old one back — so
 * a screen can flip through candidates without any of the arena being built
 * for them. Building one costs 35ms of meshes, posts and forest; drawing one
 * costs this.
 */
export function shapePreview(s: Shape, steps = 400): {
  path: string;
  box: [number, number, number, number];
  start: [number, number, number, number];
  length: number;
  curve: number;
} {
  const m = measureShape(s);
  const was = shape;
  shape = s;
  let lo = Infinity, hi = -Infinity;
  let path = '';
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI + (i / steps) * Math.PI * 2;
    const [x, y] = centreline(t);
    lo = Math.min(lo, x, -y); hi = Math.max(hi, x, -y);
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(0)} ${(-y).toFixed(0)}`;
  }
  path += 'Z';
  const [sx, sy] = centreline(-Math.PI);
  const [tx, ty] = tangentAt(-Math.PI);
  shape = was;
  const pad = TRACK_HALF + 300;
  return {
    path,
    box: [lo - pad, lo - pad, hi - lo + pad * 2, hi - lo + pad * 2],
    start: [sx + ty * TRACK_HALF, -(sy - tx * TRACK_HALF), sx - ty * TRACK_HALF, -(sy + tx * TRACK_HALF)],
    length: m.length,
    curve: m.curve,
  };
}

/**
 * How hard a circuit is to drive, and how long a lap of it should take.
 *
 * The honest way to rate a circuit is to drive it, and the screen that wants
 * the rating cannot wait for that. So this drives an ideal point mass round
 * the centreline instead: a speed limit at every step from how tight the
 * road is there, then a pass backwards for what braking allows into each
 * corner and a pass forwards for what the engine can put back on the way
 * out. The time that falls out is what a lap costs when nothing is wasted.
 *
 * That is the difficulty, and it is what the pilot's lifting follows (see
 * `calibrate.ts`). It is not quite the par time. Driven by the pilot, every
 * class laps a smooth circuit in its length at the class's top speed times a
 * constant, to within 2 to 4% — the corners cost a tidy driver almost
 * nothing — and a wild circuit's tight corners cost a little. So par is that
 * constant (`rating.par`) times the flat-out lap, plus `CORNER_SHARE` of
 * what the point mass loses to the corners. It
 * was the point-mass lap times 1.13, from the rivals' laps, which was 9 to
 * 11% off the pilot's laps on average for the technical and the rally car
 * and 9 to 15% for the other two.
 *
 * The cornering limit is measured, not derived. Ackermann on a 220mm
 * wheelbase says the truck can turn a 547mm radius at top speed, which would
 * make every corner on every circuit here flat out; the tyre model says
 * otherwise, and what it actually does at full lock is a circle of 450 to
 * 570mm at 1130 to 1630 mm/s. That is `v = CORNER * sqrt(R)` with CORNER at
 * 61, and it puts the tightest corner on the original circuit at 1541 mm/s
 * against a top speed of 2300 — which is why circuits differ at all.
 */
/**
 * The three numbers above, as one record: what a class of vehicle is rated
 * by. Every `VehicleSpec` carries its own (see `vehicles.ts`), measured the
 * same way the technical's were — full lock at a held speed for the corner,
 * mid-range throttle for the accel, the flat for the brake — and `rateTrack`
 * takes whichever one belongs to the vehicle a lap is being rated for.
 */
export interface CornerRating {
  corner: number;
  accel: number;
  brake: number;
  /** A driven lap over a lap at flat out: par is this times the circuit's
   *  length at top speed. Fitted per class — see `calibrate.ts`. */
  par: number;
}
/**
 * The five bands, on the quantiles of three hundred generated circuits, so
 * each is about a fifth of what the generator makes. The original circuit
 * scores 0.024, which is the second band: it is a friendly circuit, and
 * saying otherwise on a screen the player is about to check against their
 * own lap times would not survive the first lap.
 *
 * **One table a kind, and the tracks had to earn theirs.** The difficulty
 * is the share of a lap the corners take, and a racing circuit loses an
 * order of magnitude less of it than a stage does. Read against the
 * stages' table every track is *flowing* — true, and useless. The first
 * attempt at a repair was the tracks' own quintiles, and the measurement
 * said no: with every track held to the same corner limit the pilot's lap
 * had no relationship with the number (r = -0.26), because sixteen
 * circuits whose slowest corner ran from 83% to 93% of top speed are
 * sixteen versions of the same lap, and what varied between them was the
 * pilot rather than the road.
 *
 * So the generator was changed before the band was: a track draws its own
 * corner limit (`KindSpec.curveRange`), some have a hairpin on them and
 * some are flat out, and the difficulty then follows the pilot's lifting
 * at r = 0.93 — better than the stages' 0.85. The table below is that
 * distribution banded so the words divide tracks against each other.
 */
const BANDS: Record<TrackKind, [number, string][]> = {
  rally: [
    [0.019, 'flowing'],
    [0.031, 'open'],
    [0.042, 'mixed'],
    [0.058, 'technical'],
    [Infinity, 'relentless'],
  ],
  // A racing circuit's words, and thresholds rather than quintiles: the
  // distribution is skewed — a third of tracks cost the corners nothing at
  // all — so equal fifths would put two band edges inside the noise at
  // zero. These are the shares in the sweep beside `CURVE_SKEW`.
  track: [
    [0.002, 'flat out'],
    [0.01, 'fast'],
    [0.03, 'balanced'],
    [0.07, 'technical'],
    [Infinity, 'stop-go'],
  ],
};

/** A difficulty as a level of one to five and the word for it, in its kind's own terms. */
export function difficultyBand(d: number, kind: TrackKind = 'rally'): { level: number; name: string } {
  const bands = BANDS[kind] ?? BANDS.rally;
  for (let i = 0; i < bands.length; i++) {
    if (d < bands[i][0]) return { level: i + 1, name: bands[i][1] };
  }
  return { level: 5, name: bands[4][1] };
}

/**
 * The slowest the ideal line ever goes, as a fraction of the car's top
 * speed and in the game's own units — what a track is quoted instead of a
 * difficulty.
 *
 * It is a fact rather than a verdict: this is the corner you will be
 * slowest in, and on a racing circuit that is the thing worth knowing
 * before you commit to a lap. It varies where the band does not — over the
 * first sixteen tracks the F1's slowest corner runs from 62% of top speed
 * to flat out — and it makes no claim about how hard the lap is.
 */
export function slowestCorner(s: Shape, topSpeed: number, rating: CornerRating, steps = 720): { speed: number; share: number } {
  const { v } = speedPlan(s, topSpeed, rating, true, steps);
  let slowest = topSpeed;
  for (let i = 0; i < v.length; i++) slowest = Math.min(slowest, v[i]);
  return { speed: slowest, share: slowest / topSpeed };
}

/**
 * The speed an ideal point mass carries at each step round a lap: the corner
 * limit at every step, then a pass backwards for what braking allows into
 * each corner and — unless `accel` is false — a pass forwards for what the
 * engine can put back on the way out. `rateTrack` times a lap from this; a
 * pilot (`pilot.ts`) drives to it with the forward pass left off, since how
 * hard the car accelerates is the car's business and not the plan's.
 */
export function speedPlan(s: Shape, topSpeed: number, rating: CornerRating, accel = true, steps = 720): {
  v: number[];
  ds: number[];
} {
  const was = shape;
  shape = s;
  const ds: number[] = [];
  const lim: number[] = [];
  let prev = centreline(-Math.PI);
  for (let i = 0; i < steps; i++) {
    const t = -Math.PI + ((i + 1) / steps) * Math.PI * 2;
    const p = centreline(t);
    ds.push(Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    lim.push(Math.min(topSpeed, rating.corner * Math.sqrt(curveRadius(t, 200))));
    prev = p;
  }
  shape = was;

  const v = lim.slice();
  // Twice round each way, because the lap wraps: a corner can be slow enough
  // that the braking zone for it starts before the line.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = steps - 1; i >= 0; i--) {
      const next = v[(i + 1) % steps];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * rating.brake * ds[i]));
    }
    if (!accel) continue;
    for (let i = 0; i < steps; i++) {
      const back = v[(i - 1 + steps) % steps];
      v[i] = Math.min(v[i], Math.sqrt(back * back + 2 * rating.accel * ds[i]));
    }
  }
  return { v, ds };
}

/**
 * How much of what the corners cost the point mass a driven lap pays. The
 * point mass brakes to its corner limit and accelerates back out at a
 * constant rate, which is pessimistic by a long way on a car that is at top
 * speed nearly everywhere; a fifth of it is what the pilot's laps come to, the
 * same fifth, near enough, for all four classes (0.18 to 0.22 fitted one at a
 * time). See `calibrate.ts`.
 */
export const CORNER_SHARE = 0.2;

export function rateTrack(s: Shape, topSpeed: number, rating: CornerRating, steps = 720): {
  /** Seconds for a lap driven perfectly by the point mass. */
  lap: number;
  /** Seconds for a lap at top speed all the way round. */
  flatOut: number;
  /**
   * What a clean lap comes out at: the flat-out lap times `rating.par`, and
   * a share of what the corners cost the point mass on top. It was the
   * flat-out lap alone, which a wild circuit's tight corners made 1 to 3%
   * optimistic and a smooth circuit 1 to 2% pessimistic once the constant
   * was fitted to both.
   */
  par: number;
  /** 0 for a circuit you never lift on, 1 for one you are never flat out on. */
  difficulty: number;
} {
  const { v, ds } = speedPlan(s, topSpeed, rating, true, steps);
  let lap = 0, length = 0;
  for (let i = 0; i < steps; i++) {
    const mean = (v[i] + v[(i + 1) % steps]) / 2;
    lap += ds[i] / Math.max(mean, 1);
    length += ds[i];
  }
  const flatOut = length / topSpeed;
  return {
    lap,
    flatOut,
    par: flatOut * rating.par + CORNER_SHARE * (lap - flatOut),
    difficulty: Math.max(0, Math.min(1, 1 - flatOut / lap)),
  };
}
