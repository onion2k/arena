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
import { TRACK_LIFT, gripAt } from './track';
import { WATER_DRAG, WATER_LEVEL } from './water';
import { SETTINGS } from './settings';

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
 *
 * 220 apart rather than 166. A long wheelbase is a heavier, calmer truck and
 * a wider turning circle, and both of those are measured: the circle at 1500
 * mm/s goes from 443mm to about 520 against a tightest corner of 568, so the
 * corner is still takeable, and a lap goes up by about two tenths.
 */
export const WHEELS: [number, number, number][] = [
  [110, -64, -4], [110, 64, -4],
  [-110, -64, -4], [-110, 64, -4],
];

/**
 * How long the body is, nose to tail. The wheels sit 15mm inside each end.
 *
 * It is here rather than with the mesh that draws it because the pitch and
 * yaw inertias are worked out from it, and a truck drawn longer than it is
 * modelled turns like the short one it used to be.
 */
export const BODY_LENGTH = 300;
export const WHEEL_RADIUS = 31;
/** Front axle to rear axle, which is what sets the turning circle. */
export const WHEELBASE = WHEELS[0][0] - WHEELS[2][0];
/** How far the wheel hangs below its mounting when nothing is pushing on it. */
const REST = 28;
const TRAVEL = 26;
/**
 * Spring rate, as body acceleration per millimetre of compression per wheel.
 * Four wheels at 8mm of squash hold the truck up against gravity:
 * 4 · 305 · 8 = 9760, which is where it sits at rest.
 *
 * It was 190, which is 13mm of sag out of 26mm of travel — half the
 * suspension used up standing still. A body floating on springs that soft is
 * most of what "light" means in a vehicle you are driving rather than
 * weighing: it pitches at every input and takes a while to stop.
 */
const SPRING = 305;
/** A quarter over critical for the heave mode, which is a firm truck. */
const DAMPER = 22;
/**
 * The anti-roll bars, as load moved across an axle per millimetre of
 * difference between its two wheels.
 *
 * The most effective single thing for making a car feel planted rather than
 * floaty, and the only one here that a real chassis engineer would also reach
 * for first. It takes the roll out without taking the suspension travel out,
 * so the truck still follows the ground.
 */
const ANTI_ROLL = 120;

/**
 * Grip, as a multiple of the load a tyre is carrying.
 *
 * It was 2.15, and the tightest corner on the circuit asks for 0.87g at top
 * speed — so the tyres had five times the grip anything ever wanted from
 * them. Measured on a full-lock skidpad, the truck used between four and
 * fifteen per cent of its grip at every speed it can reach, peaking at 0.31g
 * of lateral acceleration: the radius it turned in was set by the steering
 * geometry and nothing else. There was no limit to find, no way to overdrive
 * a corner, and nothing a bump or a throttle could unsettle. It was a slot
 * car with a minimum radius.
 *
 * At 1.35 the limit is inside what the driver can ask for, which is the whole
 * point: a corner taken too fast runs wide, the back steps out under power,
 * and holding it near the limit is a thing you can do well or badly. Full
 * lock now asks for between a third and three quarters of what the tyres
 * have, depending on speed, and a bump or a throttle spends the rest.
 *
 * It cannot go much below that while the engine is this strong. Drive is
 * shared by two rear wheels carrying about a quarter of the truck each, so
 * the rear tyres can put down 2·MU·G/4 before they spin: at 1.05 that is
 * 5150 against an engine of 5800, and the truck stood at every corner exit
 * spinning its wheels and going nowhere. A field of four spent 91% of a
 * two-minute race stationary.
 */
export const MU = 1.35;
/**
 * How quickly a tyre tries to kill sideways slip, if it has the grip to.
 * Shorter is a tyre that bites rather than one that takes a moment to decide.
 */
const LATERAL_TAU = 0.075;
const BRAKE_TAU = 0.11;
/**
 * The most the brakes can pull, as body acceleration, whatever grip is
 * available.
 *
 * Without it the brakes are limited only by the tyres, and with this much
 * grip that meant stopping from full speed in sixty millimetres — a fifth of
 * a truck length, in a tenth of a second. Not a brake, a wall, and it took
 * braking out of the game entirely: there was no corner you had to slow for
 * and no line you had to think about.
 *
 * A real car's brakes can lock its wheels, so this is a lie. It is the lie
 * that makes the arithmetic of a lap interesting, and a truck that stops like
 * a truck is also most of what "heavy" means to drive.
 */
const BRAKE_MAX = 3600;
/**
 * What the rear tyres get of the front's grip.
 *
 * A car with the same grip at both ends has no character at the limit: it
 * washes out at all four corners at once and there is nothing to catch.
 * Taking a little off the back means the rear lets go first, and lets go
 * progressively, so the truck rotates into a corner when it is overdriven and
 * can be held there. Only 8%: much more and it is a car that wants to spin.
 */
const REAR_GRIP = 0.92;
/**
 * The handbrake: what the rear tyres keep of their sideways grip while it is
 * pulled, and how hard it locks them.
 *
 * This is the one input in the game that is not a request for more of
 * something. Steering, throttle and brake all ask the car to do what it was
 * going to do, harder; the handbrake asks it to do something it otherwise
 * cannot, which is to point somewhere other than where it is going. A car you
 * can only drive forwards round a corner is a car with one thing to say.
 *
 * It is not a fast way round anything, and it was tuned knowing that. Swept
 * over how much grip it leaves and how hard it locks, it never once turned
 * the truck through more of a corner than simply steering did — cutting the
 * rear's sideways grip cuts the rear's share of the cornering with it, so the
 * truck rotates and runs wide at the same time. What it buys is 45 degrees of
 * slip angle that comes back when you let go, for three quarters of the speed
 * carried in. That is what a handbrake turn costs a real car too.
 */
const HANDBRAKE_GRIP = 0.15;
const HANDBRAKE_TAU = 0.05;
/**
 * Where the handbrake stops helping: at full effect below this much body
 * slip, in radians, and doing nothing at all above the second figure.
 *
 * Without a fade the input is not a slide, it is a pirouette — held for six
 * tenths of a second at top speed the truck went round through 171 degrees
 * and came out at five per cent of the speed it went in at, which is not a
 * corner taken sideways, it is a race ended by touching a key.
 *
 * Past about ninety degrees there is nothing to fade back to: a tyre opposes
 * the way its own contact patch is sliding, and once the truck is travelling
 * sideways that direction is along the truck rather than across it, so the
 * rear tyres stop arresting the rotation and start feeding it. Everything
 * here is about not arriving there. The fade is well inside it — full grip
 * back by sixty degrees — which leaves the tyres a wide margin to work in.
 */
const HANDBRAKE_FADE = [0.62, 1.05];
/**
 * The most the handbrake will pull, per rear wheel, as body acceleration.
 *
 * Locked rear wheels carrying half the truck at this much grip stop it at
 * two thirds of a gravity, which is what the model gives if it is left to
 * itself — and a handbrake held for seven tenths of a second then takes
 * ninety-nine per cent of the speed away. That is not a drift, it is a
 * parking brake, and it was also what made the input look random: with the
 * truck almost stopped, any rotation at all reads as a slip angle of 180
 * degrees, so the same key gave a tidy slide at one steering angle and an
 * apparent spin at another. Capped, the handbrake does the job it is for,
 * which is to take the back tyres' sideways grip away and leave the truck
 * still moving.
 */
const HANDBRAKE_MAX = 400;
/** Below this much forward speed, the brake becomes reverse. */
const REVERSE_BELOW = 60;
/** How much of the engine reverse gets. Enough to get out of trouble, not to race. */
const REVERSE_POWER = 0.45;
const ROLL_RESIST = 0.06;
/**
 * Extra rolling resistance off the tarmac, per unit of grip the surface has
 * lost: dirt and grass drag as well as letting go.
 *
 * Grip alone was not enough to keep the field on the road, for a reason
 * particular to a track defined as a radius about a middle: leaving it on the
 * inside makes the lap shorter. The fastest driver in the field spent a fifth
 * of its lap off the road because the distance it saved was worth more than
 * the grip it gave up, which is a racing line that ignores the circuit. This
 * is the other half of the shoulder — a car that runs wide is slowed as well
 * as loosened, and cutting stops paying.
 *
 * It was 0.62, which is 0.3g of drag off the tarmac, and at that it was the
 * loudest thing in the model: every measurement of anything else taken with a
 * wheel off the road was really a measurement of this. Half of that is still
 * a second a lap.
 */
const ROUGH_DRAG = 0.30;
const ENGINE = 5800;             // total drive acceleration at full throttle
/**
 * Aerodynamic drag, and what actually sets the top speed: the engine and this
 * balance at about 2400 mm/s. That is well over the 2015 the ramps need, and
 * it has to be: crossing a ramp is paid for out of the same speed that clears
 * it, so a top speed merely equal to the threshold clears nothing. The cap
 * below is a guard against a physics blow-up rather than a speed limiter, and
 * is not reached in normal driving.
 */
/**
 * Drag is not a constant any more: it is whatever makes the engine and the
 * drag balance at the top speed the settings ask for. v² · AERO = ENGINE at
 * the top, so AERO = ENGINE / v². At the default 2300 that is 1.096e-3,
 * which is the 1.1e-3 it was as a constant.
 */
function aero(): number {
  const v = Math.max(300, SETTINGS.topSpeed);
  return ENGINE / (v * v);
}
/** A guard against a blow-up, a way above anything the drag will allow. */
export const MAX_SPEED = 4200;

/**
 * Steering lock at a standstill, and how sharply it is wound off with speed.
 *
 * A larger falloff means less wound off. At 430 the lock at 1500 mm/s was
 * 0.116 radians, which on a 166mm wheelbase is a 1426mm circle — wider than
 * the tightest corner on the circuit, so the corner could not be taken at
 * speed however much grip the tyres had. At 850 the same speed keeps 0.23
 * radians and a 710mm circle.
 *
 * 850 was still not enough, for a reason that only shows up when the two
 * limits are compared: a 710mm circle at 1500 mm/s is 0.23g, and the tyres
 * had 2.15g. Every corner was decided by how far the wheels would turn, and
 * the driver's only input was to hold the wheel over and wait. A real car's
 * steering ratio does not change with speed at all; this keeps some falloff
 * because the keyboard is a switch and full lock arriving instantly at speed
 * is a spin, but at 2600 the lock at 2200 mm/s asks for 1.03g against the
 * 1.05 the tyres have. The driver can now ask for more than the car has,
 * which is the only way a limit can be a thing you drive to.
 */
/*
 * Raised from 0.62 with the wheelbase. Turn radius is wheelbase over tan of
 * the road wheel angle, so a truck 33% longer between its axles turns 33%
 * wider on the same lock: the circle at 1500 mm/s went from 443mm to 560
 * against a tightest corner of 568, which is no margin at all and is exactly
 * the state this constant was raised to fix once before. At 0.72 — 41 degrees
 * at a standstill, the top of what a real steering rack gives — the circle is
 * back inside 470.
 */
export const STEER_LOCK = 0.72;
/** The lock in force, which is the constant above scaled by the settings. */
export function steerLock(): number { return STEER_LOCK * SETTINGS.steering; }
export const STEER_FALLOFF = 2600;
const STEER_RATE = 4.6;

/**
 * Mass-normalised inertia about each body axis, for a box `BODY_LENGTH` long,
 * 128 wide and 90 tall: (a² + b²)/12 over the two axes that are not the one turned
 * about. Roll is the small one, which is why a truck leans before it pitches.
 *
 * The gyration factor is because a vehicle is not a uniform box — its mass is
 * at the corners, in the wheels and the engine and the load bed, not spread
 * evenly through the middle. A real one is a quarter to a half above the box
 * figure, and the difference is most of what tells you whether you are
 * driving something heavy: how long it takes to agree to change direction.
 */
const GYRATION = 1.3;
const I_ROLL = ((128 * 128 + 90 * 90) / 12) * GYRATION;
const I_PITCH = ((BODY_LENGTH * BODY_LENGTH + 90 * 90) / 12) * GYRATION;
const I_YAW = ((BODY_LENGTH * BODY_LENGTH + 128 * 128) / 12) * GYRATION;

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
  /**
   * Stand still, whatever the ground is doing. A handbrake and not the brake
   * pedal: the pedal turns into reverse once the truck has stopped, which is
   * what gets it out from against a post and is exactly wrong for holding it
   * on the line — held that way it reversed away from the start at over a
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
  throttle = 0; braking = 0;

  readonly wheels: Wheel[] = WHEELS.map(() => ({
    compression: 0, onGround: false, drop: REST, spin: 0, steer: 0, slide: 0, load: 0, ground: 0, wet: false,
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
    const wanted = clamp(drive.steer, -1, 1) * (steerLock() / (1 + this.speed / STEER_FALLOFF));
    this.steer += clamp(wanted - this.steer, -STEER_RATE * dt, STEER_RATE * dt);
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
    // — getting this wrong means a truck facing along +y answers a torque
    // that should pitch it by rolling instead, which is not subtle.
    const rollAxX = cy, rollAxY = sy;
    const pitchAxX = -sy, pitchAxY = cy;

    // How much of the handbrake is doing anything: all of it until the truck
    // is properly sideways, then none. See HANDBRAKE_FADE.
    let hand = 0;
    if (drive.handbrake) {
      let slip = 0;
      if (this.speed > 120) {
        slip = Math.atan2(this.vy, this.vx) - this.yaw;
        while (slip > Math.PI) slip -= Math.PI * 2;
        while (slip < -Math.PI) slip += Math.PI * 2;
      }
      const [full, none] = HANDBRAKE_FADE;
      hand = 1 - clamp((Math.abs(slip) - full) / (none - full), 0, 1);
    }

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
      w.compression = clamp(REST + WHEEL_RADIUS - (mz - w.ground), 0, TRAVEL);
      w.onGround = w.compression > 0;
      w.drop = REST - w.compression;
      w.steer = i < 2 ? this.steer : 0;
    }
    // load moved across each axle, toward whichever side is squashed more
    const bar = [
      ANTI_ROLL * (this.wheels[0].compression - this.wheels[1].compression),
      ANTI_ROLL * (this.wheels[2].compression - this.wheels[3].compression),
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
      const load = Math.max(0, SPRING * w.compression + DAMPER * closing + roll);
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
      // and falls away over a shoulder either side of it. `gripAt` existed
      // and was never called by anything: the grass held exactly as well as
      // the road, so running wide cost nothing, and a racing line you are not
      // punished for missing is not a racing line.
      const rear = i >= 2;
      const surface = gripAt(mx, my);
      let grip = MU * load * surface * (rear ? REAR_GRIP : 1);
      if (hand > 0 && rear) grip *= 1 - (1 - HANDBRAKE_GRIP) * hand;
      let wantSide = -vSide / LATERAL_TAU;
      // Rolling resistance, more off the tarmac, and more again with the
      // wheel in the water: a ford is felt, not just seen. The wheel rides
      // the terrain and the tarmac is drawn 22mm above it, so on the road
      // the surface the water is measured against is the road's — without
      // that the truck was wet for a sixth of every lap, on ground that was
      // dry to look at.
      const surfaceZ = w.ground + (surface >= 1 ? TRACK_LIFT : 0);
      w.wet = surfaceZ < WATER_LEVEL;
      let wantFwd = -vFwd * (ROLL_RESIST + ROUGH_DRAG * (1 - surface) + (w.wet ? WATER_DRAG : 0));
      if (drive.hold) {
        // uncapped, unlike the brake pedal: a handbrake locks the wheels and
        // is limited by the tyres rather than by the brakes, which is what
        // makes it hold on a slope instead of creeping down one
        wantFwd += -vFwd / 0.03;
      }
      if (rear && !drive.hold) wantFwd += (this.throttle * ENGINE) / 2;   // rear wheel drive
      // the handbrake locks the back wheels, and a locked wheel is spending
      // its whole circle on stopping and has none left to hold the line with
      if (hand > 0 && rear) {
        wantFwd += clamp(-vFwd / HANDBRAKE_TAU, -HANDBRAKE_MAX, HANDBRAKE_MAX) * hand;
      }
      if (this.braking > 0 && !drive.hold) {
        // Brake, and then reverse once it has stopped. A car cannot steer
        // without moving, and this one is pushed straight back out of
        // whatever it hits — so without a reverse gear a truck wedged against
        // a post is wedged there for good. It was: a driver left running for
        // two minutes spent ninety seconds of it stationary against a post
        // with the throttle wide open.
        const stop = clamp(-vFwd / BRAKE_TAU, -BRAKE_MAX / 4, BRAKE_MAX / 4) * this.braking;
        if (vFwd > REVERSE_BELOW) wantFwd += stop;
        else if (i >= 2) wantFwd -= (this.braking * ENGINE * REVERSE_POWER) / 2;
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
      const d = aero() * sp3;
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
    this.wYaw = (this.wYaw + tYaw * dt) * Math.exp(-1.4 * dt);

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
      w.compression = 8; w.onGround = true; w.drop = REST - 8; w.slide = 0; w.load = G / 4;
    }
  }
}
