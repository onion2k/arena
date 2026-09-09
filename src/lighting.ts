/**
 * What the arena is lit by, and what glows over the top of it, rebuilt from
 * scratch every frame.
 *
 * The hall is dark. Almost nothing in it lights itself: the drones carry no
 * light of their own, so a drone away from a beam is a shape you cannot see
 * until something falls on it. What light there is comes from beams — a
 * spotlight over every post, sweeping; the searchlight on the cannon, which
 * points where the gun points; the truck's headlights, which point where the
 * truck is going. Finding things is the game, and the lights are how.
 *
 * Nothing here is cached between frames on purpose. A spike measured a plain
 * forward loop carrying three to five hundred point lights before it wanted
 * tiles or clusters, and this scene asks for fewer than a hundred now that
 * the crowd is unlit — so the cheapest thing to do with the light list is
 * throw it away and write it again.
 */
import { LightPool } from 'artshape-render/game/lights';
import { EFFECT_STRIDE } from 'artshape-render/game/renderer';
import type { Race } from './game';
import { COLUMNS, COLUMN_HEIGHT, LAMP_ACROSS, LAMP_AHEAD, LAMP_HEIGHT } from './scene';
import { height } from './terrain';
import { gantry } from './track';
import { project } from './matrix';

export const LIGHT_CAPACITY = 256;
export const EFFECT_CAPACITY = 512;

/**
 * The floodlights on the trackside posts: one each, aimed inward and down at
 * the tarmac beside it.
 *
 * They used to sweep, which was right when the game was about finding things
 * in the dark and is wrong now. A driver needs to know what the corner does
 * before entering it, and a light that will be pointing elsewhere by the time
 * you arrive is worse than no light. So they are fixed, and between them they
 * light the whole circuit — the arena beyond it stays dark, which is what
 * makes the track read as a track.
 */
function floods(pool: LightPool) {
  for (let i = 0; i < COLUMNS.length; i++) {
    const [x, y, scale] = COLUMNS[i];
    // inward, toward the middle of the arena, which is where the track is
    const r = Math.hypot(x, y) || 1;
    const inx = -x / r; const iny = -y / r;
    // The posts come in pairs, the inner edge first: an inner post has to
    // look outward to light the track and an outer one inward. Getting this
    // the wrong way round lights the empty arena and leaves the circuit dark,
    // which is exactly what it did.
    const side = i % 2 === 0 ? -1 : 1;
    const hue = (i / COLUMNS.length + 0.12) % 1;
    const c = hueToRgb(hue);
    pool.add({
      position: [x, y, height(x, y) + COLUMN_HEIGHT * scale - 24],
      radius: 2000,
      // barely tinted: a coloured circuit is pretty, a white one is legible
      colour: [0.72 + c[0] * 0.28, 0.72 + c[1] * 0.28, 0.75 + c[2] * 0.25],
      intensity: 9,
      direction: [inx * side * 0.55, iny * side * 0.55, -0.83],
      cone: [16, 34],
    });
  }
}

/**
 * The starting lights: red over the line while they hold you, then a green
 * wash for a second and a half once they go out.
 *
 * The bulbs on the post are lit by their own colour and a glow apiece, which
 * is what you look at; this is what they throw on the tarmac, which is what
 * tells you the line is under you without looking away from it.
 */
function starter(pool: LightPool, arena: Race) {
  const g = gantry();
  for (const [px, py] of g.posts) {
    const z = height(px, py);
    if (arena.bulbsLit > 0) {
      pool.add({
        position: [px, py, z + 500],
        radius: 2200,
        colour: [1, 0.06, 0.03],
        intensity: 3.0 * arena.bulbsLit,
        direction: [Math.cos(g.facing) * 0.5, Math.sin(g.facing) * 0.5, -0.86],
        cone: [22, 46],
      });
    } else if (arena.sinceStart < 1.5) {
      const k = 1 - arena.sinceStart / 1.5;
      pool.add({
        position: [px, py, z + 500],
        radius: 2600,
        colour: [0.1, 1, 0.25],
        intensity: 16 * k * k,
        direction: [Math.cos(g.facing) * 0.5, Math.sin(g.facing) * 0.5, -0.86],
        cone: [24, 50],
      });
    }
  }
}

export function lightsFor(pool: LightPool, arena: Race) {
  pool.clear();
  floods(pool);
  starter(pool, arena);

  const hurt = false;
  // The lamps are bolted to a body that pitches, rolls and leaves the ground,
  // so they are placed and aimed in its frame rather than on a plane at zero.
  // A headlight that stays level while the truck noses over a crest is a
  // headlight that has come loose.
  const car = arena.truck;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const cp = Math.cos(car.pitch), sp = Math.sin(car.pitch);
  const cr = Math.cos(car.roll), sr = Math.sin(car.roll);
  const bf: [number, number, number] = [cy * cp, sy * cp, -sp];
  const bl: [number, number, number] = [cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr];
  const bu: [number, number, number] = [cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr];
  /** A point in the truck's own frame, in the world. Heights are as they were
   *  when the floor was flat, so the body's own 52mm of ride is taken off. */
  const at = (lx: number, ly: number, z: number): [number, number, number] => [
    car.x + bf[0] * lx + bl[0] * ly + bu[0] * (z - 52),
    car.y + bf[1] * lx + bl[1] * ly + bu[1] * (z - 52),
    car.z + bf[2] * lx + bl[2] * ly + bu[2] * (z - 52),
  ];
  /** A direction in the truck's frame, so a beam tips with the body. */
  const facing = (lx: number, ly: number, lz: number): [number, number, number] => [
    bf[0] * lx + bl[0] * ly + bu[0] * lz,
    bf[1] * lx + bl[1] * ly + bu[1] * lz,
    bf[2] * lx + bl[2] * ly + bu[2] * lz,
  ];

  // Headlights: shorter, wider, and pointed where the truck is going rather
  // than where it is looking. They are what stops you driving into a post
  // while watching something else.
  //
  // Forward, because that is what a headlight is for. They were toed right
  // out to either side for a while so that you could tell there were two of
  // them, and two beams you can count while neither lights the road is worse
  // than one wash that does. What makes them read as a pair is the two lamps
  // on the truck: a car throws one pool ahead and nobody looks at it and
  // thinks it has one lamp.
  //
  // So a few degrees of splay each, which is what a real pair has, and a wide
  // cone — a wash over the road rather than a beam at a thing. The narrow
  // beam at a thing is the searchlight, and it is cold where these are warm.
  for (const side of [-1, 1]) {
    pool.add({
      position: at(LAMP_AHEAD, side * LAMP_ACROSS, LAMP_HEIGHT),
      radius: 2400,
      colour: hurt ? [1, 0.45, 0.4] : [1, 0.87, 0.62],
      // A lamp 84mm above the floor sees it almost edge-on: at 900mm out the
      // cosine between the floor's normal and the way back to the lamp is
      // 0.09, so nine tenths of the beam is thrown away by the geometry
      // before intensity is even considered. That is true of a real headlight
      // too, and a real headlight answers it by being very bright.
      intensity: 22,
      direction: facing(Math.cos(side * 0.07), Math.sin(side * 0.07), -0.20),
      cone: [10, 25],
    });
  }

  // a small pool under the truck itself, so it is not a silhouette in its own
  // headlights
  pool.add({
    position: at(-10, 0, 190),
    radius: 620,
    colour: hurt ? [1, 0.4, 0.35] : [0.9, 0.86, 0.8],
    intensity: 1.1,
  });

  if (arena.thrusting > 0) {
    pool.add({
      position: at(-150, 0, 40), radius: 700,
      colour: [1, 0.62, 0.3], intensity: 1.6 * arena.thrusting,
    });
  }
  if (arena.braking > 0) {
    for (const side of [-1, 1]) {
      pool.add({
        position: at(-140, side * 48, 58), radius: 620,
        colour: [1, 0.12, 0.07], intensity: 1.4 * arena.braking,
      });
    }
  }

}

/** One glow: where on screen, how big, how bright, what colour, how hard-edged. */
function glow(
  out: Float32Array, n: number, vp: Float32Array,
  x: number, y: number, z: number,
  worldSize: number, brightness: number,
  colour: [number, number, number], sharp: number,
): number {
  if (n >= EFFECT_CAPACITY) return n;
  const p = project(vp, x, y, z);
  if (!p) return n;
  const o = n * EFFECT_STRIDE;
  out[o] = p[0]; out[o + 1] = p[1];
  // clip units per millimetre at this depth, near enough for a round blob
  out[o + 2] = (worldSize / p[2]) * PROJECTION_SCALE;
  out[o + 3] = brightness;
  out[o + 4] = colour[0]; out[o + 5] = colour[1]; out[o + 6] = colour[2];
  out[o + 7] = sharp;
  return n + 1;
}

/**
 * Set from the camera once at startup: half a clip unit is `tan(fov / 2)`
 * world units at unit depth, so a thing `s` across at depth `w` is
 * `s / w / tan(fov / 2)` of the frame.
 */
let PROJECTION_SCALE = 1;
export function setProjectionScale(fovDegrees: number) {
  PROJECTION_SCALE = 1 / Math.tan((fovDegrees * Math.PI) / 360);
}

/**
 * The glows over the top: the lamps on the truck, its exhaust under power and
 * its brake lights when it is stopping. The tracers and the explosions went
 * with the gun.
 */
export function effectsFor(out: Float32Array, arena: Race, vp: Float32Array): number {
  let n = 0;
  const t = arena.truck;
  const cy = Math.cos(t.yaw); const sy = Math.sin(t.yaw);
  const at = (lx: number, ly: number) => [t.x + lx * cy - ly * sy, t.y + lx * sy + ly * cy];
  if (arena.thrusting > 0) {
    const [ex, ey] = at(-150, 0);
    n = glow(out, n, vp, ex, ey, t.z - 10, 34 * arena.thrusting, 1.3 * arena.thrusting, [1, 0.6, 0.28], 2.2);
  }
  if (arena.braking > 0) {
    for (const side of [-1, 1]) {
      const [bx, by] = at(-140, side * 48);
      n = glow(out, n, vp, bx, by, t.z + 6, 22, 1.6 * arena.braking, [1, 0.15, 0.08], 2.6);
    }
  }
  // the starting bulbs, so a lit one is a hot point rather than a red disc
  const g = gantry();
  for (const [px, py] of g.posts) {
    const gz = height(px, py);
    const bx = px + Math.cos(g.facing) * 38;
    const by = py + Math.sin(g.facing) * 38;
    for (let i = 0; i < arena.bulbsLit; i++) {
      n = glow(out, n, vp, bx, by, gz + g.bulbHeights[i], 34, 3.4, [1, 0.12, 0.06], 3);
    }
    if (arena.bulbsLit === 0 && arena.sinceStart < 1.5) {
      const k = 1 - arena.sinceStart / 1.5;
      for (const h of g.bulbHeights) {
        n = glow(out, n, vp, bx, by, gz + h, 38, 4.2 * k * k, [0.2, 1, 0.35], 3);
      }
    }
  }

  // the lamps themselves, so they are two bright points on the truck rather
  // than two dark discs with light appearing in front of them
  for (const side of [-1, 1]) {
    const [lx, ly] = at(LAMP_AHEAD + 6, side * LAMP_ACROSS);
    n = glow(out, n, vp, lx, ly, t.z + LAMP_HEIGHT - 52, 24, 2.2, [1, 0.9, 0.7], 2.8);
  }
  return n;
}

/** A hue as full-saturation rgb, for the beams to be tinted by. */
function hueToRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.max(0, Math.min(1, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
