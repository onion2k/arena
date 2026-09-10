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
import { TRACK_HALF, TRACK_LIFT, centreline, curveRadius, radialToAcross, radiusAt, tangentAt } from './track';
import { part } from './scene';
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

/**
 * Where the signs stand, as a true across-track distance.
 *
 * Measured out from the middle of the road, everything is spoken for: tarmac
 * to 380, shoulder to 580, tyre stacks 590 to 658 at an apex, the barrier
 * 665 to 695, the lamp poles from about 833. The band between the barrier
 * and the poles is the only one free the whole way round, and this sits in
 * it.
 *
 * It is applied along the RADIUS with the across-track correction, the way
 * `posts()` places the lamp posts, and not along the tangent's normal the
 * way the barriers are. The two are different families of curves and they
 * cross: a nominal 760 measured off the tangent normal reads anywhere from
 * 689 to 905 as a real across-track distance, which is the difference
 * between standing behind the barrier and standing in front of a lamp post.
 * Every sign here is checked with `where().offset` afterwards, which is the
 * only number that means anything.
 */
const SIGN_OUT = 730;
/** How far apart the countdown boards are, along the line they stand on. */
const BOARD_GAP = 400;
/** The nearest board to the corner. Three of them reach back 1200. */
const BOARD_FIRST = 400;
/** A bar on a board, and the post that carries them. */
const BAR_W = 104, BAR_D = 7, BAR_H = 24, BAR_PITCH = 34, BAR_LOW = 96;
const BOARD_POST = 17, BOARD_POST_H = 176;
/**
 * The board behind the bars, the same for one bar or three.
 *
 * Bars alone read as an aerial rather than a sign: a pale stripe against the
 * night has nothing to be a stripe *on*, and at driving distance the post
 * and its bars come out as a cross. A dark board behind them is what makes a
 * stripe a marking, and it is the same trick the chevrons already use. A
 * one-bar board is the same size as a three-bar one, which is also what a
 * real countdown marker does — the board is the ruler, the stripes are the
 * reading.
 */
const BOARD_W = 118, BOARD_H = 122, BOARD_MID = 130;
/** The chevron panel, and the mark on its face. */
const CHEV_W = 128, CHEV_D = 10, CHEV_H = 58, CHEV_MID = 104;

const DRUM_R = 24;
const DRUM_H = 70;
const TYRE_R = 34;
const TYRE_H = 96;

/** Something round the truck has to go round. */
export interface Bollard { x: number; y: number; r: number; kind: 'drum' | 'tyre'; turn: number; }
/** A run of barrier, as the line its face follows. */
export interface Rail { x1: number; y1: number; x2: number; y2: number; }
/** One roadside sign: where it stands, which way it faces, and what it is. */
export interface Sign {
  x: number; y: number;
  /** The way it looks, which is back up the road at whoever is coming. */
  yaw: number;
  kind: 'board' | 'chevron';
  /** For a board, how many bars: three at 1200 out, one at 400. */
  bars: number;
  /** For a chevron, which way the corner goes: +1 turns left of travel. */
  hand: number;
}

export let RAILS: Rail[] = [];
export let BOLLARDS: Bollard[] = [];
export let SIGNS: Sign[] = [];

export const railMesh = (): Mesh => box(RAIL, RAIL_DEEP, RAIL_TALL);
export const railPostMesh = (): Mesh => box(30, 30, RAIL_MID + RAIL_TALL / 2);
export const drumMesh = (): Mesh => prism(DRUM_R, DRUM_H, 12);
/** A countdown bar, lying across the driver's view; the post that holds it. */
export const barMesh = (): Mesh => box(BAR_D, BAR_W, BAR_H);
export const signPostMesh = (): Mesh => box(BOARD_POST, BOARD_POST, BOARD_POST_H);
/** The chevron's backing board, and the mark on it. */
export const chevronPanelMesh = (): Mesh => box(CHEV_D, CHEV_W, CHEV_H);
/** The countdown board's own backing, taller than a chevron's to hold three bars. */
export const boardPanelMesh = (): Mesh => box(CHEV_D, BOARD_W, BOARD_H);
/**
 * The chevron itself, from the library's own outline rather than built out
 * of boxes at an angle. A plate off `chevron()` is 428 triangles against 24
 * for two boxes, which is the sort of trade that went wrong once here — a
 * lamp post out of the jewellery library cost 1,930 triangles each and 42%
 * of everything the shadow maps drew. The arithmetic is different at this
 * count: twenty-odd chevrons is 9,000 triangles against 115,000 in the
 * arena, and two boxes at an angle cannot be one instanced draw anyway,
 * because a placement here is a position and a heading and not a rotation
 * in the panel's own plane.
 *
 * `width` spans the outline's Y and `rise` runs along its X, and `placeMark`
 * puts Y up the panel — so the numbers read backwards from what a chevron
 * looks like. Width is the mark's HEIGHT and rise plus bar is how far it
 * reaches across. At 96 and 54 the mark stood 96 tall on a 58-tall board and
 * both tails hung off it into the night, which is the very thing the boards
 * were added to stop.
 */
export const chevronMarkMesh = (): Mesh =>
  part('plate(chevron(width: 46, rise: 48, bar: 22), thickness: 7)');
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
  SIGNS = [];

  /**
   * A point on the sign line, `SIGN_OUT` out on the given side.
   *
   * Radial, with the across-track correction: a step outward along the
   * radius is only a step across the road where the road is a circle, and
   * this one is not. Without the correction a nominal 730 lands at 511 on
   * the worst stretch of the shipped circuit — inside the barrier and on the
   * shoulder the driver uses.
   */
  const signAt = (t: number, outward: number): [number, number] => {
    const r = radiusAt(t) + outward * (SIGN_OUT / radialToAcross(t));
    return [Math.cos(t) * r, Math.sin(t) * r];
  };

  /**
   * Which way along the radius is the same way the barrier went.
   *
   * The two conventions in this file do not agree about what `side` means
   * and there is no reason they should: the barriers step along the
   * tangent's left normal, which on a loop travelled anticlockwise points
   * *inwards*, and the signs step along the radius, which points out. Taken
   * as the same number the chevrons ended up on the far side of the road
   * from the Armco they are supposed to be standing behind. So this asks
   * where the barrier actually is rather than assuming — it is one hypot per
   * corner and it cannot be got backwards.
   */
  const outwardOf = (s: ReturnType<typeof at>, side: number): number => {
    const [bx, by] = edge(s, side);
    return Math.hypot(bx, by) > radiusAt(s.t) ? 1 : -1;
  };

  /**
   * Walk back along the sign line from `t` until `want` millimetres of it
   * have gone by, and return where that is.
   *
   * Along the sign line and not along the centreline, because they are not
   * the same length: the offset line runs from a little over half the
   * centreline's arc to half again as much, and it is furthest from parity
   * exactly at a corner, which is where every one of these is measured. A
   * board spaced by centreline arc would sit 20% wrong precisely where it
   * matters.
   */
  const backAlong = (t: number, outward: number, want: number): number | null => {
    const STEP = -0.0004;
    let gone = 0, th = t;
    let prev = signAt(th, outward);
    for (let i = 0; i < 40000 && gone < want; i++) {
      th += STEP;
      const p = signAt(th, outward);
      gone += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    return gone >= want ? th : null;
  };

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
    /*
     * Chevrons, round the outside of the bend, facing back up the road.
     *
     * One at turn-in, one at the apex, one at the exit — three points that
     * say the same thing a barrier says and one thing it does not, which is
     * which way the corner goes before you can see round it. The mark is
     * handed off the same side the apex chose, so a left-hander's chevrons
     * point left.
     */
    const outward = outwardOf(samples[apex], side);
    // Turn-in, apex, exit — deduplicated, because a corner short enough that
    // its apex is also its first or last sample would otherwise get two
    // chevrons in the same place: no error anywhere, just a sign drawn twice
    // into itself and lit twice as brightly as its neighbours.
    for (const k of [...new Set([core[0], apex, core[core.length - 1]])]) {
      const ct = samples[k].t;
      const [sx, sy] = signAt(ct, outward);
      if (underWater(sx, sy, 10) || !clearOfPosts(sx, sy, 110)) continue;
      const [ftx, fty] = tangentAt(ct);
      SIGNS.push({ x: sx, y: sy, yaw: Math.atan2(-fty, -ftx), kind: 'chevron', bars: 0, hand: -side });
    }

    /*
     * Countdown boards on the approach: three bars, then two, then one, the
     * last of them 400mm before the corner turns in.
     *
     * Counting down to the corner rather than to the braking point. The
     * braking point is the more useful thing to mark and it is not a
     * property of the circuit: it comes out of the speed profile, which
     * depends on the top speed in force, and the shipped circuit has no
     * braking zones at all below 1790 mm/s and eight above 2510. Boards that
     * appear and vanish as a settings slider moves are not a ruler. The
     * corner is where it is whatever the truck can do.
     *
     * They stand on the same side and the same line as the corner's own
     * chevrons, so the whole sequence reads as one approach, and they are
     * inside the barrier's own lead-in, so nothing here is reachable
     * without hitting the Armco first.
     */
    for (let b = 0; b < 3; b++) {
      const bt = backAlong(samples[core[0]].t, outward, BOARD_FIRST + b * BOARD_GAP);
      if (bt === null) break;
      // never in the corner before this one
      if (curveRadius(bt, 240) < CORNER) break;
      const [bx, by] = signAt(bt, outward);
      if (underWater(bx, by, 10) || !clearOfPosts(bx, by, 110)) break;
      const [btx, bty] = tangentAt(bt);
      SIGNS.push({ x: bx, y: by, yaw: Math.atan2(-bty, -btx), kind: 'board', bars: b + 1, hand: 0 });
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
  signPosts: Float32Array; signPostCount: number;
  bars: Float32Array; barCount: number;
  boardPanels: Float32Array; boardPanelCount: number;
  panels: Float32Array; panelCount: number;
  marks: Float32Array; markCount: number;
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

  /*
   * The signs. A post per sign; a board and its bars; a chevron's board and
   * its mark. FIVE groups, because a group is one material and these are
   * five — a mark has to read against its own board and the board against
   * the night, and the two kinds of board are different sizes.
   *
   * No per-instance tint buffer on any of them. Nothing varies sign to sign,
   * and supplying a materials array that is shorter than the count is worse
   * than not supplying one: the group's own albedo stops being read at all,
   * and every instance past the end of the buffer comes out a black mirror
   * rather than an error.
   */
  const boards = SIGNS.filter((g) => g.kind === 'board');
  const chevs = SIGNS.filter((g) => g.kind === 'chevron');
  const signPosts = new Float32Array(SIGNS.length * 16);
  SIGNS.forEach((g, i) => {
    const z = height(g.x, g.y), n = normal(g.x, g.y);
    // One post mesh for both kinds, hung so its top finishes just under the
    // panel it carries and whatever is left over goes underground. There was
    // a second post height here that only moved the same box up and down —
    // it never made the post shorter, so every chevron wore a stub above its
    // own board and sat twice as deep in the ground as intended.
    const top = g.kind === 'board' ? BOARD_MID + BOARD_H / 2 : CHEV_MID + CHEV_H / 2;
    placeUp(signPosts, i, g.x, g.y, z, g.yaw, n, top - 6 - BOARD_POST_H / 2);
  });

  const barTotal = boards.reduce((sum, g) => sum + g.bars, 0);
  const bars = new Float32Array(barTotal * 16);
  const boardPanels = new Float32Array(boards.length * 16);
  let barCount = 0;
  boards.forEach((g, i) => {
    const z = height(g.x, g.y), n = normal(g.x, g.y);
    placeUp(boardPanels, i, g.x, g.y, z, g.yaw, n, BOARD_MID);
    for (let k = 0; k < g.bars; k++) {
      // proud of the board's face, so a bar is a marking on it and not a
      // stripe floating in front of one
      placeProud(bars, barCount++, g.x, g.y, z, g.yaw, n, BAR_LOW + k * BAR_PITCH, CHEV_D / 2 + 3);
    }
  });

  const panels = new Float32Array(chevs.length * 16);
  const marks = new Float32Array(chevs.length * 16);
  chevs.forEach((g, i) => {
    const z = height(g.x, g.y), n = normal(g.x, g.y);
    placeUp(panels, i, g.x, g.y, z, g.yaw, n, CHEV_MID);
    // the mark stands proud of the panel it is on, and is turned so that it
    // points the way the corner goes rather than the way it was modelled
    placeMark(marks, i, g.x, g.y, z, g.yaw, n, CHEV_MID, g.hand);
  });

  return {
    rails, railCount, posts, postCount,
    drums, drumCount: drumsOf.length, drumTint, tyres, tyreCount: tyresOf.length,
    signPosts, signPostCount: SIGNS.length,
    bars, barCount,
    boardPanels, boardPanelCount: boards.length,
    panels, panelCount: chevs.length,
    marks, markCount: chevs.length,
  };
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

/** Like `placeUp`, but pushed out along the facing normal to stand proud. */
function placeProud(
  out: Float32Array, i: number, x: number, y: number, z: number,
  yaw: number, n: [number, number, number], lift: number, push: number,
) {
  placeUp(out, i, x, y, z, yaw, n, lift);
  const o = i * 16;
  out[o + 12] += out[o] * push;
  out[o + 13] += out[o + 1] * push;
  out[o + 14] += out[o + 2] * push;
}

/**
 * A chevron's mark: on the face of its panel, turned in the panel's own
 * plane so the V points the way the road goes.
 *
 * The panel's local axes after `placeUp` are: x out of its face, y across
 * it, z up it. The mark is modelled in the ground plane pointing along +x,
 * so it is stood up and turned about the face normal. `hand` flips it for a
 * left-hander, by mirroring the across axis rather than by rotating: a turn
 * would need the mesh to be symmetric about its own centre and the library's
 * chevron is not.
 */
function placeMark(
  out: Float32Array, i: number, x: number, y: number, z: number,
  yaw: number, n: [number, number, number], lift: number, hand: number,
) {
  let fx = Math.cos(yaw), fy = Math.sin(yaw), fz = 0;
  const along = fx * n[0] + fy * n[1];
  fx -= n[0] * along; fy -= n[1] * along; fz -= n[2] * along;
  const len = Math.hypot(fx, fy, fz) || 1;
  fx /= len; fy /= len; fz /= len;
  const lx = n[1] * fz - n[2] * fy, ly = n[2] * fx - n[0] * fz, lz = n[0] * fy - n[1] * fx;
  // The across axis here is `n x f`, and `f` is the way the sign LOOKS, which
  // is back up the road — so it comes out as the driver's right, not their
  // left. Handedness is therefore the opposite of what it reads like, and
  // taken at face value every chevron pointed away from its own corner.
  const s = hand >= 0 ? -1 : 1;
  const o = i * 16;
  // modelled +x becomes across the panel (handed), +y becomes up it, +z out
  out[o] = lx * s; out[o + 1] = ly * s; out[o + 2] = lz * s; out[o + 3] = 0;
  out[o + 4] = n[0]; out[o + 5] = n[1]; out[o + 6] = n[2]; out[o + 7] = 0;
  out[o + 8] = fx; out[o + 9] = fy; out[o + 10] = fz; out[o + 11] = 0;
  const push = CHEV_D / 2 + 4;
  out[o + 12] = x + n[0] * lift + fx * push;
  out[o + 13] = y + n[1] * lift + fy * push;
  out[o + 14] = z + n[2] * lift + fz * push;
  out[o + 15] = 1;
}

/** How far off the road the barrier stands, for anything that needs to know. */
export { BARRIER_OUT, RAIL_DEEP, TRACK_LIFT };
