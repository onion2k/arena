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

/** Half the arena, in the millimetres everything else is modelled in. */
export const ARENA_X = 820;
export const ARENA_Y = 560;

export const MESHES = {
  /** The slab, its face at z = 0 so everything else can sit on zero. */
  floor: () => part(`plate(card(width: ${ARENA_X * 2}, height: ${ARENA_Y * 2}, corner: 90), thickness: 40, bevel: 10)`, 'top'),
  /** A raised tile. A hundred of them give the moving lights edges to catch. */
  tile: () => part('plate(card(width: 120, height: 120, corner: 14), thickness: 5, bevel: 3)', 'base'),
  /** A perimeter block, laid along the wall it belongs to. */
  block: () => part('plate(card(width: 150, height: 54, corner: 10), thickness: 74, bevel: 9)', 'base'),
  /** An eight-sided column, for the corners to reflect things in. */
  column: () => part('disc(radius: 46, thickness: 210, sides: 8, bevel: 10)', 'base'),
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

/** Where the static half stands. Built once; the game never touches these. */
export function arenaMatrices(): { tiles: Float32Array; blocks: Float32Array; columns: Float32Array } {
  const tiles: number[] = [];
  const step = 132;
  const across = Math.floor((ARENA_X * 2 - 160) / step);
  const up = Math.floor((ARENA_Y * 2 - 160) / step);
  for (let j = 0; j < up; j++) {
    for (let i = 0; i < across; i++) {
      tiles.push((i - (across - 1) / 2) * step, (j - (up - 1) / 2) * step, 0);
    }
  }
  const blocks: number[] = [];
  for (let x = -ARENA_X + 80; x <= ARENA_X - 80; x += 160) {
    blocks.push(x, -ARENA_Y, 0, x, ARENA_Y, 0);
  }
  for (let y = -ARENA_Y + 90; y <= ARENA_Y - 90; y += 170) {
    blocks.push(-ARENA_X, y, Math.PI / 2, ARENA_X, y, Math.PI / 2);
  }
  const columns = [
    -ARENA_X + 210, -ARENA_Y + 190, 0,
    ARENA_X - 210, -ARENA_Y + 190, 0,
    -ARENA_X + 210, ARENA_Y - 190, 0,
    ARENA_X - 210, ARENA_Y - 190, 0,
  ];
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
