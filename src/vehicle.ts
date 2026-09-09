/**
 * The truck, as a rigid body on four wheels.
 *
 * What was here before was a dot with a velocity and an exponential drag: it
 * turned on the spot, it could not be unsettled, and the floor was a number
 * it never consulted. This is the usual arrangement instead — a body with a
 * mass and an orientation, four suspension springs, and tyres that make
 * forces at the ground:
 *
 * 1. Cast a ray straight down from each wheel's mounting point and find the
 *    ground. Compression is how far the spring is squashed.
 * 2. Each contacting wheel pushes the body up along the ground's normal by
 *    its spring and damper. That force is also this wheel's share of the
 *    load, and so the size of the friction circle it has to spend.
 * 3. In that circle, each tyre spends what it can: killing whatever sideways
 *    velocity the contact patch has, driving or braking along its own facing.
 *    Ask for more than the circle and it slides, which is the whole of what
 *    makes a corner a corner.
 * 4. Everything is summed as force and as torque about the centre of mass, so
 *    the body dives under braking, leans in a corner, and pitches over a
 *    crest without any of those being written down anywhere.
 *
 * A wheel with no ground under it makes no force at all, so leaving a crest
 * fast is not a special case: the springs run out of travel, the wheels stop
 * pushing, and the only thing left acting on the body is gravity.
 *
 * Orientation is yaw, pitch and roll rather than a quaternion. The truck is
 * never upside down — pitch and roll are clamped well short of it — and three
 * numbers you can read in a debugger are worth more here than generality that
 * cannot be reached.
 *
 * Everything is in millimetres and seconds, and every mass is one: the forces
 * below are accelerations, and the inertias are the mass-normalised kind, so
 * a torque divided by one gives an angular acceleration directly.
 */
import { height, normal } from './terrain';

const G = 9810;                  // mm a second squared

/**
 * Where each wheel is mounted, in the body's own frame. Front pair first.
 *
 * Symmetric about the centre of mass on purpose. They were 88 ahead and 78
 * behind, matching where the wheels had been drawn, and that put the centre
 * of mass five millimetres nearer the rear — enough that the back springs
 * carried more, squashed further, and the truck sat seven degrees nose-up
 * doing nothing at all. Where the wheels are drawn is read from here, so
 * moving them moves both.
 */
export const WHEELS: [number, number, number][] = [
  [83, -64, -4], [83, 64, -4],
  [-83, -64, -4], [-83, 64, -4],
];
export const WHEEL_RADIUS = 31;
/** How far the wheel hangs below its mounting when nothing is pushing on it. */
const REST = 28;
const TRAVEL = 26;
/**
 * Spring rate, as body acceleration per millimetre of compression per wheel.
 * Four wheels at 13mm of squash hold the truck up against gravity:
 * 4 · 190 · 13 = 9880, which is where it sits at rest.
 */
const SPRING = 190;
const DAMPER = 16;

/** Grip, as a multiple of the load a tyre is carrying. */
const MU = 1.55;
/** How quickly a tyre tries to kill sideways slip, if it has the grip to. */
const LATERAL_TAU = 0.09;
const BRAKE_TAU = 0.11;
/** Below this much forward speed, the brake becomes reverse. */
const REVERSE_BELOW = 60;
/** How much of the engine reverse gets. Enough to get out of trouble, not to race. */
const REVERSE_POWER = 0.45;
const ROLL_RESIST = 0.06;
const ENGINE = 6900;             // total drive acceleration at full throttle
/**
 * Aerodynamic drag, and what actually sets the top speed: the engine and this
 * balance at about 2400 mm/s. That is well over the 2015 the ramps need, and
 * it has to be: crossing a ramp is paid for out of the same speed that clears
 * it, so a top speed merely equal to the threshold clears nothing. The cap
 * below is a guard against a physics blow-up rather than a speed limiter, and
 * is not reached in normal driving.
 */
const AERO = 1.1e-3;
export const MAX_SPEED = 2800;

/** Steering lock at a standstill, and how sharply it is wound off with speed. */
const STEER_LOCK = 0.52;
const STEER_FALLOFF = 430;
const STEER_RATE = 4.2;

/**
 * Mass-normalised inertia about each body axis, for a box 250 long, 128 wide
 * and 90 tall: (a² + b²)/12 over the two axes that are not the one turned
 * about. Roll is the small one, which is why a truck leans before it pitches.
 */
const I_ROLL = (128 * 128 + 90 * 90) / 12;
const I_PITCH = (250 * 250 + 90 * 90) / 12;
const I_YAW = (250 * 250 + 128 * 128) / 12;

/**
 * How much of the pitching couple from driving and braking is taken by the
 * suspension links rather than by the springs — anti-squat and anti-dive, and
 * a real car has a lot of it.
 *
 * Without it the model is honest and looks absurd: the drive force acts at
 * the contact patch, fifty millimetres below the centre of mass, and a truck
 * this short squats fifteen degrees under power. Cars do not, because their
 * wishbones stand the couple up through the chassis instead. This is that,
 * as one number: the longitudinal force still acts where it acts, but the
 * torque it makes is reckoned from a point most of the way up to the centre
 * of mass. What is left is the two or three degrees you want to see.
 */
const ANTI_SQUAT = 0.82;

/** How far pitch and roll may go. Well short of anywhere Euler angles bind. */
const TILT_LIMIT = 0.7;
/** Air resistance to tumbling, so a jump lands roughly the way it left. */
const AIR_SPIN_DAMP = 1.1;

/** What the driver is asking for. */
export interface Drive {
  /** -1 to 1: steering. Not a rate of turn — the front wheels point there. */
  steer: number;
  throttle: number;
  brake: number;
}

export interface Wheel {
  /** How far the spring is squashed, 0 to TRAVEL. */
  compression: number;
  onGround: boolean;
  /** Where the hub sits below its mounting point right now. */
  drop: number;
  /** Rolled distance, in radians. */
  spin: number;
  /** How far this wheel is steered. Zero on the rear pair. */
  steer: number;
  /** How much grip it is asking for beyond what it has, 0 when it is gripping. */
  slide: number;
  /** What this wheel is carrying, as body acceleration. Zero in the air. */
  load: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Vehicle {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = Math.PI / 2; pitch = 0; roll = 0;
  wYaw = 0; wPitch = 0; wRoll = 0;
  /** Where the steering is now, which lags where it is being asked to be. */
  steer = 0;
  throttle = 0; braking = 0;

  readonly wheels: Wheel[] = WHEELS.map(() => ({
    compression: 0, onGround: false, drop: REST, spin: 0, steer: 0, slide: 0, load: 0,
  }));

  constructor(x = 0, y = 0) { this.x = x; this.y = y; this.z = height(x, y) + 50; }

  /** Speed over the ground, ignoring how fast it is going up or down. */
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  get airborne(): boolean { return !this.wheels.some((w) => w.onGround); }
  /**
   * How hard the tyres are sliding, 0 to 1, for a skid to be drawn or heard.
   *
   * Weighted by what each tyre is carrying, and not the largest of the four.
   * A wheel that has gone light over a crest has almost no grip and so is
   * always asking for more than it has — taking the maximum meant the truck
   * reported a full slide most of the time it was driving in a straight line
   * over rough ground.
   */
  get slide(): number {
    let num = 0; let den = 0;
    for (const w of this.wheels) { num += w.slide * w.load; den += w.load; }
    return den > 1 ? num / den : 0;
  }

  /**
   * The springs are stiff enough that a sixtieth of a second is a coarse step
   * for them, so the whole thing is integrated in quarters. Four times the
   * work on a body that costs a few microseconds is not worth economising.
   */
  step(dt: number, drive: Drive) {
    const n = 4;
    for (let i = 0; i < n; i++) this.substep(dt / n, drive);
  }

  private substep(dt: number, drive: Drive) {
    const wanted = clamp(drive.steer, -1, 1) * (STEER_LOCK / (1 + this.speed / STEER_FALLOFF));
    this.steer += clamp(wanted - this.steer, -STEER_RATE * dt, STEER_RATE * dt);
    this.throttle = clamp(drive.throttle, 0, 1);
    this.braking = clamp(drive.brake, 0, 1);

    // the body's axes, from its three angles
    const cy = Math.cos(this.yaw); const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch); const sp = Math.sin(this.pitch);
    const cr = Math.cos(this.roll); const sr = Math.sin(this.roll);
    // R = Rz(yaw) · Ry(pitch) · Rx(roll), as three columns
    const fx = cy * cp, fy = sy * cp, fz = -sp;
    const rx = cy * sp * sr - sy * cr, ry = sy * sp * sr + cy * cr, rz = cp * sr;
    const ux = cy * sp * cr + sy * sr, uy = sy * sp * cr - cy * sr, uz = cp * cr;

    // The three axes the body's angles are measured about, in the world.
    // Roll runs along the heading and pitch across it, so both turn with yaw
    // — getting this wrong means a truck facing along +y answers a torque
    // that should pitch it by rolling instead, which is not subtle.
    const rollAxX = cy, rollAxY = sy;
    const pitchAxX = -sy, pitchAxY = cy;

    let ax = 0; let ay = 0; let az = -G;
    let tRoll = 0; let tPitch = 0; let tYaw = 0;

    for (let i = 0; i < WHEELS.length; i++) {
      const w = this.wheels[i];
      const [lx, ly, lz] = WHEELS[i];
      // where the spring is bolted to the body, in the world
      const mx = this.x + fx * lx + rx * ly + ux * lz;
      const my = this.y + fy * lx + ry * ly + uy * lz;
      const mz = this.z + fz * lx + rz * ly + uz * lz;

      // The ray. It goes straight down and the ground is a height field, so
      // where it lands is simply the height under it — no marching, no mesh.
      const gz = height(mx, my);
      const reach = REST + WHEEL_RADIUS;
      const gap = mz - gz;
      w.compression = clamp(reach - gap, 0, TRAVEL);
      w.onGround = w.compression > 0;
      w.drop = REST - w.compression;
      w.steer = i < 2 ? this.steer : 0;

      if (!w.onGround) { w.slide = 0; w.load = 0; continue; }

      const [nx, ny, nz] = normal(mx, my);

      // how fast this corner of the body is moving, body spin included
      const ox = mx - this.x, oy = my - this.y, oz = mz - this.z;
      // spin as one world vector, then v + omega x offset
      const wx = this.wRoll * rollAxX + this.wPitch * pitchAxX;
      const wy = this.wRoll * rollAxY + this.wPitch * pitchAxY;
      const wz = this.wYaw;
      const pvx = this.vx + wy * oz - wz * oy;
      const pvy = this.vy + wz * ox - wx * oz;
      const pvz = this.vz + wx * oy - wy * ox;

      // spring and damper, along the ground's normal
      const closing = -(pvx * nx + pvy * ny + pvz * nz);
      const load = Math.max(0, SPRING * w.compression + DAMPER * closing);
      w.load = load;

      // the tyre's own axes, laid flat on the ground it is touching
      const cs = Math.cos(w.steer); const ss = Math.sin(w.steer);
      let tfx = fx * cs + rx * ss, tfy = fy * cs + ry * ss, tfz = fz * cs + rz * ss;
      const along = tfx * nx + tfy * ny + tfz * nz;
      tfx -= nx * along; tfy -= ny * along; tfz -= nz * along;
      const flen = Math.hypot(tfx, tfy, tfz) || 1;
      tfx /= flen; tfy /= flen; tfz /= flen;
      // sideways is the normal crossed with forward, which is already flat
      const tsx = ny * tfz - nz * tfy;
      const tsy = nz * tfx - nx * tfz;
      const tsz = nx * tfy - ny * tfx;

      const vFwd = pvx * tfx + pvy * tfy + pvz * tfz;
      const vSide = pvx * tsx + pvy * tsy + pvz * tsz;

      const grip = MU * load;
      let wantSide = -vSide / LATERAL_TAU;
      let wantFwd = -vFwd * ROLL_RESIST;
      if (i >= 2) wantFwd += (this.throttle * ENGINE) / 2;   // rear wheel drive
      if (this.braking > 0) {
        // Brake, and then reverse once it has stopped. A car cannot steer
        // without moving, and this one is pushed straight back out of
        // whatever it hits — so without a reverse gear a truck wedged against
        // a post is wedged there for good. It was: a driver left running for
        // two minutes spent ninety seconds of it stationary against a post
        // with the throttle wide open.
        if (vFwd > REVERSE_BELOW) wantFwd += (-vFwd / BRAKE_TAU) * this.braking;
        else if (i >= 2) wantFwd -= (this.braking * ENGINE * REVERSE_POWER) / 2;
        else wantFwd += (-vFwd / BRAKE_TAU) * this.braking;
      }

      // the friction circle: a tyre has one budget and both jobs spend it
      const asked = Math.hypot(wantFwd, wantSide);
      w.slide = asked > grip ? Math.min(1, (asked - grip) / Math.max(grip, 1)) : 0;
      if (asked > grip && asked > 0) {
        const k = grip / asked;
        wantFwd *= k; wantSide *= k;
      }

      // the load and the sideways grip, which act at the contact patch
      const holdX = nx * load + tsx * wantSide;
      const holdY = ny * load + tsy * wantSide;
      const holdZ = nz * load + tsz * wantSide;
      // and the drive or brake, which acts there too but whose couple the
      // suspension links mostly stand up: see ANTI_SQUAT
      const pushX = tfx * wantFwd, pushY = tfy * wantFwd, pushZ = tfz * wantFwd;
      ax += holdX + pushX; ay += holdY + pushY; az += holdZ + pushZ;

      // as torques about the centre of mass, resolved onto the body's own
      // three axes rather than the world's
      const liftZ = oz * (1 - ANTI_SQUAT);
      const txWorld = (oy * holdZ - oz * holdY) + (oy * pushZ - liftZ * pushY);
      const tyWorld = (oz * holdX - ox * holdZ) + (liftZ * pushX - ox * pushZ);
      const tzWorld = (ox * holdY - oy * holdX) + (ox * pushY - oy * pushX);
      tRoll += (txWorld * rollAxX + tyWorld * rollAxY) / I_ROLL;
      tPitch += (txWorld * pitchAxX + tyWorld * pitchAxY) / I_PITCH;
      tYaw += tzWorld / I_YAW;

      // the wheel rolls by how far its contact patch travelled along itself
      w.spin += (vFwd * dt) / WHEEL_RADIUS;
    }

    // air resistance, which is what sets the top speed
    const sp3 = Math.hypot(this.vx, this.vy, this.vz);
    if (sp3 > 0) {
      const d = AERO * sp3;
      ax -= this.vx * d; ay -= this.vy * d; az -= this.vz * d;
    }

    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    const flat = this.speed;
    if (flat > MAX_SPEED) {
      this.vx *= MAX_SPEED / flat; this.vy *= MAX_SPEED / flat;
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    // Body rotation. Roll and pitch are the body answering its springs, so
    // they are damped hard on the ground and left alone in the air; yaw is
    // the tyres turning the truck and is barely damped at all.
    const air = this.airborne;
    this.wRoll = (this.wRoll + tRoll * dt) * Math.exp(-(air ? AIR_SPIN_DAMP : 2.6) * dt);
    this.wPitch = (this.wPitch + tPitch * dt) * Math.exp(-(air ? AIR_SPIN_DAMP : 2.6) * dt);
    this.wYaw = (this.wYaw + tYaw * dt) * Math.exp(-0.6 * dt);

    this.yaw += this.wYaw * dt;
    this.pitch = clamp(this.pitch + this.wPitch * dt, -TILT_LIMIT, TILT_LIMIT);
    this.roll = clamp(this.roll + this.wRoll * dt, -TILT_LIMIT, TILT_LIMIT);
    if (Math.abs(this.pitch) >= TILT_LIMIT) this.wPitch = 0;
    if (Math.abs(this.roll) >= TILT_LIMIT) this.wRoll = 0;

    // and a floor under the floor: never let the body itself go through the
    // ground, however hard it lands
    const floor = height(this.x, this.y) + 22;
    if (this.z < floor) { this.z = floor; if (this.vz < 0) this.vz *= -0.15; }
  }

  /** Put it back where it started, still. */
  reset(x: number, y: number, yaw: number) {
    this.x = x; this.y = y; this.z = height(x, y) + 50;
    this.vx = this.vy = this.vz = 0;
    this.yaw = yaw; this.pitch = this.roll = 0;
    this.wYaw = this.wPitch = this.wRoll = 0;
    this.steer = 0; this.throttle = 0; this.braking = 0;
    for (const w of this.wheels) {
      w.compression = 13; w.onGround = true; w.drop = REST - 13; w.slide = 0; w.load = G / 4;
    }
  }
}
