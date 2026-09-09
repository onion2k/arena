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
import { posts as trackPosts, trackMesh } from './track';
import { groupByMesh } from 'artshape-render/assembly/groups';
import type { Mesh } from 'artshape-render/mesh/types';
import { groundMesh, height } from './terrain';

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
 * Where a headlamp sits in the truck's own frame: ahead of the cab, out to
 * either side, at bumper height. The model is placed from these and so is the
 * beam, so a beam always comes out of a lamp you can see.
 */
export const LAMP_AHEAD = 118;
export const LAMP_ACROSS = 46;
export const LAMP_HEIGHT = 84;

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
export const ARENA_X = 6200;
export const ARENA_Y = 6200;

export const MESHES = {
  /**
   * The ground: a grid put where the terrain function says, not a plate. It
   * runs 400mm past the walls so that its own edge is never the edge you see.
   */
  floor: () => groundMesh(ARENA_X + 400, ARENA_Y + 400, 85),
  /** The tarmac: one ribbon following the centreline, not a run of slabs. */
  tile: () => trackMesh(6, 90, 22),
  /** A perimeter block, laid along the wall it belongs to. */
  block: () => part('plate(card(width: 218, height: 74, corner: 12), thickness: 132, bevel: 12)', 'base'),
  /** An eight-sided column, for the corners to reflect things in. */
  column: () => part(`disc(radius: 44, thickness: ${COLUMN_HEIGHT}, sides: 8, bevel: 9)`, 'base'),
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
  /**
   * A headlamp. Two of them on the front of the cab, laid over to face the
   * way the truck is going. There were two headlight beams before this and
   * nothing on the truck they came out of, which read as one glow with no
   * source — a lamp you can see is what makes a beam belong to the vehicle.
   */
  lamp: () => part('disc(radius: 17, thickness: 14, sides: 14, bevel: 4)'),
  /** The post the starting lights stand on, beside the line. */
  gantry: () => part('disc(radius: 30, thickness: 900, sides: 8, bevel: 7)', 'base'),
};

/** How tall an unscaled post is, so a spotlight can sit on top of one. */
export const COLUMN_HEIGHT = 430;

/**
 * The posts, which line the circuit rather than standing on a grid.
 *
 * They are far enough outside the tarmac that the truck can run a little wide
 * without hitting one — 260mm past the edge, against a truck 98 wide and a
 * post up to 78 — so they are the price of a mistake and not the edge of the
 * road. Alternating heights, because a row of identical posts running away
 * from you is the strongest sense of distance there is.
 */
export const COLUMN_RADIUS = 58;
export const COLUMNS: [number, number, number][] = trackPosts(640);

/** How far a post or a wall block is sunk, so no slope opens a gap under it. */
const SINK = 48;

export function arenaMatrices(): { tiles: Float32Array; blocks: Float32Array; columns: Float32Array } {
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

  // The tarmac lies on the ground and tips with it, like slabs laid over a
  // hill. Posts and walls stay upright and are sunk instead: a leaning post
  // reads as a mistake where a leaning paving slab reads as ground.
  return {
    tiles: identityPlacement(),
    blocks: pack(blocks, undefined, true),
    columns: pack(columns, columnScales, true),
  };
}

/** Triples of x, y, turn into column-major placements, optionally scaled. */
function pack(triples: number[], scales?: number[], onGround = false): Float32Array {
  const n = triples.length / 3;
  const out = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const x = triples[i * 3]; const y = triples[i * 3 + 1];
    const a = triples[i * 3 + 2];
    const k = scales ? scales[i] : 1;
    const c = Math.cos(a) * k; const s = Math.sin(a) * k;
    const o = i * 16;
    out[o] = c; out[o + 1] = s;
    out[o + 4] = -s; out[o + 5] = c;
    out[o + 10] = k;
    out[o + 12] = x; out[o + 13] = y;
    out[o + 14] = onGround ? height(x, y) - SINK : 0;
    out[o + 15] = 1;
  }
  return out;
}

/** The ribbon is already in world coordinates, so it needs no placement. */
function identityPlacement(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
