/**
 * The forest: cones, in their hundreds, on every part of the arena that is
 * not the road or its shoulder.
 *
 * One mesh, one draw. A tree is seven flat-shaded triangles on a unit cone,
 * and everything that makes one tree different from the next — where it
 * stands, how tall, how wide, which green — is in its placement matrix and
 * its four floats of material. Sixteen hundred of them cost the GPU about
 * as much as one truck.
 *
 * They are for the sense of scale and for the dark. A row of street lights
 * running away is a strong cue for distance; a wall of trees behind it,
 * unlit except where a flood spills, is a stronger one, and it turns the
 * black beyond the road from nothing into somewhere.
 */
import type { Mesh } from 'artshape-render/mesh/types';
import { TRACK_HALF, where } from './track';
import { ARENA_X, ARENA_Y } from './scene';
import { height } from './terrain';

/**
 * How far from the centreline the trees start: just behind the lamp posts,
 * which stand at 850. A car has been measured 884 off the line at the very
 * worst, and the widest trunk is 52, so the nearest wood a truck can touch
 * is at about 980 — beyond anything the drivers have managed.
 *
 * It was 900 past the tarmac first, which left a bare strip a truck and a
 * half wide between the posts and the first tree, and on the outside of the
 * circuit, where the road bulges to within 180mm of the wall, that strip was
 * most of what there was: the forest read as a hedge in the distance.
 */
export const FOREST_FROM = TRACK_HALF + 650;
/** Trees are kept this far in from the walls, so none stands in a block. */
const WALL_MARGIN = 260;
/**
 * And planted again beyond the wall, on the ground that runs 400 past it. A
 * truck can never reach them, so they cost nothing to drive against; what
 * they buy is a treeline above the wall from every angle the camera takes,
 * so the edge of the arena is the edge of a wood and not of the world.
 */
const BEYOND_FROM = 120;
const BEYOND_TO = 380;
/** Nominal spacing of the planting grid, before jitter. Dense: a truck is 300. */
const SPACING = 230;
/** The unit tree, before its own scale: a cone this wide at the foot and this tall. */
const BASE_RADIUS = 92;
const BASE_HEIGHT = 300;
/** Sunk so that no slope opens a gap under the foot. */
const SINK = 22;

export interface Tree {
  x: number;
  y: number;
  /** Uniform scale on the unit tree. */
  scale: number;
  /** The radius of its trunk for the purpose of hitting it. */
  r: number;
}

/**
 * The unit cone: foot on z = 0 of radius BASE_RADIUS, apex at BASE_HEIGHT,
 * flat shaded. Each face gets its own three vertices so that the normal is
 * the face's and the silhouette reads as facets rather than as a smooth
 * shape trying to be round with seven sides. No base — the ground is there.
 */
export function treeMesh(sides = 7): Mesh {
  const positions = new Float32Array(sides * 9);
  const normals = new Float32Array(sides * 9);
  const uvs = new Float32Array(sides * 6);
  const indices = new Uint32Array(sides * 3);
  const r = BASE_RADIUS, h = BASE_HEIGHT;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p = [
      [r * Math.cos(a0), r * Math.sin(a0), 0],
      [r * Math.cos(a1), r * Math.sin(a1), 0],
      [0, 0, h],
    ];
    // face normal: mid-angle, tilted up by the cone's slope
    const am = (a0 + a1) / 2;
    const nl = Math.hypot(h, r);
    const n = [(Math.cos(am) * h) / nl, (Math.sin(am) * h) / nl, r / nl];
    for (let k = 0; k < 3; k++) {
      const o = (i * 3 + k) * 3;
      positions[o] = p[k][0]; positions[o + 1] = p[k][1]; positions[o + 2] = p[k][2];
      normals[o] = n[0]; normals[o + 1] = n[1]; normals[o + 2] = n[2];
      uvs[(i * 3 + k) * 2] = k === 2 ? 0.5 : k; uvs[(i * 3 + k) * 2 + 1] = k === 2 ? 1 : 0;
      indices[i * 3 + k] = i * 3 + k;
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * A small deterministic generator, so the forest is the same forest every
 * time and a measurement taken in it can be taken again.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the trees stand: a grid over the whole arena, each point jittered by
 * up to half a cell, kept if it is far enough from the road and far enough
 * from the walls. Jitter rather than pure randomness because a forest has no
 * clumps of five trees in one spot and no bald patches — it is roughly even,
 * and only roughly.
 */
export function plant(seed = 7): Tree[] {
  const rand = rng(seed);
  const out: Tree[] = [];
  const x1 = ARENA_X + BEYOND_TO, y1 = ARENA_Y + BEYOND_TO;
  for (let gy = -y1; gy <= y1; gy += SPACING) {
    for (let gx = -x1; gx <= x1; gx += SPACING) {
      const x = gx + (rand() - 0.5) * SPACING;
      const y = gy + (rand() - 0.5) * SPACING;
      // inside the arena but clear of the wall, or outside it on the apron
      const ex = Math.abs(x) - ARENA_X, ey = Math.abs(y) - ARENA_Y;
      const edge = Math.max(ex, ey);
      const inside = edge < -WALL_MARGIN;
      const beyond = edge > BEYOND_FROM && ex < BEYOND_TO && ey < BEYOND_TO;
      if (!inside && !beyond) continue;
      if (inside && Math.abs(where(x, y).offset) < FOREST_FROM) continue;
      const scale = 0.72 + rand() * 0.66;
      out.push({ x, y, scale, r: BASE_RADIUS * scale * 0.42 });
    }
  }
  return out;
}

/** The placement matrices and the materials for a planted forest. */
export function forestBuffers(trees: Tree[]): { matrices: Float32Array; materials: Float32Array } {
  const matrices = new Float32Array(trees.length * 16);
  const materials = new Float32Array(trees.length * 4);
  const rand = rng(11);
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const turn = rand() * Math.PI * 2;
    const c = Math.cos(turn) * t.scale, s = Math.sin(turn) * t.scale;
    const o = i * 16;
    matrices[o] = c; matrices[o + 1] = s;
    matrices[o + 4] = -s; matrices[o + 5] = c;
    matrices[o + 10] = t.scale;
    matrices[o + 12] = t.x; matrices[o + 13] = t.y;
    matrices[o + 14] = height(t.x, t.y) - SINK;
    matrices[o + 15] = 1;
    // Greens. Darker and bluer for most, with some yellower and a few paler:
    // one green repeated sixteen hundred times is a carpet, not a wood.
    const k = rand();
    const warm = rand() * 0.06;
    const pale = rand() < 0.12 ? 0.08 : 0;
    const m = i * 4;
    materials[m] = 0.06 + warm + pale + k * 0.05;
    materials[m + 1] = 0.20 + k * 0.16 + pale;
    materials[m + 2] = 0.08 + (1 - k) * 0.07;
    materials[m + 3] = 0.78;
  }
  return { matrices, materials };
}

/** The forest as planted, once, for the drawing and the driving to share. */
export const TREES: Tree[] = plant();
