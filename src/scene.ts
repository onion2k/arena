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
import { TRACK_LIFT, kerbMesh, posts as trackPosts, trackMesh } from './track';
import type { Post } from './track';
import { groupByMesh } from 'artshape-render/assembly/groups';
import type { Mesh } from 'artshape-render/mesh/types';
import { groundMesh, height } from './terrain';
import { SIZE } from './world';

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
 * and 12.4 metres across at the medium size the game shipped with.
 *
 * Size alone does not read as size, though — a bigger empty floor just looks
 * like the same floor with the camera further back. What gives a space scale
 * is things of a known size repeating away into it, which is why the posts
 * are on a grid and why the tiles are worth their draw call.
 *
 * Everything that stands in the arena is placed from these two numbers and
 * the camera solves its distance from them, so this is the only place the
 * size lives — along with `SIZE` itself, which is what moves it. `resizeArena`
 * is called first in `useTrack`, before the circuit is even generated: the
 * generator's own bounds scale by the same factor (see `scaleShape`), and
 * both have to move together or the road escapes the box or rattles round
 * inside it.
 */
export let ARENA_X = 6200;
export let ARENA_Y = 6200;

/** Put the arena's bounds in force for whatever `SIZE` is now. */
export function resizeArena() {
  ARENA_X = 6200 * SIZE;
  ARENA_Y = ARENA_X;
}

export const MESHES = {
  /**
   * The ground: a grid put where the terrain function says, not a plate. It
   * runs 400mm past the walls so that its own edge is never the edge you see.
   *
   * The cell grows with the square root of the size so that a bigger arena
   * does not cost the ground mesh's vertex count quadratically: doubling the
   * linear size at a fixed cell would be four times the vertices and four
   * times what the sun's shadow map has to rasterise every frame for it. At
   * `sqrt(2)` the cell instead the count merely doubles, and the ramps —
   * 720mm wavelength at their sharpest — are still six vertices across at
   * the largest size, which is enough to read as a slope rather than a facet.
   */
  floor: () => groundMesh(ARENA_X + 400, ARENA_Y + 400, 85 * Math.sqrt(SIZE)),
  /** The tarmac: one ribbon following the centreline, not a run of slabs. */
  tile: () => trackMesh(6, 90, TRACK_LIFT),
  /**
   * The kerbs, in two halves so the blocks can alternate colour. They sit
   * 8mm above the tarmac: enough to catch a light from the side, not enough
   * for a wheel to trip over — nothing collides with them, and a kerb that
   * looked like a step you could not cross would be a lie.
   */
  kerbA: () => kerbMesh(0, 90, 30),
  kerbB: () => kerbMesh(1, 90, 30),
  /**
   * A lamp post, in three pieces: the pole it stands on, the arm that reaches
   * out over the road, and the head on the end of the arm.
   *
   * It was one fat eight-sided column 88mm across with a floodlight balanced
   * on top of it, which at the scale of this arena is a chimney rather than a
   * street light — and standing a chimney 260mm from the edge of a road 760
   * wide made the circuit feel like a corridor. Three pieces rather than one
   * mesh because material belongs to a draw here and the head wants to be a
   * different thing from the pole: this way the head can be near-white and
   * glossy, and read as the thing the light comes out of.
   *
   * Built by hand and not by the parts library, since the shadows: a
   * bevelled part from the library is a jewellery part, and a lamp post made
   * of three of them was 1,930 triangles, which across 84 posts was 162,000
   * — 42% of everything the shadow maps had to draw, every frame, for
   * bevels nobody could see from the road. A prism and two boxes are 44.
   */
  pole: () => prism(POLE_RADIUS, COLUMN_HEIGHT, 8),
  arm: () => box(LAMP_ARM, 21, 17),
  head: () => box(78, 50, HEAD_DEPTH),
  /**
   * A small lit disc, reused for the starting bulbs. The vehicle's own
   * headlamp mesh is part of its `VehicleKit` now (see `vehicles.ts`), since
   * different classes carry different lamps; this one never changes with the
   * driver.
   */
  lamp: () => part('disc(radius: 17, thickness: 14, sides: 14, bevel: 4)'),
  /** The post the starting lights stand on, beside the line. */
  gantry: () => part('disc(radius: 30, thickness: 900, sides: 8, bevel: 7)', 'base'),
};

/** How tall an unscaled post is, measured to where its arm is bolted on. */
export const COLUMN_HEIGHT = 520;
/**
 * The pole, and the arm that carries the light out over the road.
 *
 * These two numbers are the whole of why the posts could move back. A light
 * on top of a column has to stand where the light is wanted; a light on the
 * end of an arm does not, and the pole can be as far from the road as it
 * likes so long as the arm makes the difference up. So the poles went from
 * 260mm off the tarmac to 470 — the road no longer has posts on its shoulder
 * — while the lamps themselves are 260 out over it, exactly where they were.
 */
export const POLE_RADIUS = 17;
export const LAMP_ARM = 210;
/** How deep the head on the end of the arm is, top face to underside. */
export const HEAD_DEPTH = 27;
/** How far a post's foot stands from the edge of the tarmac. */
export const POST_CLEARANCE = 470;

/** How far a post is sunk, so no slope opens a gap under it. */
const SINK = 48;

/** Where a post's lamp head hangs: out along its arm, at the top of its pole. */
export function lampAt(post: Post): [number, number, number] {
  const reach = LAMP_ARM - 24;
  const x = post.x + Math.cos(post.aim) * reach;
  const y = post.y + Math.sin(post.aim) * reach;
  return [x, y, height(post.x, post.y) - SINK + COLUMN_HEIGHT * post.scale - 8];
}

/**
 * Where the light itself comes from: just under the head, not inside it.
 *
 * The flood used to be placed at the head's centre, which put a box round
 * it. The half of that box past the shadow map's near plane — the head's
 * underside, out toward the road — was drawn into the lamp's own map, and
 * from a blocker a few millimetres from the lens it shaded everything from
 * a third of the way across the tarmac to past the far edge. Every lamp
 * did it, and the road at night was pools with a black bite out of each.
 */
export function beamAt(post: Post): [number, number, number] {
  const [x, y, z] = lampAt(post);
  return [x, y, z - HEAD_DEPTH / 2 - 2];
}

/**
 * The posts, which line the circuit rather than standing on a grid.
 *
 * They are far enough outside the tarmac that the truck can run a little wide
 * without hitting one — 260mm past the edge, against a truck 98 wide and a
 * post up to 78 — so they are the price of a mistake and not the edge of the
 * road. Alternating heights, because a row of identical posts running away
 * from you is the strongest sense of distance there is.
 */
export const COLUMN_RADIUS = POLE_RADIUS;
/**
 * Every 1280mm of road rather than every 640: half as many posts as there
 * were. Eighty-odd lamps lit the circuit evenly and made it read as a lit
 * corridor with no dark in it — and the dark is what the headlights are for.
 * Half of them leaves a pool under each and a stretch between, which is what
 * a road at night looks like, and it pays for the rest of this: twice the
 * lamps carrying shadow maps, and every one of them throwing a cone through
 * the mist.
 */
export let COLUMNS: Post[] = trackPosts(1280, POST_CLEARANCE);

/** Stand the posts again, along wherever the road now runs. */
export function restandColumns() { COLUMNS = trackPosts(1280, POST_CLEARANCE); }

export function arenaMatrices(): {
  tiles: Float32Array;
  poles: Float32Array; arms: Float32Array; heads: Float32Array;
} {
  // The pole stands on the ground; the arm and the head hang off the top of
  // it, turned to face the road. All three are worked out from the same post
  // and the same `lampAt`, so a head is never anywhere but on the end of its
  // own arm, and the beam is never anywhere but inside its own head.
  const poles = new Float32Array(COLUMNS.length * 16);
  const arms = new Float32Array(COLUMNS.length * 16);
  const heads = new Float32Array(COLUMNS.length * 16);
  for (let i = 0; i < COLUMNS.length; i++) {
    const post = COLUMNS[i];
    const foot = height(post.x, post.y) - SINK;
    const top = foot + COLUMN_HEIGHT * post.scale;
    const [hx, hy, hz] = lampAt(post);
    place(poles, i, post.x, post.y, foot, 0, post.scale);
    place(arms, i, (post.x + hx) / 2, (post.y + hy) / 2, top - 9, post.aim, 1);
    place(heads, i, hx, hy, hz, post.aim, 1);
  }

  // The tarmac lies on the ground and tips with it, like slabs laid over a
  // hill. Posts and walls stay upright and are sunk instead: a leaning post
  // reads as a mistake where a leaning paving slab reads as ground.
  return { tiles: identityPlacement(), poles, arms, heads };
}

/**
 * A right prism standing on z = 0: `sides` flat faces and a flat top, each
 * face with its own vertices so it shades as a facet. No bottom — it stands
 * on the ground.
 */
export function prism(radius: number, height: number, sides: number): Mesh {
  const faces = sides * 2 + sides;               // two triangles a side, one a top wedge
  const positions = new Float32Array(faces * 9);
  const normals = new Float32Array(faces * 9);
  const uvs = new Float32Array(faces * 6);
  const indices = new Uint32Array(faces * 3);
  let v = 0;
  const put = (p: number[], n: number[]) => {
    positions.set(p, v * 3); normals.set(n, v * 3); uvs.set([0, 0], v * 2); indices[v] = v; v++;
  };
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius, y0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, y1 = Math.sin(a1) * radius;
    const am = (a0 + a1) / 2;
    const n = [Math.cos(am), Math.sin(am), 0];
    put([x0, y0, 0], n); put([x1, y1, 0], n); put([x1, y1, height], n);
    put([x0, y0, 0], n); put([x1, y1, height], n); put([x0, y0, height], n);
    put([0, 0, height], [0, 0, 1]); put([x0, y0, height], [0, 0, 1]); put([x1, y1, height], [0, 0, 1]);
  }
  return { positions, normals, uvs, indices };
}

/** A box about its own centre, flat shaded: twelve triangles. */
export function box(width: number, depth: number, height: number): Mesh {
  const hx = width / 2, hy = depth / 2, hz = height / 2;
  const positions = new Float32Array(12 * 9);
  const normals = new Float32Array(12 * 9);
  const uvs = new Float32Array(12 * 6);
  const indices = new Uint32Array(12 * 3);
  let v = 0;
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    for (const p of [a, b, c, a, c, d]) {
      positions.set(p, v * 3); normals.set(n, v * 3); uvs.set([0, 0], v * 2); indices[v] = v; v++;
    }
  };
  quad([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]);
  quad([-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz], [0, 0, -1]);
  quad([hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [1, 0, 0]);
  quad([-hx, hy, -hz], [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-1, 0, 0]);
  quad([-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [0, 1, 0]);
  quad([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]);
  return { positions, normals, uvs, indices };
}

/** One placement written into a pool: a turn about z, a uniform scale, a spot. */
function place(out: Float32Array, i: number, x: number, y: number, z: number, turn: number, k: number) {
  const c = Math.cos(turn) * k; const s = Math.sin(turn) * k;
  const o = i * 16;
  out[o] = c; out[o + 1] = s;
  out[o + 4] = -s; out[o + 5] = c;
  out[o + 10] = k;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z;
  out[o + 15] = 1;
}

/** The ribbon is already in world coordinates, so it needs no placement. */
function identityPlacement(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
