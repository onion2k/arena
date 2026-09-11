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
 * The steering is the rivals' driver from before the ghost replaced them,
 * given the vehicle's own geometry instead of the technical's constants: it
 * aims at the centreline some way up the road, moved out by the sagitta of
 * the chord it drives, and asks for the yaw rate that heading error wants
 * rather than a wheel angle. The pedals are new. The rivals lifted by feel
 * and never braked; this reads the plan at where it is about to be.
 */
import type { Input } from './game';
import { SETTINGS } from './settings';
import { TRACK_HALF, centreline, curveOutward, radiusAt, where } from './track';
import { wheelbaseOf, type Vehicle, type VehicleSpec } from './vehicle';

/** How hard it converges on the heading it wants, as a yaw rate per radian. */
const HEADING_GAIN = 3.0;
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
  constructor(readonly spec: VehicleSpec, readonly plan: ArrayLike<number>) {}

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
    // further up the road the faster it goes, which stops it sawing at the
    // wheel on a straight
    const ahead = (900 + car.speed * 0.42) / Math.max(r, 500);
    const a = theta + ahead;
    const ra = radiusAt(a);

    // back toward the middle, hard, when it is off the road
    const off = where(car.x, car.y).offset;
    const line = Math.abs(off) > TRACK_HALF * 0.8 ? -Math.sign(off) * TRACK_HALF * 0.3 : 0;

    // the centreline that far ahead, moved out by the sagitta of the chord,
    // or it passes inside every corner
    const [ox, oy, bendR] = curveOutward(a, 420);
    const chord = Math.hypot(Math.cos(a) * ra - car.x, Math.sin(a) * ra - car.y);
    const sag = Math.min((chord * chord) / (8 * bendR), TRACK_HALF * 0.8);
    const [px, py] = centreline(a);
    const tx = px + Math.cos(a) * line + ox * sag;
    const ty = py + Math.sin(a) * line + oy * sag;
    let d = Math.atan2(ty - car.y, tx - car.x) - car.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

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
    return { turn: this.steerFor(car, d), throttle, brake };
  }

  /**
   * The input that gives the yaw rate this heading error wants: a road wheel
   * angle of atan(wheelbase · ω / v) turns at ω, scaled back up by the
   * falloff the vehicle applies to its lock, less a share of the yaw it
   * already has.
   */
  private steerFor(car: Vehicle, headingError: number): number {
    const spec = this.spec;
    const wanted = clamp(headingError * HEADING_GAIN, -YAW_LIMIT, YAW_LIMIT);
    const v = Math.max(car.speed, 220);
    const delta = Math.atan((wheelbaseOf(spec) * wanted) / v);
    const lock = spec.steering.lock * SETTINGS.steering;
    const input = (delta * (1 + v / spec.steering.falloff)) / lock;
    return clamp(input - YAW_DAMP * (car.wYaw - wanted), -1, 1);
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
