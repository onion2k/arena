/**
 * The arena's geometry.
 *
 * Everything here is generated: the shapes come out of the same parametric
 * library the still-life renderer draws jewellery with, which is why an
 * enemy is a spiked bead and the player is a brilliant-cut gem. That is not
 * a joke at the game's expense — a faceted stone under thirty moving point
 * lights is exactly the thing this renderer is for, and there was no model
 * file to load to get one.
 *
 * A mesh is compiled once and then placed by matrices this file never sees
 * again: the game writes those every frame.
 */
import { compile } from 'artshape-render/dsl';
import { groupByMesh } from 'artshape-render/assembly/groups';
import type { Mesh } from 'artshape-render/mesh/types';

/** Where a compiled part's origin should end up. */
type Anchor =
  /** Its bounding box's middle: right for a thing that spins about itself. */
  | 'centre'
  /** Centred across, sitting on z = 0: right for anything standing on the floor. */
  | 'base'
  /** Centred across, hanging below z = 0: right for the floor itself. */
  | 'top'
  /**
   * Left where it was modelled across, sitting on z = 0. Right for anything
   * that turns about a centre the shape itself defines — a triangle's
   * bounding box is not centred on the circle it was drawn in, so centring it
   * would make the ship pivot about a point off its own nose-to-tail axis.
   */
  | 'pivot';

/**
 * One part, as a mesh with its origin moved to where the game wants it.
 *
 * The DSL builds a plate from a corner rather than a centre, so a part placed
 * by a matrix without this lands off by half its own width — which is how an
 * earlier camera in this project ended up framing a table instead of a piece.
 */
export function part(source: string, anchor: Anchor = 'centre'): Mesh {
  const { sketch, error } = compile(`material silver polished\npart it = ${source}\nform p { place it }\n`);
  if (error) throw new Error(error.formatted);
  const groups = groupByMesh(sketch!.assembly);
  if (groups.length !== 1) throw new Error(`expected one mesh, got ${groups.length}`);
  const mesh = groups[0].mesh;
  const p = mesh.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minX) minX = p[i]; if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1];
    if (p[i + 2] < minZ) minZ = p[i + 2]; if (p[i + 2] > maxZ) maxZ = p[i + 2];
  }
  const dx = anchor === 'pivot' ? 0 : (minX + maxX) / 2;
  const dy = anchor === 'pivot' ? 0 : (minY + maxY) / 2;
  const dz = anchor === 'centre' ? (minZ + maxZ) / 2 : anchor === 'top' ? maxZ : minZ;
  const moved = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    moved[i] = p[i] - dx; moved[i + 1] = p[i + 1] - dy; moved[i + 2] = p[i + 2] - dz;
  }
  return { ...mesh, positions: moved };
}

/**
 * Half the arena, in the millimetres everything else is modelled in.
 *
 * Nearly three times the area it started at. At the old size a ship at full
 * speed crossed it in two seconds, which leaves nowhere to run and nothing to
 * outmanoeuvre: the whole of Asteroids is the room to keep moving. Everything
 * that stands in the arena is placed from these two numbers and the camera
 * solves its distance from them, so this is the only place the size lives.
 */
export const ARENA_X = 1400;
export const ARENA_Y = 940;

export const MESHES = {
  /** The slab, its face at z = 0 so everything else can sit on zero. */
  floor: () => part(`plate(card(width: ${ARENA_X * 2}, height: ${ARENA_Y * 2}, corner: 90), thickness: 40, bevel: 10)`, 'top'),
  /** A raised tile. A hundred of them give the moving lights edges to catch. */
  tile: () => part('plate(card(width: 152, height: 152, corner: 16), thickness: 6, bevel: 3)', 'base'),
  /** A perimeter block, laid along the wall it belongs to. */
  block: () => part('plate(card(width: 186, height: 62, corner: 11), thickness: 86, bevel: 10)', 'base'),
  /** An eight-sided column, for the corners to reflect things in. */
  column: () => part('disc(radius: 54, thickness: 250, sides: 8, bevel: 11)', 'base'),
  /**
   * The player's hull: a triangle, nose along its own +x, so turning the
   * matrix turns the ship and you can see which way it is pointing. That is
   * the whole requirement of an Asteroids ship and a round one fails it.
   */
  hull: () => part('plate(polygon(sides: 3, radius: 112, rotate: 0), thickness: 26, bevel: 8)', 'pivot'),
  /** A stone riding on top of it, spinning: the shiny thing to look at. */
  core: () => part('gem(cut: brilliant, width: 62, depth: 46, facets: 16)'),
  /** The ring around the ship, counter-spinning. */
  ring: () => part('band(radius: 98, width: 13, thickness: 5, segments: 48)'),
  /**
   * An enemy: a spiked star, lying flat and spinning. A round bead read as a
   * traffic cone from a camera this high up — the silhouette is all the
   * player sees of it, so the silhouette is where the shape has to be.
   */
  drone: () => part('plate(sunburst(radius: 38, rays: 7, inner: 0.42, tip: 0.22), thickness: 20, bevel: 6)'),
  /** A shot. Long axis is Z, so it is tipped over to point where it is going. */
  bolt: () => part('egg(radius: 7, height: 38, taper: 0.7, segments: 12)'),
};

/**
 * The columns, which are the only things in the arena you cannot fly through.
 * Eight rather than the four the small arena had: the corners, a pair either
 * side of the middle, and one at each end. An arena this size with an empty
 * middle is a field, not an arena — there has to be something to break the
 * line of a charge and something for a passing shot to light up.
 *
 * The game reads these for collision and the scene places posts on them, so
 * what you see and what you hit cannot drift apart.
 */
export const COLUMN_RADIUS = 58;
export const COLUMNS: [number, number][] = [
  [-ARENA_X + 300, -ARENA_Y + 260], [ARENA_X - 300, -ARENA_Y + 260],
  [-ARENA_X + 300, ARENA_Y - 260], [ARENA_X - 300, ARENA_Y - 260],
  [-520, 0], [520, 0],
  [0, -430], [0, 430],
];

/** Where the static half stands. Built once; the game never touches these. */
export function arenaMatrices(): { tiles: Float32Array; blocks: Float32Array; columns: Float32Array } {
  const tiles: number[] = [];
  const step = 167;
  const across = Math.floor((ARENA_X * 2 - 190) / step);
  const up = Math.floor((ARENA_Y * 2 - 190) / step);
  for (let j = 0; j < up; j++) {
    for (let i = 0; i < across; i++) {
      tiles.push((i - (across - 1) / 2) * step, (j - (up - 1) / 2) * step, 0);
    }
  }
  const blocks: number[] = [];
  for (let x = -ARENA_X + 100; x <= ARENA_X - 100; x += 198) {
    blocks.push(x, -ARENA_Y, 0, x, ARENA_Y, 0);
  }
  for (let y = -ARENA_Y + 110; y <= ARENA_Y - 110; y += 210) {
    blocks.push(-ARENA_X, y, Math.PI / 2, ARENA_X, y, Math.PI / 2);
  }
  const columns: number[] = [];
  for (const [x, y] of COLUMNS) columns.push(x, y, 0);
  return { tiles: pack(tiles), blocks: pack(blocks), columns: pack(columns) };
}

/** Triples of x, y, turn into column-major placements. */
function pack(triples: number[]): Float32Array {
  const n = triples.length / 3;
  const out = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const a = triples[i * 3 + 2];
    const c = Math.cos(a); const s = Math.sin(a);
    const o = i * 16;
    out[o] = c; out[o + 1] = s;
    out[o + 4] = -s; out[o + 5] = c;
    out[o + 10] = 1;
    out[o + 12] = triples[i * 3]; out[o + 13] = triples[i * 3 + 1]; out[o + 15] = 1;
  }
  return out;
}
