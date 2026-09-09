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
 * Measured over the whole floor at 10mm: the median slope is 14 degrees, the
 * 95th percentile 23, the steepest 28. Shallow enough to drive anywhere,
 * steep enough that the arena is not a table.
 */

import type { Mesh } from 'artshape-render/mesh/types';

/**
 * One component of the ground. `env`, where a wave has one, is a second much
 * longer wave that scales its amplitude: it is what turns a ripple that
 * covers the whole floor into ramps that appear in bands, with rolling ground
 * between them. Without it the sharpest component sets the slope everywhere
 * and the median gradient of the arena is the gradient of its steepest ramp.
 */

interface Wave {
  amp: number;
  len: number;
  angle: number;
  phase: number;
  env?: { len: number; angle: number; phase: number };
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
  // and the ramps, which are the jumps and are meant to be obvious
  { amp: 58, len: 650, angle: 0.18, phase: 1.9, env: { len: 7000, angle: 1.75, phase: 0.4 } },
];
/** How much a wave's envelope is letting through at a point, 0 to 1. */
function envelopeAt(w: Wave, x: number, y: number): number {
  if (!w.env) return 1;
  const k = (Math.PI * 2) / w.env.len;
  return 0.5 + 0.5 * Math.sin((x * Math.cos(w.env.angle) + y * Math.sin(w.env.angle)) * k + w.env.phase);
}

/** How high the ground is under a point. */
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
      const de = 0.5 * ke * Math.cos((x * cb + y * sb) * ke + w.env.phase);
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
