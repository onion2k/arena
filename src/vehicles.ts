/**
 * The vehicle classes: what each one is, physically, and what it looks like.
 *
 * `technical` is the pickup the game shipped with, copied out of the old
 * `vehicle.ts` one constant at a time — nothing about how it drives has
 * changed. The other three are new: a rally car, a Le Mans prototype, an F1
 * car, each a full `VehicleSpec` of its own rather than a multiplier on the
 * technical's.
 *
 * A `rating` is two things. `par` is measured: a driven lap over the lap
 * at flat out, fitted to the pilot's laps of thirteen circuits and checked
 * on thirteen more (`npm run calibrate`, `calibrate.ts`) — within 2% for the
 * technical and the rally car and within 4% for the other two on the
 * circuits it was not fitted to. The corner, accel and brake numbers are
 * only what the track-select screen's difficulty is worked out from. They
 * are `bench.ts` results for the three new classes, scaled by the ratio
 * between the technical's bench and its shipped rating (corner ×1.113,
 * accel ×0.227, brake ×0.437), and the difficulty they give follows how
 * much of a lap the pilot lifts for with r = 0.4 to 0.84 by class. Driven
 * laps could not improve on them for that: fitted to lap times, they
 * collapse to "never lift", because lifting costs a lap almost nothing.
 *
 * A kit is always the same shape — one painted body, one unpainted detail
 * part, a wheel, a lamp — so switching class is a mesh swap on two dynamic
 * groups and not a change to how many of them exist. See `main.ts`.
 */
import { box, part } from './scene';
import type { VehicleLights, VehicleSpec } from './vehicle';

/**
 * Lights in the same places on any body as on the technical's, as shares of
 * its length and width and of the thickness of its body plate: just inside
 * the nose and a finger's width over the plate for the lamps, just off the
 * tail for the glows. The technical's own numbers are what these give for its
 * 300 × 128 body on a 40mm plate.
 */
export function lightsFor(length: number, width: number, plate: number): VehicleLights {
  return {
    head: [length / 2 - 8, Math.round(width * 0.36), plate / 2 + 12],
    tail: [-(length / 2 + 18), Math.round(width * 0.375), Math.round(plate * 0.15)],
    exhaust: [-(length / 2 + 30), -plate / 4],
    markers: [Math.round(length * 0.347), Math.round(width * 0.453), plate / 2 + 42],
  };
}

export type VehicleKey = 'technical' | 'rally' | 'lmp' | 'f1';
export const VEHICLE_KEYS: VehicleKey[] = ['technical', 'rally', 'lmp', 'f1'];

/**
 * The technical: a flatbed pickup. Every number here is the one the old
 * `vehicle.ts` had as a bare constant — see that file's git history for the
 * measurements and the reasoning behind each. `rating` is `CORNER`/`ACCEL`/
 * `BRAKE` from `track.ts`, likewise unchanged.
 */
const TECHNICAL: VehicleSpec = {
  key: 'technical', label: 'technical',
  body: { length: 300, width: 128, height: 90 },
  wheels: [[110, -64, -4], [110, 64, -4], [-110, -64, -4], [-110, 64, -4]],
  wheelRadius: 31,
  suspension: { rest: 28, travel: 26, spring: 305, damper: 22, antiRoll: 120 },
  tyres: { mu: 1.35, rearGrip: 0.92, lateralTau: 0.075, brakeTau: 0.11, rollResist: 0.06, roughDrag: 0.30 },
  brakes: { max: 3600, reverseBelow: 60, reversePower: 0.45 },
  engine: { power: 5800, topSpeed: 2300, driveFront: 0 },
  handbrake: { grip: 0.15, tau: 0.05, max: 400, fade: [0.62, 1.05] },
  drift: {
    grip: 0.45, from: 500, full: 900, keep: 300,
    hold: 0.85, ease: 12, holdOn: 0.35, angle: 0.45, relief: 0.6,
    gain: 500, torque: 110, damp: 5,
  },
  steering: { lock: 0.72, falloff: 2600, rate: 4.6 },
  inertia: { gyration: 1.3, antiSquat: 0.82, tiltLimit: 0.7, airSpinDamp: 1.1 },
  maxSpeed: 4200,
  radius: 98,
  turnCircle: 360,
  // bench: corner 54.8, accel 3087, brake 5497 at top speed 2300 — the
  // shipped rating below is not this; see the file comment above.
  rating: { corner: 61, accel: 700, brake: 2400, par: 1.086 },
  kit: {
    body: () => part('plate(card(width: 300, height: 128, corner: 18), thickness: 40, bevel: 7)'),
    detail: {
      mesh: () => part('plate(card(width: 96, height: 116, corner: 16), thickness: 64, bevel: 8)'),
      at: [74, 0, 40],
      albedo: [0.86, 0.90, 0.97], roughness: 0.12,
    },
    wheel: () => part('disc(radius: 31, thickness: 24, sides: 16, bolts: 5, boltCircle: 17, boltBore: 5, bevel: 5)'),
    lamp: () => part('disc(radius: 17, thickness: 14, sides: 14, bevel: 4)'),
    lights: lightsFor(300, 128, 40),
  },
};

/**
 * A rally car: shorter and lower than the technical, all-wheel drive, softer
 * and taller suspension for the same rough ground, and grip and steering
 * both sharper. The roof scoop and rear wing bar are what read as "rally"
 * from behind at speed, which is most of when you see one.
 */
const RALLY: VehicleSpec = {
  key: 'rally', label: 'rally car',
  body: { length: 260, width: 120, height: 80 },
  wheels: [[95, -60, -2], [95, 60, -2], [-95, -60, -2], [-95, 60, -2]],
  wheelRadius: 28,
  suspension: { rest: 34, travel: 34, spring: 340, damper: 24, antiRoll: 140 },
  tyres: { mu: 1.45, rearGrip: 0.94, lateralTau: 0.07, brakeTau: 0.11, rollResist: 0.06, roughDrag: 0.24 },
  brakes: { max: 3900, reverseBelow: 60, reversePower: 0.45 },
  engine: { power: 6400, topSpeed: 2500, driveFront: 0.5 },
  handbrake: { grip: 0.15, tau: 0.05, max: 420, fade: [0.62, 1.05] },
  drift: {
    grip: 0.40, from: 450, full: 850, keep: 260,
    hold: 0.88, ease: 12, holdOn: 0.32, angle: 0.5, relief: 0.6,
    gain: 520, torque: 130, damp: 5,
  },
  steering: { lock: 0.70, falloff: 2800, rate: 5.2 },
  inertia: { gyration: 1.25, antiSquat: 0.8, tiltLimit: 0.7, airSpinDamp: 1.1 },
  maxSpeed: 4400,
  radius: 90,
  turnCircle: 318,
  // bench: corner 65.6, accel 3462, brake 6016 at top speed 2500
  rating: { corner: 73, accel: 785, brake: 2627, par: 1.058 },
  kit: {
    body: () => part('plate(card(width: 260, height: 120, corner: 22), thickness: 56, bevel: 9)'),
    detail: {
      mesh: () => box(110, 88, 30),
      at: [-6, 0, 52],
      albedo: [0.10, 0.10, 0.12], roughness: 0.4,
    },
    wheel: () => part('disc(radius: 28, thickness: 30, sides: 14, bolts: 6, boltCircle: 15, boltBore: 4, bevel: 4)'),
    lamp: () => part('disc(radius: 16, thickness: 13, sides: 12, bevel: 4)'),
    lights: lightsFor(260, 120, 56),
  },
};

/**
 * A Le Mans prototype: long, low and flat, rear drive with everything the
 * engine has, and the stiffest, shallowest suspension of the four — this is
 * the class that will fly off the ramps, which is the point of having one.
 * The canopy and the tall rear wing on a fin are the silhouette.
 */
const LMP: VehicleSpec = {
  key: 'lmp', label: 'Le Mans prototype',
  body: { length: 340, width: 130, height: 62 },
  wheels: [[128, -62, -8], [128, 62, -8], [-128, -62, -8], [-128, 62, -8]],
  wheelRadius: 30,
  suspension: { rest: 18, travel: 18, spring: 420, damper: 28, antiRoll: 220 },
  tyres: { mu: 1.70, rearGrip: 0.95, lateralTau: 0.06, brakeTau: 0.10, rollResist: 0.05, roughDrag: 0.34 },
  brakes: { max: 4400, reverseBelow: 60, reversePower: 0.4 },
  engine: { power: 7000, topSpeed: 3000, driveFront: 0 },
  handbrake: { grip: 0.15, tau: 0.05, max: 380, fade: [0.6, 1.0] },
  drift: {
    grip: 0.60, from: 550, full: 950, keep: 320,
    hold: 0.8, ease: 12, holdOn: 0.38, angle: 0.35, relief: 0.55,
    gain: 480, torque: 80, damp: 6,
  },
  steering: { lock: 0.55, falloff: 3200, rate: 5.5 },
  inertia: { gyration: 1.2, antiSquat: 0.85, tiltLimit: 0.6, airSpinDamp: 1.0 },
  maxSpeed: 4800,
  radius: 105,
  turnCircle: 561,
  // bench: corner 62.0, accel 3755, brake 6676 at top speed 3000
  rating: { corner: 69, accel: 852, brake: 2915, par: 1.132 },
  kit: {
    body: () => part('plate(card(width: 340, height: 130, corner: 20), thickness: 30, bevel: 6)'),
    detail: {
      mesh: () => part('plate(card(width: 130, height: 92, corner: 30), thickness: 46, bevel: 10)'),
      at: [40, 0, 34],
      albedo: [0.05, 0.06, 0.08], roughness: 0.1,
    },
    wheel: () => part('disc(radius: 30, thickness: 26, sides: 16, bolts: 5, boltCircle: 16, boltBore: 4, bevel: 4)'),
    lamp: () => part('disc(radius: 15, thickness: 12, sides: 12, bevel: 3)'),
    lights: lightsFor(340, 130, 30),
  },
};

/**
 * An F1 car: narrow, the lowest of the four, the most grip and the least
 * suspension travel by a wide margin — a kerb here is a jolt, not a bump.
 * Rear drive, the sharpest brakes, the tightest standstill lock and the
 * fastest fall-off with speed of any of them. The nose and the two wings are
 * what make the silhouette read as open-wheel rather than as a wedge.
 */
const F1: VehicleSpec = {
  key: 'f1', label: 'F1 car',
  body: { length: 360, width: 110, height: 48 },
  wheels: [[138, -68, -12], [138, 68, -12], [-138, -68, -12], [-138, 68, -12]],
  wheelRadius: 34,
  suspension: { rest: 12, travel: 12, spring: 520, damper: 32, antiRoll: 300 },
  tyres: { mu: 1.95, rearGrip: 0.96, lateralTau: 0.05, brakeTau: 0.09, rollResist: 0.045, roughDrag: 0.5 },
  brakes: { max: 5200, reverseBelow: 60, reversePower: 0.35 },
  engine: { power: 8200, topSpeed: 3300, driveFront: 0 },
  handbrake: { grip: 0.15, tau: 0.05, max: 340, fade: [0.55, 0.95] },
  drift: {
    grip: 0.70, from: 600, full: 1000, keep: 350,
    hold: 0.7, ease: 13, holdOn: 0.42, angle: 0.28, relief: 0.5,
    gain: 460, torque: 50, damp: 7,
  },
  steering: { lock: 0.48, falloff: 3800, rate: 6.0 },
  inertia: { gyration: 1.1, antiSquat: 0.88, tiltLimit: 0.5, airSpinDamp: 0.9 },
  maxSpeed: 5200,
  radius: 110,
  turnCircle: 691,
  // bench: corner 63.9, accel 4484, brake 7741 at top speed 3300. It read
  // 54.3/4477/7809 when this class was first benched, and the comment here
  // explained the low corner as steering geometry winning over grip. It was
  // not: the bench stepped at a 240th, the F1's roll damping cannot be
  // integrated at a 240th, and the car took the bench's circle on two wheels
  // (`SUBSTEP` in `vehicle.ts`). Re-benched at a 480th, scaled by the same
  // factors as before. The other three classes moved by under 1.5% and are
  // left as they were.
  rating: { corner: 71, accel: 1018, brake: 3383, par: 1.171 },
  kit: {
    body: () => part('plate(card(width: 360, height: 110, corner: 16), thickness: 22, bevel: 5)'),
    detail: {
      mesh: () => part('plate(card(width: 90, height: 40, corner: 12), thickness: 20, bevel: 4)'),
      at: [186, 0, 8],
      albedo: [0.08, 0.08, 0.09], roughness: 0.2,
    },
    wheel: () => part('disc(radius: 34, thickness: 34, sides: 16, bolts: 5, boltCircle: 19, boltBore: 5, bevel: 3)'),
    lamp: () => part('disc(radius: 13, thickness: 11, sides: 12, bevel: 3)'),
    lights: lightsFor(360, 110, 22),
  },
};

export const VEHICLES: Record<VehicleKey, VehicleSpec> = {
  technical: TECHNICAL, rally: RALLY, lmp: LMP, f1: F1,
};

export function vehicleFor(key: VehicleKey): VehicleSpec { return VEHICLES[key]; }
