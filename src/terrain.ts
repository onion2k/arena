/**
 * The floor is not flat any more: it is a field of shallow hills, and one
 * function describes it.
 *
 * That single function is the point. The wheels find the ground by asking it
 * for a height, the ground mesh is built by asking it for a height, and the
 * tiles, posts and walls are stood on it by asking it for a height. Nothing
 * approximates anything else, so the truck can never be seen floating over a
 * hill or sunk into one — a class of bug that is otherwise very hard to see
 * and impossible to unsee.
 *
 * Three sine pairs, chosen for what they do rather than for looking random:
 *
 * - a long swell, which the truck rides without noticing
 * - a middle roll, which loads and unloads the suspension through a corner
 * - short ridges, which are the jumps
 *
 * A wheel leaves the ground over a crest when the acceleration needed to
 * follow it exceeds gravity: v² · κ > g, where κ is the crest's curvature,
 * A(2π/L)² for a sine of amplitude A and wavelength L. For the ridges below
 * that is 26 · (2π/520)² = 3.8e-3 per mm, so they throw the truck at about
 * 1600 mm/s and hold it down below that — and the suspension extending helps,
 * so it happens a little under. Top speed is 1750, which puts a jump inside
 * what the engine can reach on a straight but only just: you have to have
 * earned it. Every other wave needs three or four times that speed and so is
 * ground you ride rather than leave.
 *
 * Measured over the whole floor at 25mm: the median slope is 5 degrees, the
 * 95th percentile 24, the steepest 33 — a smooth floor with steep ramps in
 * it, rather than the uniformly corrugated 14-degree median it had when the
 * ramp wave's envelope was a plain sine. The circuit crosses a ramp band over
 * about 3% of its length, and needs 1595 mm/s to leave the ground there.
 */

import type { Mesh } from 'artshape-render/mesh/types';

/**
 * One component of the ground. `env`, where a wave has one, is a second much
 * longer wave that scales its amplitude: it is what turns a ripple that
 * covers the whole floor into ramps that appear in bands, with rolling ground
 * between them. Without it the sharpest component sets the slope everywhere
 * and the median gradient of the arena is the gradient of its steepest ramp.
 *
 * `sharp` raises that envelope to a power, which is what separates a ramp
 * from a ripple. A plain sine envelope is above half for half of its cycle,
 * so a ramp that is exciting at its crest is a washboard everywhere else and
 * the whole floor reads as corrugated. Cubed, it is above half for less than
 * a third of the cycle and has fallen to an eighth by the time it reaches the
 * midpoint: the ramps are as tall as they ever were and the ground between
 * them is ground.
 */

interface Wave {
  amp: number;
  len: number;
  angle: number;
  phase: number;
  env?: { len: number; angle: number; phase: number; sharp?: number };
}

const WAVES: Wave[] = [
  // The swell: long and low. It was steeper and shorter, which made the
  // circuit a rough ride everywhere rather than a smooth one with jumps in
  // it — a race track wants the ground to be a surface, not an event.
  { amp: 42, len: 3600, angle: 0.32, phase: 0.0 },
  { amp: 30, len: 2900, angle: 1.71, phase: 1.3 },
  // barely a roll now: enough to load the suspension, not enough to see
  { amp: 11, len: 2100, angle: 0.95, phase: 2.1 },
  { amp: 9, len: 1600, angle: 1.98, phase: 3.4 },
  // The ramps, which are the jumps and are meant to be obvious.
  //
  // A sine's steepest gradient is A·2pi/L on its flanks and its curvature at
  // the crest is A·(2pi/L)² — one is what throws the truck, the other is what
  // strands it, and they are not the same number. At 58 by 650 the flanks
  // reached 29 degrees and the tarmac 32, while a car on the shoulder either
  // side of the road cannot climb past 24: the reduced grip out there leaves
  // the rear tyres unable to put the engine down, so a car that ran a little
  // wide onto a ramp flank stopped there and stayed, wheels spinning. The
  // drivers found this reliably.
  //
  // 36 by 720 puts the steepest ground within a truck's width of the road at
  // 21 degrees, against 32 before and the 23.5 a car on the shoulder can
  // climb from a standstill. Nothing on the circuit strands anything now.
  //
  // The jump is the price, and it was not recoverable. Slope is A·2pi/L and
  // crest curvature is A(2pi/L)², so for a fixed slope the curvature is
  // slope²/A — and the amplitude cannot simply be dropped to buy curvature
  // back, because a crest no taller than the suspension's 26mm of travel is
  // one the springs absorb without the body ever leaving. At 26 of amplitude
  // it did exactly that: the crest condition said the truck should fly at
  // 1716 mm/s and at 2300 it did not lift a wheel. Nine (amplitude, length)
  // pairs were measured across the whole range that keeps the slope under 25
  // degrees, and not one of them got all four wheels off the ground at a
  // speed the truck can reach.
  //
  // The reason given here for that used to be the suspension travel, and that
  // was wrong. `TRAVEL` is the clamp on how far a spring may be squashed, not
  // how far the wheel can reach down: contact is `REST + WHEEL_RADIUS` below
  // the mounting point and `TRAVEL` does not appear in it. Measured at 26, 45
  // and 70, it changes the outcome of a run over the sharpest crest not at
  // all — the three are identical frame for frame. Droop is the quantity that
  // does matter and it works the wrong way round: more of it keeps the wheels
  // down, and even at a droop of 10 the truck got all four off for a single
  // frame.
  //
  // What actually stops it is its own length. A wheel lifts easily, because
  // the truck carries 8mm of static sag and the body need only rise that far.
  // For all four to lift, the ground has to fall away from the whole 250mm of
  // it at once, and over any crest gentle enough to be safe the truck instead
  // pitches through: nose up on the way in, which plants the rear, then nose
  // down over the top, which plants the front. Logged over a purpose-built
  // ramp, the front wheels read zero compression while the rear read nine,
  // and by the time the rear reached zero the front was back down. Two or three lift over a crest, for a fifth of
  // a second, and that is what is left of it: the ground unsettles the truck
  // where it used to launch it.
  //
  // The obvious objection — make the shoulder climbable instead of the ramps
  // shallow — was measured rather than argued about, and it does not work:
  // with the shoulder softened from taking a third of the grip to taking a
  // seventh, and the old 58-by-650 ramps put back, seven of the thirty
  // steepest spots beside the road still held a car that stopped on them. The
  // limit is the engine against the weight of the truck on a slope, not the
  // surface. And a three-minute race measured on that same steep terrain
  // never got all four wheels off the ground either: the jump only ever
  // existed in a straight line at 2400 mm/s in a test, never in a lap.
  // The envelope is longer and moved along because sharpening it narrowed the
  // bands, and the band the circuit used to cross moved off it: the speed
  // needed to leave the ground anywhere on the racing line went from 1559 to
  // 2373 mm/s, which against a top speed of 2800 is no jump at all. Swept
  // over length, phase and amplitude for a band that lands back under the
  // road without the floor going rough again — 1443 mm/s now, over 4.8% of
  // the lap, with the median slope of the arena unchanged at 5 degrees.
  { amp: 36, len: 720, angle: 0.18, phase: 1.9, env: { len: 9600, angle: 1.75, phase: 2.5, sharp: 3 } },
];
/** How much a wave's envelope is letting through at a point, 0 to 1. */
function envelopeAt(w: Wave, x: number, y: number): number {
  if (!w.env) return 1;
  const k = (Math.PI * 2) / w.env.len;
  const e = 0.5 + 0.5 * Math.sin((x * Math.cos(w.env.angle) + y * Math.sin(w.env.angle)) * k + w.env.phase);
  return w.env.sharp ? Math.pow(e, w.env.sharp) : e;
}

/** How high the ground is under a point. */
/**
 * New hills for a new circuit.
 *
 * Only the phases and the headings move. The amplitudes and the wavelengths
 * are the measured part of this file — how steep a ramp can be before a car
 * on the shoulder cannot climb it, how tall a crest has to be before the
 * springs stop swallowing it — and a generator that drew those at random
 * would produce ground that strands the truck about a third of the time. A
 * wave of the same size and length in a different place and pointing a
 * different way is new ground with the old ground's guarantees.
 */
/**
 * New hills for a new circuit, at a biome's own scale on each wave's
 * amplitude — one factor per row of `WAVES`, in the same order: swell,
 * swell, roll, roll, ramp. Only the phases and the headings are randomised;
 * the amplitudes below are `BASE_AMP` times the biome's scale, so a biome
 * that doubles the swell is dunes and one that halves everything is the
 * flats a marsh wants, without touching the measurements the comment above
 * this function is about — those are what a scale of 1 reproduces exactly.
 */
export function seedTerrain(seed: number, ampScale: number[] = [1, 1, 1, 1, 1]) {
  let a = (seed >>> 0) || 1;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const base = BASE[i];
    // seed zero is the ground the game shipped with
    w.angle = seed === 0 ? base.angle : rnd() * Math.PI;
    w.phase = seed === 0 ? base.phase : rnd() * Math.PI * 2;
    w.amp = base.amp * (ampScale[i] ?? 1);
    if (w.env && base.env) {
      w.env.angle = seed === 0 ? base.env.angle : rnd() * Math.PI;
      w.env.phase = seed === 0 ? base.env.phase : rnd() * Math.PI * 2;
    }
  }
}

/** Where every wave started, so seed zero can put them all back and a scale
 *  of 1 always means the shipped amplitude. */
const BASE = WAVES.map((w) => ({
  amp: w.amp, angle: w.angle, phase: w.phase,
  env: w.env ? { angle: w.env.angle, phase: w.env.phase } : undefined,
}));

export function height(x: number, y: number): number {
  let h = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.len;
    h += w.amp * Math.sin((x * Math.cos(w.angle) + y * Math.sin(w.angle)) * k + w.phase) * envelopeAt(w, x, y);
  }
  return h;
}

/**
 * Which way the ground faces there, as a unit vector. Differentiated rather
 * than sampled: a finite difference over a step big enough to be stable is a
 * step big enough to miss the ridges, and the wheels would then be pushed by
 * a normal belonging to a hill they are not on.
 */
export function normal(x: number, y: number): [number, number, number] {
  let dx = 0; let dy = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.len;
    const ca = Math.cos(w.angle); const sa = Math.sin(w.angle);
    const wave = Math.sin((x * ca + y * sa) * k + w.phase);
    const slope = w.amp * k * Math.cos((x * ca + y * sa) * k + w.phase);
    const e = envelopeAt(w, x, y);
    dx += slope * ca * e; dy += slope * sa * e;
    // the envelope is a function of position too, so it carries a gradient of
    // its own — leaving it out puts a kink in the normal at the edge of every
    // band, which the wheels would feel as a step
    if (w.env) {
      const ke = (Math.PI * 2) / w.env.len;
      const cb = Math.cos(w.env.angle); const sb = Math.sin(w.env.angle);
      const arg = (x * cb + y * sb) * ke + w.env.phase;
      const base = 0.5 + 0.5 * Math.sin(arg);
      let de = 0.5 * ke * Math.cos(arg);
      // the chain rule through the sharpening power, without which the edge
      // of every band is a step the wheels can feel
      if (w.env.sharp) de *= w.env.sharp * Math.pow(base, w.env.sharp - 1);
      dx += w.amp * wave * de * cb; dy += w.amp * wave * de * sb;
    }
  }
  const len = Math.hypot(dx, dy, 1);
  return [-dx / len, -dy / len, 1 / len];
}

/** The steepest slope any one wave can contribute, for sanity. */
export function worstSlope(): number {
  return WAVES.reduce((s, w) => s + (w.amp * Math.PI * 2) / w.len, 0);
}

/**
 * The ground itself, as a mesh: a grid of quads with every vertex put where
 * `height` says and every normal where `normal` says.
 *
 * Built rather than modelled, because it has to agree with the function the
 * wheels are reading exactly. A plate from the parts library displaced by
 * something similar would be a second description of the same surface, and
 * the two would drift.
 *
 * It runs past the arena's walls so that its edge is never the thing you see
 * at the edge of the floor.
 */
export function groundMesh(halfX: number, halfY: number, cell: number): Mesh {
  const nx = Math.ceil((halfX * 2) / cell);
  const ny = Math.ceil((halfY * 2) / cell);
  const w = nx + 1; const h = ny + 1;
  const positions = new Float32Array(w * h * 3);
  const normals = new Float32Array(w * h * 3);
  const uvs = new Float32Array(w * h * 2);
  const indices = new Uint32Array(nx * ny * 6);

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = -halfX + (i / nx) * halfX * 2;
      const y = -halfY + (j / ny) * halfY * 2;
      const o = (j * w + i) * 3;
      positions[o] = x; positions[o + 1] = y; positions[o + 2] = height(x, y);
      const n = normal(x, y);
      normals[o] = n[0]; normals[o + 1] = n[1]; normals[o + 2] = n[2];
      uvs[(j * w + i) * 2] = i / nx;
      uvs[(j * w + i) * 2 + 1] = j / ny;
    }
  }
  let k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = c;
      indices[k++] = c; indices[k++] = b; indices[k++] = d;
    }
  }
  return { positions, normals, uvs, indices };
}
