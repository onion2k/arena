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
 * Half the arena, in the millimetres everything else is modelled in: square,
 * and 4.8 metres across.
 *
 * Twelve times the area it started at, and four times the last size. Size
 * alone does not read as size, though — a bigger empty floor just looks like
 * the same floor with the camera further back. What gives a space scale is
 * things of a known size repeating away into it, which is why the posts are
 * on a grid and why the tiles are worth their draw call. The truck is 250mm
 * long against a 4800mm floor: nineteen of it end to end.
 *
 * Everything that stands in the arena is placed from these two numbers and
 * the camera solves its distance from them, so this is the only place the
 * size lives.
 */
export const ARENA_X = 2400;
export const ARENA_Y = 2400;

export const MESHES = {
  /** The slab, its face at z = 0 so everything else can sit on zero. */
  floor: () => part(`plate(card(width: ${ARENA_X * 2}, height: ${ARENA_Y * 2}, corner: 90), thickness: 40, bevel: 10)`, 'top'),
  /** A raised tile. A hundred of them give the moving lights edges to catch. */
  tile: () => part('plate(card(width: 200, height: 200, corner: 18), thickness: 7, bevel: 4)', 'base'),
  /** A perimeter block, laid along the wall it belongs to. */
  block: () => part('plate(card(width: 218, height: 74, corner: 12), thickness: 132, bevel: 12)', 'base'),
  /** An eight-sided column, for the corners to reflect things in. */
  column: () => part('disc(radius: 54, thickness: 250, sides: 8, bevel: 11)', 'base'),
  /**
   * The player is a technical: a flatbed with a gun on the back that aims
   * where it likes, not where the truck is pointing. It is five parts rather
   * than one because that is what makes it read as a vehicle — a body that
   * leans into a turn, wheels that actually roll, and a turret that swings
   * independently of all of it.
   */
  chassis: () => part('plate(card(width: 250, height: 128, corner: 18), thickness: 40, bevel: 7)'),
  cab: () => part('plate(card(width: 96, height: 116, corner: 16), thickness: 64, bevel: 8)'),
  /** Bolts on the face, so that the spin is visible on a shape that is a circle. */
  wheel: () => part('disc(radius: 31, thickness: 24, sides: 16, bolts: 5, boltCircle: 17, boltBore: 5, bevel: 5)'),
  /** The ring the gun stands on. */
  turret: () => part('disc(radius: 37, thickness: 22, sides: 12, bolts: 6, boltCircle: 23, boltBore: 4, bevel: 4)'),
  /** The barrel. Modelled along its own z and laid over to point where it aims. */
  barrel: () => part('disc(radius: 11, thickness: 146, sides: 12, bevel: 3)'),

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

/**
 * The posts: a five-by-five grid with only the very middle left out, so
 * twenty-four of them, the outer ring half again as tall as the inner.
 *
 * The grid is the point. A dozen posts scattered at random read as clutter;
 * twenty-four in rows read as a hall, and rows of a thing whose size you
 * know running away from you is the strongest sense of scale available for
 * twenty-four instances of one draw. The heights differ by ring so the far
 * ones are not simply the near ones smaller, which is the cue that tells the
 * eye it is looking at distance rather than at a smaller object.
 *
 * The gaps are 900mm between centres, better than 700 clear: wide enough to
 * drive a 250mm truck through at speed, tight enough that a shot across the
 * arena usually meets one.
 */
const POST_GRID = [-1800, -900, 0, 900, 1800];
export const COLUMNS: [number, number, number][] = [];
for (const x of POST_GRID) {
  for (const y of POST_GRID) {
    if (x === 0 && y === 0) continue;   // the middle stays open
    const outer = Math.abs(x) === 1800 || Math.abs(y) === 1800;
    COLUMNS.push([x, y, outer ? 1.5 : 0.95]);
  }
}

/** Where the static half stands. Built once; the game never touches these. */
export function arenaMatrices(): { tiles: Float32Array; blocks: Float32Array; columns: Float32Array } {
  const tiles: number[] = [];
  const step = 218;
  const across = Math.floor((ARENA_X * 2 - 220) / step);
  const up = Math.floor((ARENA_Y * 2 - 220) / step);
  for (let j = 0; j < up; j++) {
    for (let i = 0; i < across; i++) {
      tiles.push((i - (across - 1) / 2) * step, (j - (up - 1) / 2) * step, 0);
    }
  }
  const blocks: number[] = [];
  for (let x = -ARENA_X + 115; x <= ARENA_X - 115; x += 232) {
    blocks.push(x, -ARENA_Y, 0, x, ARENA_Y, 0);
  }
  for (let y = -ARENA_Y + 125; y <= ARENA_Y - 125; y += 245) {
    blocks.push(-ARENA_X, y, Math.PI / 2, ARENA_X, y, Math.PI / 2);
  }
  const columns: number[] = [];
  const columnScales: number[] = [];
  for (const [x, y, scale] of COLUMNS) { columns.push(x, y, 0); columnScales.push(scale); }
  return { tiles: pack(tiles), blocks: pack(blocks), columns: pack(columns, columnScales) };
}

/** Triples of x, y, turn into column-major placements, optionally scaled. */
function pack(triples: number[], scales?: number[]): Float32Array {
  const n = triples.length / 3;
  const out = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const a = triples[i * 3 + 2];
    const k = scales ? scales[i] : 1;
    const c = Math.cos(a) * k; const s = Math.sin(a) * k;
    const o = i * 16;
    out[o] = c; out[o + 1] = s;
    out[o + 4] = -s; out[o + 5] = c;
    out[o + 10] = k;
    out[o + 12] = triples[i * 3]; out[o + 13] = triples[i * 3 + 1]; out[o + 15] = 1;
  }
  return out;
}
