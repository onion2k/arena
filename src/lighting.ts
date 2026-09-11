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
import { COLUMNS, LAMP_ACROSS, LAMP_AHEAD, LAMP_HEIGHT, beamAt, lampAt } from './scene';
import { height } from './terrain';
import { gantry } from './track';
import { project } from './matrix';
import { SETTINGS } from './settings';
import { skyAt } from './daylight';

export const LIGHT_CAPACITY = 256;
export const EFFECT_CAPACITY = 512;

/**
 * The floodlights on the trackside posts: one each, aimed across the road and
 * down at it.
 *
 * They lit an oblique ellipse each and left the road between them dark. A
 * post stands 640mm to the side of a track 760 wide, so its light has to
 * reach from 260mm away to 1020 — and a 34 degree cone from a post only 250
 * tall cannot: it covers a band near the inner edge and grazes everything
 * past it at an angle too shallow to light anything. The cone is 58 degrees
 * now, and the posts are 430 tall rather than 250, which is what puts the far
 * edge of the road at an angle that catches light at all.
 *
 * They used to sweep, which was right when the game was about finding things
 * in the dark and is wrong now. A driver needs to know what the corner does
 * before entering it, and a light that will be pointing elsewhere by the time
 * you arrive is worse than no light. So they are fixed, and between them they
 * light the whole circuit — the arena beyond it stays dark, which is what
 * makes the track read as a track.
 */
function floods(pool: LightPool, on: number) {
  for (let i = 0; i < COLUMNS.length; i++) {
    const post = COLUMNS[i];
    // Out of the lamp head, and along the way the arm points. Both come from
    // the post itself now: which side of the road it stands on is a fact
    // about the post, and this file used to re-derive it from the post's
    // index in the list, which is the sort of thing that is right until
    // someone changes the order.
    const [x, y, z] = beamAt(post);
    const inx = Math.cos(post.aim); const iny = Math.sin(post.aim);
    const hue = (i / COLUMNS.length + 0.12) % 1;
    const c = hueToRgb(hue);
    pool.add({
      position: [x, y, z],
      radius: 2900,
      // barely tinted: a coloured circuit is pretty, a white one is legible
      colour: [0.72 + c[0] * 0.28, 0.72 + c[1] * 0.28, 0.75 + c[2] * 0.25],
      // 5.8 by default, turned down from 8.5. The trade is against lighting
      // the whole width of the road, which is what the wide cones are for:
      // too far down and the far edge goes back to being a guess.
      intensity: SETTINGS.flood * on,
      direction: [inx * 0.60, iny * 0.60, -0.80],
      cone: [30, 58],
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

/** How far on the street lights and headlights are, 1 by night to 0 by day. */
function lampsOn(arena: Race): number {
  return skyAt(arena.hours, SETTINGS.ambient).lampsOn;
}

/**
 * How many street lights cast shadows. Fourteen of the renderer's sixteen
 * slots; the other two are the player's own headlights, which want maps more
 * than any lamp does — a truck lighting the mist ahead of it should not be
 * lighting the mist behind the tree in front of it.
 */
const SHADOWED_LAMPS = 14;

/**
 * Where the player's two headlights ended up in the pool, recorded as they
 * are added. They are wanted by index and there is no other way to know it:
 * the pool is written from scratch every frame and how many lights precede
 * them depends on how many posts, how many rivals and whether it is day.
 */
let playerHeads: number[] = [];

/**
 * Which floods should carry a shadow map this frame: the eight nearest the
 * player's truck, by their index in the pool. The floods are added first
 * and in post order, so a post's index is its light's, and only while the
 * lamps are on — by day the list is empty and the sun does the casting.
 *
 * Nearest the truck rather than nearest the camera, because the camera
 * leads the truck and the shadows that matter are the ones you drive
 * through: a tree's across the road ahead, your own from the lamp you are
 * passing under.
 */
export function shadowedLamps(arena: Race): number[] {
  if (lampsOn(arena) <= 0) return [];
  const t = arena.shown;
  const order = COLUMNS.map((p, i) => ({ i, d: (p.x - t.x) ** 2 + (p.y - t.y) ** 2 }));
  order.sort((a, b) => a.d - b.d);
  // The headlights first, so that they are never the two that miss out when
  // the truck is somewhere the posts are close together. The renderer fills
  // its slots in the order it is given them.
  return [...playerHeads, ...order.slice(0, SHADOWED_LAMPS).map((o) => o.i)];
}

export function lightsFor(pool: LightPool, arena: Race) {
  pool.clear();
  // By day there are no lamps: the floods, the headlights and the glows on
  // the lamp heads all go with the clock. The starting lights do not — they
  // are a signal, not an illumination, and a red light at noon still means
  // wait.
  const on = lampsOn(arena);
  if (on > 0) floods(pool, on);
  starter(pool, arena);
  if (on <= 0) return;

  // The rivals' headlamps were here. There are no rivals, and the ghost
  // carries no lamps: it is a recording of a truck and not a truck, and a
  // second set of headlights washing the road would light the mist you are
  // driving through with light from a car that is not there. What makes it
  // visible in the dark is a pair of cold marker glows — see `effectsFor`.

  const hurt = false;
  // The lamps are bolted to a body that pitches, rolls and leaves the ground,
  // so they are placed and aimed in its frame rather than on a plane at zero.
  // A headlight that stays level while the truck noses over a crest is a
  // headlight that has come loose.
  const car = arena.shown;
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
  playerHeads = [];
  for (const side of [-1, 1]) {
    playerHeads.push(pool.count);
    pool.add({
      position: at(LAMP_AHEAD, side * LAMP_ACROSS, LAMP_HEIGHT),
      radius: 2400,
      colour: hurt ? [1, 0.45, 0.4] : [1, 0.87, 0.62],
      // A lamp 84mm above the floor sees it almost edge-on: at 900mm out the
      // cosine between the floor's normal and the way back to the lamp is
      // 0.09, so nine tenths of the beam is thrown away by the geometry
      // before intensity is even considered. That is true of a real headlight
      // too, and a real headlight answers it by being very bright.
      intensity: 22 * on,
      direction: facing(Math.cos(side * 0.07), Math.sin(side * 0.07), -0.20),
      cone: [10, 25],
    });
  }

  // There was a small unconed light over the truck here, so that it was not
  // a silhouette in its own headlights. It read as a circle of light the
  // truck carried round with it — which under street lights, on a road they
  // light, it has no business doing — and the street lights do the job it
  // was there for now.

  // The exhaust and the brake lights were point lights here too — unconed,
  // 700 and 620 across — and with them gone the truck carries nothing round
  // with it but its headlights. An unconed light on a vehicle is a circle of
  // ground lit for no reason the scene can show, and it was the one thing in
  // the arena that looked like a game rather than a night. They are still
  // drawn: see `effectsFor`, where the exhaust and the brake lights are
  // glows, which is what a small hot lamp looks like from across a road.

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
  const t = arena.shown;
  const cy = Math.cos(t.yaw); const sy = Math.sin(t.yaw);
  const at = (lx: number, ly: number) => [t.x + lx * cy - ly * sy, t.y + lx * sy + ly * cy];
  if (arena.thrusting > 0) {
    const [ex, ey] = at(-180, 0);
    n = glow(out, n, vp, ex, ey, t.z - 10, 34 * arena.thrusting, 1.3 * arena.thrusting, [1, 0.6, 0.28], 2.2);
  }
  if (arena.braking > 0) {
    for (const side of [-1, 1]) {
      const [bx, by] = at(-168, side * 48);
      n = glow(out, n, vp, bx, by, t.z + 6, 22, 1.6 * arena.braking, [1, 0.15, 0.08], 2.6);
    }
  }
  /*
   * The head of every trackside post, as a point of light.
   *
   * A post is lit by its own flood from directly above and so is barely lit
   * at all: the outer row in particular stood as black poles against a black
   * arena, which is clutter rather than scenery. A lamp you can see is what
   * makes the post a lamp post, and a line of them running away round a
   * corner is the strongest thing in this scene for showing where the track
   * goes before you get there. They are glows and not lights: nothing is
   * being lit here, only seen, and a glow costs a screen-space quad against
   * a light's whole shading loop.
   */
  const on = lampsOn(arena);
  if (on > 0) {
    for (const post of COLUMNS) {
      const [hx, hy, hz] = lampAt(post);
      n = glow(out, n, vp, hx, hy, hz - 10, 46, 0.9 * on, [1, 0.93, 0.78], 2.0);
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

  // the truck's own lamps and brake lights, so they are bright points rather
  // than dark discs with light appearing in front of them
  {
    const v = arena.shown;
    const vcy = Math.cos(v.yaw), vsy = Math.sin(v.yaw);
    const put = (lx: number, ly: number) => [v.x + lx * vcy - ly * vsy, v.y + lx * vsy + ly * vcy];
    for (const side of [-1, 1]) {
      const [lx, ly] = put(LAMP_AHEAD + 6, side * LAMP_ACROSS);
      if (on > 0) n = glow(out, n, vp, lx, ly, v.z + LAMP_HEIGHT - 52, 24, 2.2 * on, [1, 0.9, 0.7], 2.8);
      if (arena.braking > 0) {
        const [bx2, by2] = put(-168, side * 48);
        n = glow(out, n, vp, bx2, by2, v.z + 6, 22, 1.6 * arena.braking, [1, 0.15, 0.08], 2.6);
      }
    }
  }

  /*
   * The ghost's markers.
   *
   * It carries no lights and lights nothing, so on an unlit stretch of road
   * it would be a pale shape in the dark and on a black one nothing at all —
   * and a reference you cannot find is not a reference. Two cold points on
   * its shoulders, always lit, day and night: enough to say where it is from
   * across the circuit, not enough to be mistaken for a car with its lamps
   * on. They are glows, so they cost a screen quad each and light nothing.
   */
  const past = arena.ghost.poseAt(arena.shownLapTime);
  if (past) {
    const gcy = Math.cos(past.yaw), gsy = Math.sin(past.yaw);
    // Four, at the corners of the body rather than two on the shoulders: two
    // points is a thing in the distance and four is a truck-shaped thing, and
    // which way the ghost is pointing as it goes into a corner is most of
    // what you want from it.
    for (const [lx, ly] of [[104, -58], [104, 58], [-104, -58], [-104, 58]]) {
      n = glow(out, n, vp,
        past.x + lx * gcy - ly * gsy, past.y + lx * gsy + ly * gcy, past.z + 62,
        40, 2.6, [0.42, 0.70, 1], 2.4);
    }
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
