import type { Mesh } from 'artshape-render/mesh/types';
import { height, normal as groundNormal } from './terrain';
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

const R0 = 4200;
const WOBBLE = 700;
const KINK = 300;
const KINK_PHASE = 1.1;
/**
 * A third, faster term. Scaling a track up scales every corner with it, so a
 * circuit three times the size is three times easier to drive — this puts
 * corners back in that are tight against the truck rather than against the
 * radius of the loop.
 */
const TWIST = 440;
const TWIST_PHASE = 2.3;

/** Half the width of the tarmac. The truck is 128 across, so about five of it. */
export const TRACK_HALF = 380;

/** The radius of the centreline at an angle. */
export function radiusAt(theta: number): number {
  return R0 + WOBBLE * Math.sin(2 * theta) + KINK * Math.sin(3 * theta + KINK_PHASE)
    + TWIST * Math.sin(5 * theta + TWIST_PHASE);
}

/** How fast the radius is changing with the angle. */
function dRadius(theta: number): number {
  return 2 * WOBBLE * Math.cos(2 * theta)
    + 3 * KINK * Math.cos(3 * theta + KINK_PHASE)
    + 5 * TWIST * Math.cos(5 * theta + TWIST_PHASE);
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
function radialToAcross(theta: number): number {
  const r = radiusAt(theta);
  return r / Math.hypot(r, dRadius(theta));
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

/** How much grip the surface gives, 1 on the tarmac and less off it. */
export function gripAt(x: number, y: number): number {
  const off = Math.abs(where(x, y).offset);
  if (off <= TRACK_HALF) return 1;
  // A shoulder that lets go over 200mm rather than at a line, so running wide
  // is a mistake that costs rather than a wall. It takes away a third and not
  // the 55% it was written with: at 55 a car that ran wide could not put its
  // engine down at all, so a single mistake ended a race rather than costing
  // a second of it.
  return 1 - 0.32 * Math.min(1, (off - TRACK_HALF) / 200);
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
 * Which way is the outside of the bend at an angle, and how tight it is:
 * the unit vector pointing away from the centre of the circle the centreline
 * is following there, and that circle's radius.
 *
 * A driver aiming at a point some way up the road drives the chord and not
 * the arc, and so passes inside the centreline by the sagitta of that chord —
 * at the tightest corner here, with a normal look-ahead, 178mm of a track
 * whose half width is 380. This is what a driver needs to put that back.
 */
export function curveOutward(theta: number, span: number): [number, number, number] {
  const dt = span / Math.max(radiusAt(theta), 200);
  const [ax, ay] = centreline(theta - dt);
  const [bx, by] = centreline(theta);
  const [cx, cy] = centreline(theta + dt);
  // the circumcentre of the three points
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [0, 0, 1e9];
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const ox = bx - ux, oy = by - uy;
  const r = Math.hypot(ox, oy) || 1;
  return [ox / r, oy / r, r];
}
