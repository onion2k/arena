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
import type { Arena } from './game';
import { COLUMNS, COLUMN_HEIGHT, LAMP_ACROSS, LAMP_AHEAD, LAMP_HEIGHT } from './scene';
import { project } from './matrix';

export const LIGHT_CAPACITY = 256;
export const EFFECT_CAPACITY = 512;

/**
 * The spots over the posts, one each, sweeping.
 *
 * They are what makes the arena a place rather than a void: a slow turning
 * beam that catches a drone crossing it, and the only light that reaches
 * anywhere the player is not pointing. Each turns at its own rate and starts
 * at its own angle, so the pattern never repeats and there is no safe corner.
 */
function posts(pool: LightPool, t: number) {
  for (let i = 0; i < COLUMNS.length; i++) {
    const [x, y, scale] = COLUMNS[i];
    // a rate that is not a multiple of any other, and alternating direction
    const rate = 0.17 + (i % 5) * 0.043;
    const spin = i % 2 === 0 ? 1 : -1;
    const az = t * rate * spin + i * 1.37;
    // tilted well off vertical, so the pool it throws sweeps a wide ring
    const tilt = 0.62;
    const hue = (i / COLUMNS.length + 0.12) % 1;
    const c = hueToRgb(hue);
    pool.add({
      position: [x, y, COLUMN_HEIGHT * scale - 24],
      radius: 2400,
      // barely tinted: a coloured beam is pretty and a white one shows you
      // what colour the thing you have found is
      colour: [0.55 + c[0] * 0.45, 0.55 + c[1] * 0.45, 0.6 + c[2] * 0.4],
      intensity: 5.5,
      direction: [Math.cos(az) * Math.sin(tilt), Math.sin(az) * Math.sin(tilt), -Math.cos(tilt)],
      cone: [7, 17],
    });
  }
}

export function lightsFor(pool: LightPool, arena: Arena, t: number) {
  pool.clear();
  posts(pool, t);

  const hurt = arena.invuln > 0 && Math.sin(arena.invuln * 40) > 0;
  const cy = Math.cos(arena.pAngle); const sy = Math.sin(arena.pAngle);
  /** A point in the truck's own frame, in the world. */
  const at = (lx: number, ly: number, z: number): [number, number, number] =>
    [arena.px + lx * cy - ly * sy, arena.py + lx * sy + ly * cy, z];

  // The searchlight, on the gun. This is the player's eye: a long narrow beam
  // that goes wherever the cannon is aimed, so looking and shooting are the
  // same act and you cannot do one without committing to the other.
  pool.add({
    position: [arena.gunX, arena.gunY, 150],
    radius: 4200,
    // cold, against the headlights' warm: the two are hard to tell apart by
    // shape when they overlap and trivial to tell apart by colour
    colour: [0.80, 0.90, 1],
    intensity: 30,
    direction: [Math.cos(arena.aim), Math.sin(arena.aim), -0.20],
    cone: [6, 16],
  });

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
    const toe = arena.pAngle + side * 0.07;
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
      direction: [Math.cos(toe), Math.sin(toe), -0.20],
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

  if (arena.lastShot < 0.055) {
    const f = 1 - arena.lastShot / 0.055;
    pool.add({
      position: [arena.muzzleX, arena.muzzleY, 104], radius: 1400,
      colour: [1, 0.92, 0.72], intensity: 9 * f * f,
    });
  }

  // The tracers. These are the only thing besides the beams that lights the
  // floor, and watching one fly is how you read the room between sweeps.
  for (let i = 0; i < arena.bolts; i++) {
    pool.add({
      position: [arena.bx[i], arena.by[i], 44], radius: 950,
      colour: [0.34, 0.92, 1], intensity: 1.1,
    });
  }

  // and an explosion, which lights everything around it for half a second —
  // the one moment the room is bright, and worth using
  for (const b of arena.blasts) {
    const k = 1 - b.age / b.life;
    pool.add({
      position: [b.x, b.y, 50 + (1 - k) * 90],
      radius: (700 + (1 - k) * 1600) * b.power,
      colour: [1, 0.52 + k * 0.35, 0.16 + k * 0.2],
      intensity: 14 * k * k * b.power,
    });
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

export function effectsFor(out: Float32Array, arena: Arena, vp: Float32Array): number {
  let n = 0;
  for (let i = 0; i < arena.bolts; i++) {
    n = glow(out, n, vp, arena.bx[i], arena.by[i], 44, 20, 2.2, [0.4, 0.95, 1], 3.2);
  }
  for (const b of arena.blasts) {
    const k = 1 - b.age / b.life;
    const grow = (1 - k) * b.power;
    n = glow(out, n, vp, b.x, b.y, 60, (30 + grow * 90) * b.power, 3.4 * k * k, [1, 0.95, 0.8], 3);
    n = glow(out, n, vp, b.x, b.y, 60, (55 + grow * 190) * b.power, 1.1 * k, [1, 0.55, 0.18], 1.7);
    n = glow(out, n, vp, b.x, b.y, 60, (95 + grow * 300) * b.power, 0.32 * k, [1, 0.28, 0.1], 1.1);
  }
  const cy = Math.cos(arena.pAngle); const sy = Math.sin(arena.pAngle);
  const at = (lx: number, ly: number) => [arena.px + lx * cy - ly * sy, arena.py + lx * sy + ly * cy];
  if (arena.thrusting > 0) {
    const [ex, ey] = at(-150, 0);
    n = glow(out, n, vp, ex, ey, 42, 34 * arena.thrusting, 1.3 * arena.thrusting, [1, 0.6, 0.28], 2.2);
  }
  if (arena.braking > 0) {
    for (const side of [-1, 1]) {
      const [bx, by] = at(-140, side * 48);
      n = glow(out, n, vp, bx, by, 58, 22, 1.6 * arena.braking, [1, 0.15, 0.08], 2.6);
    }
  }
  // the lamps themselves, so they are two bright points on the truck rather
  // than two dark discs with light appearing in front of them
  for (const side of [-1, 1]) {
    const [lx, ly] = at(LAMP_AHEAD + 6, side * LAMP_ACROSS);
    n = glow(out, n, vp, lx, ly, LAMP_HEIGHT, 24, 2.2, [1, 0.9, 0.7], 2.8);
  }
  if (arena.lastShot < 0.06) {
    const f = 1 - arena.lastShot / 0.06;
    n = glow(out, n, vp, arena.muzzleX, arena.muzzleY, 104, 78 * f, 3.2 * f, [1, 0.93, 0.72], 2);
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
