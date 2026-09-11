/**
 * Putting a circuit in force: everything the arena builds on the CPU when the
 * seed, the size or the biome changes, and nothing it draws.
 *
 * This was `useTrack` inside `main.ts`, which is the page and cannot be
 * imported without a canvas and a GPU. Out here the tests build exactly the
 * circuit the game builds, in the same order, and drive a vehicle round it
 * with no browser at all — see `src/__tests__`.
 */
import { setCollisionGrid } from './game';
import { PROPS, replant } from './flora';
import { BIOME, setBiome, type BiomeKey } from './biomes';
import { BOLLARDS, rebuildFurniture } from './furniture';
import { refloodArena, underWater } from './water';
import { centreline, circuitFor, setTrack } from './track';
import { seedTerrain } from './terrain';
import { ARENA_X, ARENA_Y, COLUMN_RADIUS, COLUMNS, resizeArena, restandColumns } from './scene';
import { CircleGrid } from './spatial';
import { SIZE, setSize, type SizeKey } from './world';

/**
 * Every lamp post, tree and bollard, in a grid the truck can be checked
 * against without scanning all of them — see `spatial.ts`. Built last,
 * because it has to be built from lists that `rebuildFurniture` (bollards)
 * and `replant` (trees) have already filled.
 */
function rebuildCollisionGrid() {
  const grid = new CircleGrid(ARENA_X + 500, ARENA_Y + 500, 320);
  for (const post of COLUMNS) grid.add(post.x, post.y, COLUMN_RADIUS * post.scale);
  // zero radius is a prop a wheel goes through — a marsh's reeds — and
  // not a very small collision
  for (const p of PROPS) if (p.r > 0) grid.add(p.x, p.y, p.r);
  for (const b of BOLLARDS) grid.add(b.x, b.y, b.r);
  setCollisionGrid(grid);
}

/**
 * Flood the arena to the biome's own depth, or not at all. A marsh's 110mm
 * is deep enough that a circuit whose whole loop sits close to level can
 * put the start line itself under water — the grid steps the depth down
 * until it is not, rather than starting a race on a lake.
 */
function floodForBiome() {
  let depth = BIOME.water.depth;
  if (depth === null) { refloodArena(null); return; }
  for (let tries = 0; tries < 10; tries++) {
    refloodArena(depth);
    const [sx, sy] = centreline(-Math.PI);
    if (!underWater(sx, sy, 50)) return;
    depth = Math.max(0, depth - 10);
  }
}

/**
 * Put a circuit in force, and everything that grows out of one with it.
 * Returns how long it took, in milliseconds.
 *
 * The order is the dependency order and it is not negotiable: the size and
 * the biome have to be set before the arena is resized and the ground and
 * the circuit are built, since all three read them; the water level is
 * the lowest point of the road plus the biome's own depth, so the road has
 * to exist first; the posts stand along the road; the flora is planted
 * round both the road and the water; and the collision grid is built last
 * of all, from lists that everything before it fills in. Getting any of
 * this backwards plants a forest in last circuit's lake, or hands the
 * truck a grid with nothing in it.
 */
export function useTrack(seed: number, size: SizeKey, biome: BiomeKey): number {
  const t0 = performance.now();
  setSize(size);
  setBiome(biome);
  resizeArena();
  setTrack(circuitFor(seed, SIZE));
  seedTerrain(seed, BIOME.terrain.ampScale);
  floodForBiome();
  restandColumns();
  // always 7, not the circuit's own seed: the jitter pattern is fixed, so
  // only which grid cells survive the road and the water changes from one
  // circuit to the next, not how the ones that do are scattered within it
  replant(7, BIOME);
  // clear of the posts and out of the water
  rebuildFurniture(seed);
  rebuildCollisionGrid();
  return performance.now() - t0;
}
