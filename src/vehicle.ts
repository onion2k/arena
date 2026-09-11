/**
 * A vehicle, as a rigid body on four wheels.
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
 * Orientation is yaw, pitch and roll rather than a quaternion. The body is
 * never upside down — pitch and roll are clamped well short of it — and
 * three numbers you can read in a debugger are worth more here than
 * generality that cannot be reached.
 *
 * Everything is in millimetres and seconds, and every mass is one: the forces
 * below are accelerations, and the inertias are the mass-normalised kind, so
 * a torque divided by one gives an angular acceleration directly.
 *
 * Every number that used to be a module constant here is now a field on a
 * `VehicleSpec` (see `vehicles.ts`), so this file describes *how* a vehicle
 * behaves and a spec says *how much*. Nothing in the arithmetic below moved:
 * the technical's spec was built by copying out this file's old constants
 * one for one, checked afterward with a scripted lap against a recording
 * taken before the change.
 */
import { height, normal } from './terrain';
import { TRACK_LIFT, gripAt, type CornerRating } from './track';
import { WATER_DRAG, WATER_LEVEL } from './water';
import { SETTINGS } from './settings';
import type { Mesh } from 'artshape-render/mesh/types';

const G = 9810;                  // mm a second squared

/**
 * Where the body rests above the ground with nothing pushing on it, before
 * the springs have had a chance to settle it lower. Not part of the spec:
 * it is a spawn clearance and nothing a class would want to differ by, and
 * it is gone within the first few physics steps regardless.
 */
const SPAWN_CLEARANCE = 50;

/**
 * The longest a substep may be, in seconds.
 *
 * The body is integrated explicitly: a velocity is updated from the forces
 * on it, then the position from the velocity. A damper under that is only
 * stable while its rate times the step stays under two — past it, each step
 * overcorrects the last by more than it corrected, and the motion flips sign
 * every step and grows until something clamps it. The stiffest mode here is
 * roll, whose rate is `rollDamping` below: 136 a second for the technical,
 * 448 for the F1.
 *
 * The step used to be a quarter of the frame, whatever the frame took. The
 * technical never got near the limit, and the rally car, the prototype and
 * the F1 all passed it at a frame rate a real display runs at: the F1 at
 * sixty (448 × 1/240 is 1.87, and the springs take it over), the prototype
 * and the rally car at twenty, which the frame loop's own cap allows. What
 * that looks like is not a wobble. The whole load jumps from one side of
 * the car to the other and back every substep — two wheels carrying all of
 * it, two nothing, then the other way round — with the body flicking two
 * thousandths of a radian either side of level. Four substeps a frame is an
 * even count, so every frame lands on the same side and shows a car sitting
 * level on two wheels whose tyres are sliding; an F1 flat out on the flat
 * tops out at 2275 instead of 3183. The bench took it for a slow
 * pitch-and-heave mode of the suspension.
 *
 * A 480th keeps the F1's roll at 0.93 — half the limit — and the game steps
 * the race at a 120th (`STEP` in `game.ts`), so this is four substeps a
 * step, which is what a quarter of the frame always was on a 120Hz display.
 * `rollDamping` is checked against it for every class in the tests, so a
 * stiffer class arrives with a failing test rather than a car on two wheels.
 */
export const SUBSTEP = 1 / 480;

/**
 * How fast the roll dampers kill a roll rate, per second: four dampers, each
 * pushing at its wheel's distance across the body and resisting a speed that
 * grows with that same distance, over the body's inertia in roll.
 */
export function rollDamping(spec: VehicleSpec): number {
  const { width: w, height: h } = spec.body;
  const iRoll = ((w * w + h * h) / 12) * spec.inertia.gyration;
  const arm = spec.wheels.reduce((s, [, ly]) => s + ly * ly, 0);
  return (spec.suspension.damper * arm) / iRoll;
}

/** A class's wheelbase, from its own wheel layout. */
export function wheelbaseOf(spec: VehicleSpec): number {
  return spec.wheels[0][0] - spec.wheels[2][0];
}

/** Everything a vehicle class chooses. See the field comments in the old
 *  vehicle.ts (kept as the numbers' documentation) for why each is what it
 *  is; a spec is measurements, not opinions written twice. */
export interface VehicleSpec {
  key: string;
  label: string;

  body: { length: number; width: number; height: number };
  /** Mounting points in the body's own frame, front pair first. */
  wheels: [number, number, number][];
  wheelRadius: number;

  suspension: { rest: number; travel: number; spring: number; damper: number; antiRoll: number };
  tyres: { mu: number; rearGrip: number; lateralTau: number; brakeTau: number; rollResist: number; roughDrag: number };
  brakes: { max: number; reverseBelow: number; reversePower: number };
  /** `driveFront` is 0 for rear drive, 1 for front, 0.5 for a 50/50 split. */
  engine: { power: number; topSpeed: number; driveFront: number };
  handbrake: { grip: number; tau: number; max: number; fade: [number, number] };
  drift: {
    grip: number; from: number; full: number; keep: number;
    hold: number; ease: number; holdOn: number; angle: number; relief: number;
    gain: number; torque: number; damp: number;
  };
  steering: { lock: number; falloff: number; rate: number };
  inertia: { gyration: number; antiSquat: number; tiltLimit: number; airSpinDamp: number };
  /** A guard against a blow-up, well above anything the drag will allow. */
  maxSpeed: number;

  /** The collision circle `game.ts` keeps other things off. */
  radius: number;
  /**
   * The tightest circle it drives, radius in millimetres: full lock at a
   * crawl, measured by `turnCircle` in `bench.ts` and held to it by a test.
   * The track-select screen says so when a circuit has a corner tighter.
   */
  turnCircle: number;
  /** Measured cornering, acceleration and braking numbers for `rateTrack` —
   *  see `bench.ts`. Not derived: the file that reads them explains why. */
  rating: CornerRating;

  kit: VehicleKit;
}

/** One visible part, placed once in the body's frame. */
export interface VehiclePart {
  mesh: () => Mesh;
  at: [number, number, number];
  albedo: [number, number, number];
  roughness: number;
}

/**
 * What a class looks like: a painted body — the thing `PAINT` tints — and
 * one unpainted detail part, plus the wheel and the headlamp. Every class
 * shares this shape rather than an open list of parts: the arena draws
 * exactly two vehicle-shaped dynamic groups regardless of which class is in
 * them, so changing class is a mesh swap and not a change to how many
 * buffers exist or how big they are.
 */
export interface VehicleKit {
  body: () => Mesh;
  detail: VehiclePart;
  wheel: () => Mesh;
  lamp: () => Mesh;
}

/** What the driver is asking for. */
export interface Drive {
  /** -1 to 1: steering. Not a rate of turn — the front wheels point there. */
  steer: number;
  throttle: number;
  brake: number;
  /**
   * Stand still, whatever the ground is doing. A handbrake and not the brake
   * pedal: the pedal turns into reverse once the vehicle has stopped, which
   * is what gets it out from against a post and is exactly wrong for holding
   * it on the line — held that way it reversed away from the start at over a
   * metre a second.
   */
  hold?: boolean;
  /**
   * Lock the rear wheels and take most of their sideways grip: a slide you
   * asked for. Unlike `hold` this is a thing you do while moving fast.
   */
  handbrake?: boolean;
}

export interface Wheel {
  /** How far the spring is squashed, 0 to `suspension.travel`. */
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
  /** The height of the ground under it, as last found by the ray. */
  ground: number;
  /** Whether that ground — or the road drawn over it — is under the water. */
  wet: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Vehicle {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = Math.PI / 2; pitch = 0; roll = 0;
  wYaw = 0; wPitch = 0; wRoll = 0;
  /** Where the steering is now, which lags where it is being asked to be. */
  steer = 0;
  /** How much of the drift is on, 0 to 1: brake and steering together, at speed. */
  drift = 0;
  /**
   * Whether a drift is in progress, which outlives `drift` itself: the slip
   * fade takes the strength to nothing past sixty degrees, and if that also
   * ended the drift the hold could never come back once the angle did. It
   * did, for one build — every tap was a flick and then plain cornering.
   */
  private drifting = false;
  throttle = 0; braking = 0;

  readonly spec: VehicleSpec;
  readonly wheels: Wheel[];
  /** Mass-normalised inertia about each body axis, from the spec's own body
   *  box: (a² + b²)/12 over the two axes that are not the one turned about,
   *  times a gyration factor because a vehicle's mass is at its corners and
   *  not spread evenly through the middle. See the spec for the numbers. */
  private readonly iRoll: number;
  private readonly iPitch: number;
  private readonly iYaw: number;

  constructor(spec: VehicleSpec, x = 0, y = 0) {
    this.spec = spec;
    this.wheels = spec.wheels.map(() => ({
      compression: 0, onGround: false, drop: spec.suspension.rest, spin: 0, steer: 0, slide: 0, load: 0, ground: 0, wet: false,
    }));
    const { length: l, width: w, height: h } = spec.body;
    const k = spec.inertia.gyration;
    this.iRoll = ((w * w + h * h) / 12) * k;
    this.iPitch = ((l * l + h * h) / 12) * k;
    this.iYaw = ((l * l + w * w) / 12) * k;
    this.x = x; this.y = y; this.z = height(x, y) + SPAWN_CLEARANCE;
  }

  /** Speed over the ground, ignoring how fast it is going up or down. */
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  get airborne(): boolean { return !this.wheels.some((w) => w.onGround); }
  /**
   * How hard the tyres are sliding, 0 to 1, for a skid to be drawn or heard.
   *
   * Weighted by what each tyre is carrying, and not the largest of the four.
   * A wheel that has gone light over a crest has almost no grip and so is
   * always asking for more than it has — taking the maximum meant the
   * vehicle reported a full slide most of the time it was driving in a
   * straight line over rough ground.
   */
  get slide(): number {
    let num = 0; let den = 0;
    for (const w of this.wheels) { num += w.slide * w.load; den += w.load; }
    return den > 1 ? num / den : 0;
  }

  /** The lock in force: the spec's own, scaled by the steering setting. */
  private steerLock(): number { return this.spec.steering.lock * SETTINGS.steering; }

  /**
   * Drag, chosen so the engine and it balance at the class's own top speed
   * (scaled by the pace setting): v² · aero = power at that speed, so
   * aero = power / v². The cap below is a guard against a physics blow-up
   * rather than a speed limiter, and is not reached in normal driving.
   */
  private aero(): number {
    const v = Math.max(300, this.spec.engine.topSpeed * SETTINGS.pace);
    return this.spec.engine.power / (v * v);
  }

  /**
   * The springs are stiff enough that a frame is a coarse step for them, so
   * the whole thing is integrated in substeps of at most `SUBSTEP`. It was
   * quarters of whatever `dt` was, which is only as fine as the frame rate
   * makes it — see `SUBSTEP` for what that cost.
   */
  step(dt: number, drive: Drive) {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-6));
    for (let i = 0; i < n; i++) this.substep(dt / n, drive);
  }

  private substep(dt: number, drive: Drive) {
    const spec = this.spec;
    const WHEELS = spec.wheels;
    // the fronts, let off in a drift: see drift.relief
    const wanted = clamp(drive.steer, -1, 1) * (this.steerLock() / (1 + this.speed / spec.steering.falloff)) * (1 - spec.drift.relief * this.drift);
    this.steer += clamp(wanted - this.steer, -spec.steering.rate * dt, spec.steering.rate * dt);
    this.throttle = drive.hold ? 0 : clamp(drive.throttle, 0, 1);
    if (drive.handbrake) this.throttle = 0;
    this.braking = drive.hold ? 1 : clamp(drive.brake, 0, 1);

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
    // — getting this wrong means a body facing along +y answers a torque
    // that should pitch it by rolling instead, which is not subtle.
    const rollAxX = cy, rollAxY = sy;
    const pitchAxX = -sy, pitchAxY = cy;

    // How far the body is already sideways, and how much of anything that
    // takes the rear's grip away should still be doing so: all of it until
    // it is properly sideways, then none. See `handbrake.fade`.
    let slip = 0;
    if (this.speed > 120) {
      slip = Math.atan2(this.vy, this.vx) - this.yaw;
      while (slip > Math.PI) slip -= Math.PI * 2;
      while (slip < -Math.PI) slip += Math.PI * 2;
    }
    const [full, none] = spec.handbrake.fade;
    const fade = 1 - clamp((Math.abs(slip) - full) / (none - full), 0, 1);
    const hand = drive.handbrake ? fade : 0;
    // And the drift: started by brake and steering together above a speed,
    // held by slip and steering together, faded the same way as the
    // handbrake so it sets an angle rather than starting a spin.
    let want = 0;
    if (drive.handbrake || drive.hold) this.drifting = false;
    if (!drive.handbrake && !drive.hold) {
      const gate = clamp((this.speed - spec.drift.from) / (spec.drift.full - spec.drift.from), 0, 1);
      const keep = clamp((this.speed - spec.drift.keep) / (spec.drift.from - spec.drift.keep), 0, 1);
      const steering = clamp(Math.abs(drive.steer), 0, 1);
      const start = this.braking * steering * gate;
      // A tap starts it; centring the wheel or slowing right down ends it,
      // and nothing else does. A release on the body straightening up was
      // tried and fired in the dip after the flick's overshoot, when the
      // angle passes through eight degrees on its way back to being held.
      if (start > spec.drift.holdOn) this.drifting = true;
      if (steering < 0.3 || keep <= 0) this.drifting = false;
      const hold = this.drifting ? spec.drift.hold * keep : 0;
      want = fade * Math.max(start, hold);
    }
    this.drift += (want - this.drift) * Math.min(1, spec.drift.ease * dt);
    const drift = this.drift;

    let ax = 0; let ay = 0; let az = -G;
    let tRoll = 0; let tPitch = 0; let tYaw = 0;

    // Where the ground is under each wheel, before any force is worked out:
    // an anti-roll bar needs both wheels of an axle at once, so compression
    // has to be known for all four before any load is.
    for (let i = 0; i < WHEELS.length; i++) {
      const w = this.wheels[i];
      const [lx, ly, lz] = WHEELS[i];
      const mz = this.z + fz * lx + rz * ly + uz * lz;
      const mx = this.x + fx * lx + rx * ly + ux * lz;
      const my = this.y + fy * lx + ry * ly + uy * lz;
      w.ground = height(mx, my);
      w.compression = clamp(spec.suspension.rest + spec.wheelRadius - (mz - w.ground), 0, spec.suspension.travel);
      w.onGround = w.compression > 0;
      w.drop = spec.suspension.rest - w.compression;
      w.steer = i < 2 ? this.steer : 0;
    }
    // load moved across each axle, toward whichever side is squashed more
    const bar = [
      spec.suspension.antiRoll * (this.wheels[0].compression - this.wheels[1].compression),
      spec.suspension.antiRoll * (this.wheels[2].compression - this.wheels[3].compression),
    ];

    for (let i = 0; i < WHEELS.length; i++) {
      const w = this.wheels[i];
      const [lx, ly, lz] = WHEELS[i];
      // where the spring is bolted to the body, in the world
      const mx = this.x + fx * lx + rx * ly + ux * lz;
      const my = this.y + fy * lx + ry * ly + uy * lz;
      const mz = this.z + fz * lx + rz * ly + uz * lz;

      if (!w.onGround) { w.slide = 0; w.load = 0; w.wet = false; continue; }

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
      // The ray found the ground in the pass above; this is what the spring
      // and the damper make of it, plus whatever the anti-roll bar is moving
      // across this axle.
      const roll = (i % 2 === 0 ? 1 : -1) * bar[i < 2 ? 0 : 1];
      const load = Math.max(0, spec.suspension.spring * w.compression + spec.suspension.damper * closing + roll);
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

      // What the surface gives back, which is the tarmac's grip on the tarmac
      // and falls away over a shoulder either side of it.
      const rear = i >= 2;
      const surface = gripAt(mx, my);
      let grip = spec.tyres.mu * load * surface * (rear ? spec.tyres.rearGrip : 1);
      if (hand > 0 && rear) grip *= 1 - (1 - spec.handbrake.grip) * hand;
      if (drift > 0 && rear) grip *= 1 - (1 - spec.drift.grip) * drift;
      let wantSide = -vSide / spec.tyres.lateralTau;
      // Rolling resistance, more off the tarmac, and more again with the
      // wheel in the water: a ford is felt, not just seen. The wheel rides
      // the terrain and the tarmac is drawn 22mm above it, so on the road
      // the surface the water is measured against is the road's — without
      // that the vehicle was wet for a sixth of every lap, on ground that was
      // dry to look at.
      const surfaceZ = w.ground + (surface >= 1 ? TRACK_LIFT : 0);
      w.wet = surfaceZ < WATER_LEVEL;
      let wantFwd = -vFwd * (spec.tyres.rollResist + spec.tyres.roughDrag * (1 - surface) + (w.wet ? WATER_DRAG : 0));
      if (drive.hold) {
        // uncapped, unlike the brake pedal: a handbrake locks the wheels and
        // is limited by the tyres rather than by the brakes, which is what
        // makes it hold on a slope instead of creeping down one
        wantFwd += -vFwd / 0.03;
      }
      // Drive, split between the axles by `engine.driveFront`: 0 is all rear,
      // 1 all front, 0.5 an even split. A rear-drive vehicle here reproduces
      // the plain `rear && …` of the single-truck version exactly, since
      // `driveHere` is 1 on the rear axle and 0 on the front.
      const driveHere = rear ? 1 - spec.engine.driveFront : spec.engine.driveFront;
      if (!drive.hold && driveHere > 0) wantFwd += (this.throttle * spec.engine.power * driveHere) / 2;
      // the handbrake locks the back wheels, and a locked wheel is spending
      // its whole circle on stopping and has none left to hold the line with
      if (hand > 0 && rear) {
        wantFwd += clamp(-vFwd / spec.handbrake.tau, -spec.handbrake.max, spec.handbrake.max) * hand;
      }
      if (this.braking > 0 && !drive.hold) {
        // Brake, and then reverse once it has stopped. A vehicle cannot
        // steer without moving, and this one is pushed straight back out of
        // whatever it hits — so without a reverse gear one wedged against a
        // post is wedged there for good.
        const stop = clamp(-vFwd / spec.tyres.brakeTau, -spec.brakes.max / 4, spec.brakes.max / 4) * this.braking;
        if (vFwd > spec.brakes.reverseBelow) wantFwd += stop;
        else if (driveHere > 0) wantFwd -= (this.braking * spec.engine.power * spec.brakes.reversePower * driveHere) / 2;
        else wantFwd += stop;
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
      // suspension links mostly stand up: see `inertia.antiSquat`
      const pushX = tfx * wantFwd, pushY = tfy * wantFwd, pushZ = tfz * wantFwd;
      ax += holdX + pushX; ay += holdY + pushY; az += holdZ + pushZ;

      // as torques about the centre of mass, resolved onto the body's own
      // three axes rather than the world's
      const liftZ = oz * (1 - spec.inertia.antiSquat);
      const txWorld = (oy * holdZ - oz * holdY) + (oy * pushZ - liftZ * pushY);
      const tyWorld = (oz * holdX - ox * holdZ) + (liftZ * pushX - ox * pushZ);
      const tzWorld = (ox * holdY - oy * holdX) + (ox * pushY - oy * pushX);
      tRoll += (txWorld * rollAxX + tyWorld * rollAxY) / this.iRoll;
      tPitch += (txWorld * pitchAxX + tyWorld * pitchAxY) / this.iPitch;
      tYaw += tzWorld / this.iYaw;

      // the wheel rolls by how far its contact patch travelled along itself
      w.spin += (vFwd * dt) / spec.wheelRadius;
    }

    // The drift's servo. Slip is the way the body is going less the way it
    // is pointing, so in a left turn (positive steer) a body rotating past
    // its velocity has a negative slip: the slip in the turn's own direction
    // is -slip times the steer's sign, and the torque closes the gap to the
    // angle the steering asks for.
    if (drift > 0) {
      const steerIn = clamp(drive.steer, -1, 1);
      const sign = steerIn < 0 ? -1 : 1;
      const target = spec.drift.angle * Math.abs(steerIn);
      const turned = -slip * sign;
      const servo = clamp(spec.drift.gain * (target - turned), -spec.drift.torque, spec.drift.torque) * sign;
      tYaw += drift * (servo - spec.drift.damp * this.wYaw);
    }

    // air resistance, which is what sets the top speed
    const sp3 = Math.hypot(this.vx, this.vy, this.vz);
    if (sp3 > 0) {
      const d = this.aero() * sp3;
      ax -= this.vx * d; ay -= this.vy * d; az -= this.vz * d;
    }

    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    const flat = this.speed;
    if (flat > spec.maxSpeed) {
      this.vx *= spec.maxSpeed / flat; this.vy *= spec.maxSpeed / flat;
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    // Body rotation. Roll and pitch are the body answering its springs, so
    // they are damped hard on the ground and left alone in the air; yaw is
    // the tyres turning the body and is barely damped at all.
    const air = this.airborne;
    this.wRoll = (this.wRoll + tRoll * dt) * Math.exp(-(air ? spec.inertia.airSpinDamp : 2.6) * dt);
    this.wPitch = (this.wPitch + tPitch * dt) * Math.exp(-(air ? spec.inertia.airSpinDamp : 2.6) * dt);
    this.wYaw = (this.wYaw + tYaw * dt) * Math.exp(-1.4 * dt);

    this.yaw += this.wYaw * dt;
    this.pitch = clamp(this.pitch + this.wPitch * dt, -spec.inertia.tiltLimit, spec.inertia.tiltLimit);
    this.roll = clamp(this.roll + this.wRoll * dt, -spec.inertia.tiltLimit, spec.inertia.tiltLimit);
    if (Math.abs(this.pitch) >= spec.inertia.tiltLimit) this.wPitch = 0;
    if (Math.abs(this.roll) >= spec.inertia.tiltLimit) this.wRoll = 0;

    // and a floor under the floor: never let the body itself go through the
    // ground, however hard it lands
    const floor = height(this.x, this.y) + 22;
    if (this.z < floor) { this.z = floor; if (this.vz < 0) this.vz *= -0.15; }
  }

  /** Put it back where it started, still. */
  reset(x: number, y: number, yaw: number) {
    this.x = x; this.y = y; this.z = height(x, y) + SPAWN_CLEARANCE;
    this.vx = this.vy = this.vz = 0;
    this.yaw = yaw; this.pitch = this.roll = 0;
    this.wYaw = this.wPitch = this.wRoll = 0;
    this.steer = 0; this.throttle = 0; this.braking = 0;
    for (const w of this.wheels) {
      w.compression = 8; w.onGround = true; w.drop = this.spec.suspension.rest - 8; w.slide = 0; w.load = G / 4;
    }
  }
}
