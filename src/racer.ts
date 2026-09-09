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
import { TRACK_HALF, radiusAt, where } from './track';
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

/** How near another car has to be, ahead, before this one moves over. */
const AVOID_RANGE = 620;
/** Below this, and pointed the wrong way, it backs up rather than pushing on. */
const STUCK_SPEED = 90;

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

  const tx = Math.cos(a) * (ra + line);
  const ty = Math.sin(a) * (ra + line);
  let d = Math.atan2(ty - car.y, tx - car.x) - car.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;

  // Stopped and pointing the wrong way: back up and turn out of it. A car
  // cannot steer without moving and is pushed straight out of whatever it
  // hits, so without this one bad corner ends its race where it happened.
  if (car.speed < STUCK_SPEED && Math.abs(d) > 1.1) {
    return { steer: -Math.sign(d), throttle: 0, brake: 1 };
  }

  const tight = Math.abs(d) > skill.caution;
  return {
    steer: Math.max(-1, Math.min(1, d * 2.6)),
    throttle: tight ? 0.3 : skill.pace,
    brake: tight && car.speed > 900 ? 0.9 : 0,
  };
}
