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
import { lowestRoad, refloodArena } from './water';
import { TRACK_LIFT, centreline, circuitFor, setTrack, tangentAt } from './track';
import { height, seedTerrain } from './terrain';
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

/** How far the road on the grid stays above the water, at the least. */
const GRID_CLEARANCE = 10;

/**
 * The lowest the road gets where a race starts: a box from 600mm behind the
 * line, past the tail of the longest vehicle on the grid with room to roll
 * back, to 200mm beyond it, and 150mm either side of the centreline — the
 * widest body and a margin. Not the whole width of the tarmac: the ribbon
 * lies on the ground, and on a circuit whose line is in a dip its edges sit
 * lower than anything a car on the grid touches.
 */
function lowestOnGrid(): number {
  const [cx, cy] = centreline(-Math.PI);
  const [tx, ty] = tangentAt(-Math.PI);
  let lo = Infinity;
  for (let along = -600; along <= 200; along += 50) {
    for (let across = -150; across <= 150; across += 37.5) {
      lo = Math.min(lo, height(cx + tx * along + ty * across, cy + ty * along - tx * across) + TRACK_LIFT);
    }
  }
  return lo;
}

/**
 * Flood the arena to the biome's own depth over the lowest road, or not at
 * all — and never over the road on the grid, so a race does not start in a
 * lake.
 *
 * This used to step the depth down 10mm at a time, up to ten times, while
 * the ground at one point on the line was within 50mm of the water. The
 * ground is 22mm under the road, and 50mm is a lot of margin besides, so it
 * lowered water that was nowhere near the road: it drained the forest's
 * fords on 18 of the first 40 circuits, and ran out of tries on every marsh
 * and left it at the forest's 20mm. On a circuit whose line is the lowest
 * point of the lap it drained the fords and still left the grid wet.
 *
 * Now it is one number: as deep as the biome asks, or as deep as the grid
 * allows, whichever is less. Where the grid sits in the lap's lowest dip,
 * that is below the lowest road — no fords on that circuit, and only the
 * hollows off the road hold water — which is what the ground there says.
 */
function floodForBiome() {
  const asked = BIOME.water.depth;
  if (asked === null) { refloodArena(null); return; }
  const allowed = lowestOnGrid() - GRID_CLEARANCE - lowestRoad();
  refloodArena(Math.min(asked, allowed));
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
