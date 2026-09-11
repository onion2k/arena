/**
 * A driver that does as it is told: round the circuit as fast as a speed plan
 * allows, and no faster.
 *
 * This is how a class's rating is measured (`calibrate.ts`). A rating is the
 * three numbers `rateTrack` plans a lap from — how fast a corner can be taken
 * for its radius, how hard the car can brake, how hard it can accelerate —
 * and the honest test of a rating is whether a car can actually be driven to
 * it. So the pilot is handed a plan built from a rating and drives to it: if
 * it stays on the tarmac lap after lap the rating is one the car can hold,
 * and if it does not, it is not.
 *
 * It steers by asking for a yaw rate, converted to a wheel angle through the
 * vehicle's own wheelbase and lock: the rate the road's bend a tenth of a
 * second ahead needs at this speed, plus a share of the error between the car's
 * heading and the road's, plus a turn back toward the middle for however far
 * off it the car is. That is a path follower. It was the rivals' old driver,
 * which aimed at the centreline two metres up the road and allowed for the
 * arc by the sagitta of the chord — capped at 300mm, so in a tight corner
 * taken fast it could not allow enough and cut across the inside, 400 to
 * 500mm of it, into the apex drums. On #4, #10 and #12 that was a fifth of
 * every lap off the road and three classes that did not finish. The pedals
 * read the plan where the car is about to be.
 */
import type { Input } from './game';
import { SETTINGS } from './settings';
import { centreline, curveRadius, radiusAt, tangentAt, where } from './track';
import { wheelbaseOf, type Vehicle, type VehicleSpec } from './vehicle';

/** The span a bend's curvature is read over. */
const CURVE_SPAN = 200;
/** Keeps the cross-track correction from growing without limit at a crawl. */
const CROSS_SOFT = 300;

/** How it steers: see `drive`. */
export interface PilotTune {
  /** Seconds ahead it reads the road's direction and bend. */
  preview: number;
  /** Yaw rate asked for per radian of heading error. */
  heading: number;
  /** How hard it steers back toward the middle, per millimetre off it. */
  cross: number;
}
/**
 * Swept on seven circuits in every class, #4, #10 and #12 among them: a
 * shorter preview is steadier, and 0.25s of it is unstable outright — 29% of
 * the time off the road; a harder heading gain holds the line and laps
 * quicker. At these, the time off the tarmac is 0.0% to a brisk plan and
 * 0.3% to a reckless one, with every lap finished.
 */
export const PILOT_TUNE: PilotTune = { preview: 0.1, heading: 4.5, cross: 2.5 };
/** The most yaw it will ask for, which is what stops a spin at speed. */
const YAW_LIMIT = 2.4;
/** How much of its own yaw rate it subtracts back off, which damps the weave. */
const YAW_DAMP = 0.22;
/** Below this, and going nowhere for a while, it backs out of whatever it is in. */
const STUCK_SPEED = 90;
const STUCK_SECONDS = 0.9;
/** How long it backs out for once it has decided to. */
const REVERSE_SECONDS = 0.8;
/**
 * How far ahead it reads the plan, in seconds at its current speed: the
 * steering and the brakes both lag what is asked of them, and a pilot that
 * starts braking where the plan says it must is a pilot that is late.
 */
const PLAN_LEAD = 0.12;

export class Pilot {
  private stuck = 0;
  private reversing = 0;

  /**
   * `plan` is a target speed at each of its steps round the lap, from the
   * line (angle -π) anticlockwise — `speedPlan` in `track.ts`.
   */
  constructor(readonly spec: VehicleSpec, readonly plan: ArrayLike<number>, readonly tune: PilotTune = PILOT_TUNE) {}

  /** The target speed at an angle round the circuit. */
  private planned(theta: number): number {
    const n = this.plan.length;
    const u = (((theta + Math.PI) / (Math.PI * 2)) % 1 + 1) % 1;
    // plan[i] is the speed at step i + 1
    const i = (Math.floor(u * n) - 1 + n) % n;
    return this.plan[i];
  }

  drive(car: Vehicle, dt: number): Input {
    const theta = Math.atan2(car.y, car.x);
    const r = radiusAt(theta);
    const v = Math.max(car.speed, 220);
    const t = this.tune;

    // The road a little way ahead: which way it runs, and how hard it turns.
    // Close, not far — this is feed-forward for the steering's own lag, not
    // a point to aim at.
    const ahead = theta + (v * t.preview) / Math.max(r, 500);
    const [tx, ty] = tangentAt(ahead);
    const bend = signedCurvature(ahead);
    // How far off the middle, positive outside, which on a loop driven
    // anticlockwise is to the right: steer back left by an angle that
    // shrinks as the speed grows, so a correction at speed is gentle.
    const off = where(car.x, car.y).offset;
    const back = Math.atan2(t.cross * off, v + CROSS_SOFT);
    let d = Math.atan2(ty, tx) + back - car.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const wanted = v * bend + t.heading * d;

    // Stopped, or pointing the wrong way: back out, and keep backing out for
    // a moment. The rivals' version reversed only while it was slow, so it
    // backed off a post by a car's width, was no longer slow, and drove
    // straight back into it — for the rest of the race.
    if (this.reversing > 0) {
      this.reversing -= dt;
      return { turn: -Math.sign(d) || 1, throttle: 0, brake: 1 };
    }
    this.stuck = car.speed < STUCK_SPEED ? this.stuck + dt : 0;
    if (car.speed < STUCK_SPEED && (Math.abs(d) > 1.1 || this.stuck > STUCK_SECONDS)) {
      this.stuck = 0;
      this.reversing = REVERSE_SECONDS;
      return { turn: -Math.sign(d) || 1, throttle: 0, brake: 1 };
    }

    const target = this.planned(theta + (car.speed * PLAN_LEAD) / Math.max(r, 500));
    let throttle = 1, brake = 0;
    if (car.speed > target * 1.03) { throttle = 0; brake = clamp((car.speed / target - 1) * 6, 0.2, 1); }
    else if (car.speed > target) { throttle = 0.3; }
    return { turn: this.steerFor(car, wanted), throttle, brake };
  }

  /**
   * The input that gives a yaw rate: a road wheel angle of
   * atan(wheelbase · ω / v) turns at ω, scaled back up by the falloff the
   * vehicle applies to its lock, less a share of the yaw it already has.
   */
  private steerFor(car: Vehicle, yawRate: number): number {
    const spec = this.spec;
    const wanted = clamp(yawRate, -YAW_LIMIT, YAW_LIMIT);
    const v = Math.max(car.speed, 220);
    const delta = Math.atan((wheelbaseOf(spec) * wanted) / v);
    const lock = spec.steering.lock * SETTINGS.steering;
    const input = (delta * (1 + v / spec.steering.falloff)) / lock;
    return clamp(input - YAW_DAMP * (car.wYaw - wanted), -1, 1);
  }
}

/** How hard the road turns at an angle, per millimetre: positive to the
 *  left of travel, which is most of an anticlockwise loop. */
function signedCurvature(theta: number): number {
  const d = CURVE_SPAN / Math.max(radiusAt(theta), 200);
  const a = centreline(theta - d), b = centreline(theta), c = centreline(theta + d);
  const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return Math.sign(turn) / curveRadius(theta, CURVE_SPAN);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
