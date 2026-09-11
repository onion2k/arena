/**
 * The water table: one level, everywhere.
 *
 * Ground below it is under water, and so is road. The level is not chosen
 * by hand: it is the lowest the road gets, plus a little, so that the dips
 * in the circuit are fords — the road runs into the water for a truck
 * length or two and out again — and the same level, carried across the
 * whole arena, floods every hollow in the forest into a lake. Measured at
 * twenty millimetres over the lowest road: three fords of 514, 475 and
 * 223mm, and lakes over 7.8% of the ground.
 *
 * The water is drawn opaque, because the renderer has no transparency and
 * this is not the change to give it one. A ford is therefore a place the
 * road vanishes into the water and reappears, which a real ford does too,
 * seen from above; the kerbs stand 8mm above the tarmac and mark it for the
 * first and last few hundred millimetres of each.
 */
import { TRACK_LIFT, centreline } from './track';
import { height } from './terrain';
import type { Mesh } from 'artshape-render/mesh/types';

/** How far under the water the lowest point of the road is, in the biomes
 *  that have water at all. */
export const FORD_DEPTH = 20;

/** The lowest the road surface gets, measured round the whole lap. */
function lowestRoad(): number {
  let lo = Infinity;
  const n = 3000;
  for (let i = 0; i < n; i++) {
    const t = -Math.PI + (i / n) * Math.PI * 2;
    const [x, y] = centreline(t);
    lo = Math.min(lo, height(x, y) + TRACK_LIFT);
  }
  return lo;
}

/**
 * Where the water is, in the same millimetres as the ground — or `null` for
 * a biome with none, in which case it sits far below anything that could
 * ever read as flooded and `underWater` is always false without a branch
 * everywhere that asks it.
 */
export let WATER_LEVEL = lowestRoad() + FORD_DEPTH;
let hasWater = true;

/**
 * Find the level again: the road moved, so the lowest point on it did too.
 * `depth` is the biome's own — `FORD_DEPTH` for forest and snow, deeper for
 * a marsh that wants real lakes rather than fords, `null` for a desert.
 * Marsh's own depth can flood the grid at the start/finish line if the whole
 * arena sits close to level; the caller steps it down until that clears —
 * see `useTrack`.
 */
export function refloodArena(depth: number | null = FORD_DEPTH) {
  hasWater = depth !== null;
  WATER_LEVEL = hasWater ? lowestRoad() + (depth as number) : -1e9;
}

/** Whether the ground at a point is under the water. Always false where the
 *  biome has none. */
export function underWater(x: number, y: number, margin = 0): boolean {
  return hasWater && height(x, y) < WATER_LEVEL + margin;
}

/**
 * Extra rolling resistance on a wheel whose ground is under water, as a
 * fraction of forward speed a second, like the shoulder's drag. All four
 * wheels wet at racing speed is about a sixteenth of a gravity, which over
 * a half-metre ford costs about 150 mm/s: a ford is something you feel and
 * not something that stops you. It was 0.2, and with the wet test then
 * reading the terrain rather than the road it cost the drivers five or six
 * hundred a ford.
 */
export const WATER_DRAG = 0.08;

/**
 * The water itself: one quad at the level, over the whole ground. Two
 * triangles, a normal straight up, and the material does the rest — near
 * black, and glossy enough to hold the sky and every lamp on the shore.
 */
export function waterMesh(halfX: number, halfY: number): Mesh {
  const z = WATER_LEVEL;
  const positions = new Float32Array([
    -halfX, -halfY, z, halfX, -halfY, z, halfX, halfY, z, -halfX, halfY, z,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
}
