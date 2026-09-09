/**
 * A driver for a car that is not yours.
 *
 * It follows the centreline offset by its own preferred line, looks further
 * up the road the faster it is going, and lifts and brakes for whatever it
 * cannot steer round. That is the whole of it: no racing line solved in
 * advance, no lap of practice, no memory of the corner it is in.
 *
 * The alternative — a precomputed ideal line with speeds for each corner —
 * is what a serious racing game does and would drive better than this. It
 * would also be a second description of the track, and would need redoing
 * every time the circuit changed. This reads the same centreline the lap
 * counter does.
 *
 * The line-follower that tested the track for months is the same code. Its
 * numbers were tuned to get round at all; these are tuned to be beatable.
 */
import { TRACK_HALF, centreline, curveOutward, curveRadius, radiusAt, where } from './track';
import { MU, STEER_FALLOFF, STEER_LOCK, WHEELBASE } from './vehicle';
import type { Drive } from './vehicle';
import type { Vehicle } from './vehicle';

export interface Skill {
  /** How far off the middle of the road it likes to sit, in millimetres. */
  line: number;
  /** How much of the throttle it will use on a straight, 0 to 1. */
  pace: number;
  /** How early it lifts for a corner. Larger is more cautious. */
  caution: number;
  /** How far up the road it looks, before speed is taken into account. */
  look: number;
}

/** What the leaders and the tail of the field drive like. */
export const SKILLS: Skill[] = [
  { line: -90, pace: 0.98, caution: 0.26, look: 980 },
  { line: 110, pace: 0.93, caution: 0.30, look: 900 },
  { line: -30, pace: 0.88, caution: 0.34, look: 860 },
  { line: 150, pace: 0.84, caution: 0.38, look: 820 },
];

/**
 * How much of the tyres' grip a driver will use in a corner. Less than all of
 * it, because a driver that plans to arrive at exactly the limit arrives over
 * it whenever the ground is not flat, and this ground is not flat.
 */
const CORNER_GRIP = 0.62;
/** Gravity, for turning a corner radius into a speed. */
const G = 9810;
/** How hard it converges on the heading it wants, as a yaw rate per radian. */
const HEADING_GAIN = 3.0;
/** The most yaw it will ask for, which is what stops a spin at speed. */
const YAW_LIMIT = 2.4;
/** How much of its own yaw rate it subtracts back off, which damps the weave. */
const YAW_DAMP = 0.22;

/** How near another car has to be, ahead, before this one moves over. */
const AVOID_RANGE = 620;
/** Below this, and pointed the wrong way, it backs up rather than pushing on. */
const STUCK_SPEED = 90;
/**
 * How long a driver will sit at a standstill before reversing whatever
 * direction it is pointing.
 *
 * The old rule only backed up when it was pointing more than 63 degrees off
 * the road, on the reasoning that a car facing the right way can just drive
 * out. That was true when the tyres had 2.15g and the grass gripped as well
 * as the tarmac; it is not true now, and a car wedged square against a post
 * sat with the throttle wide open for the rest of the race. One of four did
 * exactly that and finished with no laps at all.
 */
const STUCK_SECONDS = 0.9;
/** How long each driver has been going nowhere. Keyed on the car itself so
 *  that `driveRound` stays a function of the world and not of a class. */
const stuckFor = new WeakMap<Vehicle, number>();

export function driveRound(car: Vehicle, skill: Skill, others: Vehicle[]): Drive {
  const theta = Math.atan2(car.y, car.x);
  const r = radiusAt(theta);
  // look further ahead the faster it is going, which is what stops it sawing
  // at the wheel on a straight and running wide into everything else
  const ahead = (skill.look + car.speed * 0.42) / Math.max(r, 500);
  const a = theta + ahead;
  const ra = radiusAt(a);

  // Its own line — but pulled back toward the middle when it is off the
  // road, and hard. Without this a driver that ran wide kept its preferred
  // offset, which off the tarmac points further off it, and ended the race
  // beached against a post on the inside.
  const off = where(car.x, car.y).offset;
  let line = skill.line;
  if (Math.abs(off) > TRACK_HALF * 0.8) line = -Math.sign(off) * TRACK_HALF * 0.3;
  for (const o of others) {
    if (o === car) continue;
    const dx = o.x - car.x, dy = o.y - car.y;
    const d = Math.hypot(dx, dy);
    if (d > AVOID_RANGE || d < 1e-3) continue;
    // only what is in front: something alongside is not in the way
    const infront = (dx * Math.cos(car.yaw) + dy * Math.sin(car.yaw)) / d;
    if (infront < 0.35) continue;
    // which side it is on, and go the other way, harder the closer it is
    const side = Math.sign(dx * -Math.sin(car.yaw) + dy * Math.cos(car.yaw)) || 1;
    line -= side * 220 * (1 - d / AVOID_RANGE);
  }

  // Aim at the centreline that far ahead, moved out to the outside of the
  // bend by the sagitta of the chord being driven — without which the driver
  // steers straight at a point on an arc and so passes inside it, which put
  // the fastest car in the field a fifth of its lap off the road on the inside
  // of every corner.
  const [ox, oy, bendR] = curveOutward(a, 420);
  const chord = Math.hypot(Math.cos(a) * ra - car.x, Math.sin(a) * ra - car.y);
  const sag = Math.min((chord * chord) / (8 * bendR), TRACK_HALF * 0.8);
  const [px, py] = centreline(a);
  const rx = Math.cos(a), ry = Math.sin(a);
  const tx = px + rx * line + ox * sag;
  const ty = py + ry * line + oy * sag;
  let d = Math.atan2(ty - car.y, tx - car.x) - car.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;

  // Stopped: back up and turn out of it. A car cannot steer without moving
  // and is pushed straight out of whatever it hits, so without this one bad
  // corner ends its race where it happened. Pointing the wrong way is reason
  // enough on its own; otherwise it is given a moment to drive out first.
  const stuck = (stuckFor.get(car) ?? 0) + (car.speed < STUCK_SPEED ? 1 / 60 : -0.25);
  stuckFor.set(car, Math.max(0, Math.min(3, stuck)));
  if (car.speed < STUCK_SPEED && (Math.abs(d) > 1.1 || stuck > STUCK_SECONDS)) {
    return { steer: -Math.sign(d) || 1, throttle: 0, brake: 1 };
  }

  return { steer: steerFor(car, d), ...pedals(car, theta, skill) };
}

/**
 * The steering input that would give the yaw rate this heading error wants.
 *
 * It used to be the heading error times 2.6, clamped — which was a gain
 * chosen when the truck's steering was wound off so hard with speed that
 * full lock at speed was 0.23 radians and could not spin anything. With the
 * lock the truck has now, that gain saturates at any error over 22 degrees
 * and puts full opposite lock on at 2000 mm/s: a field of four spun
 * thirty-seven times in a two-minute race and spent two thirds of it off the
 * road.
 *
 * So it asks for a yaw rate instead, and converts: a road wheel angle of
 * atan(wheelbase · omega / v) turns at omega, and the input that gives that
 * angle is it scaled back up by the falloff the truck applies. Then it
 * subtracts back a fraction of the yaw it already has, which is what stops it
 * hunting about the line it is trying to hold.
 */
function steerFor(car: Vehicle, headingError: number): number {
  const wanted = clamp(headingError * HEADING_GAIN, -YAW_LIMIT, YAW_LIMIT);
  const v = Math.max(car.speed, 220);
  const delta = Math.atan((WHEELBASE * wanted) / v);
  const input = (delta * (1 + v / STEER_FALLOFF)) / STEER_LOCK;
  return clamp(input - YAW_DAMP * (car.wYaw - wanted), -1, 1);
}

/**
 * Throttle and brake, from how tight the road is about to get.
 *
 * The old rule was to lift whenever the heading error was large, which is a
 * driver reacting to a corner it is already in. This one reads the radius of
 * the track ahead — far enough ahead to stop from here — works out what speed
 * the tyres will hold there, and brakes if it is going faster than that. It
 * is the difference between a car that scrubs round a corner and one that
 * arrives at it already slowed, and it is what makes an opponent something
 * you can out-brake rather than something you follow.
 */
function pedals(car: Vehicle, theta: number, skill: Skill): { throttle: number; brake: number } {
  // how far it can see, in track it could stop in from here
  const stopping = 260 + car.speed * 0.55 * skill.caution * 3;
  let limit = Infinity;
  for (const reach of [stopping * 0.45, stopping, stopping * 1.7]) {
    const at = theta + reach / Math.max(radiusAt(theta), 500);
    const r = curveRadius(at, 420);
    const v = Math.sqrt(CORNER_GRIP * MU * G * r);
    if (v < limit) limit = v;
  }
  limit *= skill.pace;
  if (car.speed > limit * 1.06) return { throttle: 0, brake: clamp((car.speed / limit - 1) * 3, 0.25, 1) };
  if (car.speed > limit * 0.97) return { throttle: 0.35, brake: 0 };
  return { throttle: skill.pace, brake: 0 };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
