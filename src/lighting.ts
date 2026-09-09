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
import { TURRET_BACK, type Arena } from './game';
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

  // The searchlight, on the gun. This is the player's eye: a long narrow beam
  // that goes wherever the cannon is aimed, so looking and shooting are the
  // same act and you cannot do one without committing to the other.
  pool.add({
    position: at(TURRET_BACK, 0, 150),
    radius: 4200,
    // cold, against the headlights' warm: the two are hard to tell apart by
    // shape when they overlap and trivial to tell apart by colour
    colour: [0.80, 0.90, 1],
    intensity: 30,
    // The turret keeps its bearing whatever the body does — a gun that
    // swung with every bump would be unusable — but its elevation follows the
    // nose, so cresting a rise throws the beam out and dropping into a
    // hollow brings it in close.
    direction: [Math.cos(arena.aim), Math.sin(arena.aim), -0.20 + bf[2]],
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

  // The muzzle, kept small. A light that reaches a metre and a half, going
  // off twelve times a second, is a strobe over the whole hall rather than a
  // flash at the end of a barrel.
  if (arena.lastShot < 0.055) {
    const f = 1 - arena.lastShot / 0.055;
    pool.add({
      position: [arena.muzzleX, arena.muzzleY, 104], radius: 620,
      colour: [1, 0.92, 0.72], intensity: 4.5 * f * f,
    });
  }

  // The tracers carry no light. They used to carry one each, and a dozen
  // rounds a second crossing a dark hall meant every surface in it was being
  // relit several times a second by things that were only passing through —
  // which reads as a fault rather than as gunfire. They are still bright:
  // what draws them is an additive glow, which lights nothing but itself.
  //
  // An explosion is the exception, and now the only one. It is the single
  // moment the room is bright, so it is worth making it count.
  for (const b of arena.blasts) {
    const k = 1 - b.age / b.life;
    pool.add({
      position: [b.x, b.y, 60 + (1 - k) * 120],
      radius: (900 + (1 - k) * 2200) * b.power,
      colour: [1, 0.52 + k * 0.35, 0.16 + k * 0.2],
      // squared in the power as well as in what is left, so a spark off a
      // wall stays a spark while a kill lights the bay it happened in
      intensity: 46 * k * k * b.power * b.power,
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
  // Four layers to an explosion: a white core that is gone in a tenth of a
  // second, the body of it, a slower orange bloom, and a wide red halo that
  // opens out well past the rest. The core is what makes it read as a bang
  // rather than as a light being turned on.
  for (const b of arena.blasts) {
    const k = 1 - b.age / b.life;
    const grow = (1 - k) * b.power;
    const flash = Math.max(0, 1 - b.age / (b.life * 0.22));
    n = glow(out, n, vp, b.x, b.y, 60, (34 + grow * 40) * b.power, 7 * flash * flash, [1, 1, 0.95], 4);
    n = glow(out, n, vp, b.x, b.y, 60, (44 + grow * 150) * b.power, 3.4 * k * k, [1, 0.93, 0.72], 2.6);
    n = glow(out, n, vp, b.x, b.y, 60, (80 + grow * 330) * b.power, 1.3 * k, [1, 0.52, 0.16], 1.6);
    n = glow(out, n, vp, b.x, b.y, 60, (130 + grow * 520) * b.power, 0.34 * k * k, [1, 0.24, 0.08], 1.0);
  }
  const t = arena.truck;
  const cy = Math.cos(t.yaw), sy = Math.sin(t.yaw);
  const at = (lx: number, ly: number) => [t.x + lx * cy - ly * sy, t.y + lx * sy + ly * cy];
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
