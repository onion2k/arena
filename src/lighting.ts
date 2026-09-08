/**
 * What the arena is lit by, and what glows over the top of it, rebuilt from
 * scratch every frame.
 *
 * Nothing here is cached between frames on purpose. A spike measured a plain
 * forward loop carrying three to five hundred point lights before it wanted
 * tiles or clusters, and this scene asks for two or three hundred at its
 * busiest — so the cheapest thing to do with the light list is throw it away
 * and write it again.
 */
import { LightPool } from 'artshape-render/game/lights';
import { EFFECT_STRIDE } from 'artshape-render/game/renderer';
import type { Arena } from './game';
import { ARENA_X, ARENA_Y } from './scene';
import { project } from './matrix';

export const LIGHT_CAPACITY = 512;
export const EFFECT_CAPACITY = 512;
/**
 * How many enemies carry their own light. Point lights are what this frame
 * actually spends its time on — measured on a Mac mini at 1080p, an arena of
 * 140 enemies and 146 lights is 3.1 ms and 2.8 of that is the light loop,
 * about 0.019 ms a light — so this is the first thing a ladder would take
 * away. At 128 a full frame is still under a fifth of a 60 fps budget.
 */
const ENEMY_LIGHTS = 128;

/**
 * The slow coloured wash that keeps the arena from being black when it is
 * empty. Ten of them rather than seven, and their orbit and reach scale with
 * the arena: the same seven lights over nearly three times the floor left
 * most of it dark.
 */
const AMBIENT = 12;
function ambience(pool: LightPool, t: number) {
  for (let i = 0; i < AMBIENT; i++) {
    const a = t * 0.22 + (i / AMBIENT) * Math.PI * 2;
    const hue = (i / AMBIENT + t * 0.03) % 1;
    pool.add({
      position: [
        Math.cos(a) * ARENA_X * 0.82,
        Math.sin(a) * ARENA_Y * 0.82,
        400 + Math.sin(t * 0.7 + i) * 90,
      ],
      radius: Math.max(ARENA_X, ARENA_Y) * 0.8,
      colour: hueToRgb(hue),
      intensity: 3.0,
    });
  }
}

export function lightsFor(pool: LightPool, arena: Arena, t: number) {
  pool.clear();
  ambience(pool, t);

  const hurt = arena.invuln > 0 && Math.sin(arena.invuln * 40) > 0;
  const cy = Math.cos(arena.pAngle); const sy = Math.sin(arena.pAngle);
  /** A point in the truck's own frame, in the world. */
  const at = (lx: number, ly: number, z: number): [number, number, number] =>
    [arena.px + lx * cy - ly * sy, arena.py + lx * sy + ly * cy, z];

  // one over the truck, so the truck itself is lit and not only the floor
  pool.add({
    position: at(-10, 0, 250),
    radius: 460,
    colour: hurt ? [1, 0.4, 0.35] : [1, 0.93, 0.78],
    intensity: 10,
  });

  // Headlights. A point light throws in every direction, so these are placed
  // out ahead of the cab rather than at it: what reads as a beam is the pool
  // they lay on the floor in front, and the tiles picking it up edge by edge.
  for (const side of [-1, 1]) {
    pool.add({
      position: at(210, side * 46, 62),
      radius: 720,
      colour: hurt ? [1, 0.45, 0.4] : [1, 0.95, 0.82],
      intensity: 13,
    });
  }

  // exhaust under the tailgate when the throttle is down, and brake lights
  if (arena.thrusting > 0) {
    pool.add({
      position: at(-150, 0, 40),
      radius: 320,
      colour: [1, 0.62, 0.3],
      intensity: 12 * arena.thrusting,
    });
  }
  if (arena.braking > 0) {
    for (const side of [-1, 1]) {
      pool.add({
        position: at(-140, side * 48, 58),
        radius: 260,
        colour: [1, 0.12, 0.07],
        intensity: 11 * arena.braking,
      });
    }
  }

  // the muzzle: brief, bright, and the reason the floor flickers when firing
  if (arena.lastShot < 0.055) {
    const f = 1 - arena.lastShot / 0.055;
    pool.add({
      position: [arena.muzzleX, arena.muzzleY, 104],
      radius: 520,
      colour: [1, 0.92, 0.72],
      intensity: 38 * f * f,
    });
  }

  // one a shot. Two hundred of these is where the light count actually goes.
  for (let i = 0; i < arena.bolts; i++) {
    pool.add({ position: [arena.bx[i], arena.by[i], 44], radius: 230, colour: [0.34, 0.92, 1], intensity: 8 });
  }

  for (let i = 0; i < Math.min(arena.enemies, ENEMY_LIGHTS); i++) {
    const flash = arena.eflash[i] > 0;
    pool.add({
      position: [arena.ex[i], arena.ey[i], 42],
      radius: flash ? 320 : 190,
      colour: flash ? [1, 0.95, 0.9] : [1, 0.24, 0.13],
      intensity: flash ? 18 : 4.2,
    });
  }

  // explosions: a light that opens out and dies away with the square of what is left
  for (const b of arena.blasts) {
    const k = 1 - b.age / b.life;
    pool.add({
      position: [b.x, b.y, 50 + (1 - k) * 90],
      radius: (150 + (1 - k) * 460) * b.power,
      colour: [1, 0.52 + k * 0.35, 0.16 + k * 0.2],
      intensity: 60 * k * k * b.power,
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
  // a shot's own glow, small and hot
  for (let i = 0; i < arena.bolts; i++) {
    n = glow(out, n, vp, arena.bx[i], arena.by[i], 44, 20, 2.2, [0.4, 0.95, 1], 3.2);
  }
  // an explosion is three layers: white core, orange body, red halo
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
  if (arena.lastShot < 0.06) {
    const f = 1 - arena.lastShot / 0.06;
    n = glow(out, n, vp, arena.muzzleX, arena.muzzleY, 104, 78 * f, 3.2 * f, [1, 0.93, 0.72], 2);
  }
  return n;
}

/** A hue as full-saturation rgb, for the wash. */
function hueToRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.max(0, Math.min(1, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
