/**
 * Rating a class from laps actually driven: `npm run calibrate`.
 *
 * The track-select screen quotes two things about a circuit for the class
 * chosen: a par time and a difficulty (`rateTrack`). This drives every class
 * round a set of circuits with the pilot (`pilot.ts`) and checks both.
 *
 * **What the class laps in.** The pilot drives each circuit to a range of
 * speed plans, from cautious to far more than the car can hold, three laps
 * each, and a circuit's lap is the best flying lap from any of them. The
 * pilot follows the centreline with the rivals' old steering; it is a tidy,
 * consistent driver rather than a fast one, which is what a par time should
 * be.
 *
 * **Par.** A driven lap turned out to be the circuit's length at the class's
 * top speed, times a constant for the class, to within two percent for the
 * technical and the rally car. The corners explain almost nothing of what is
 * left. So par is that — `rating.par` is the constant — and this fits it on
 * one set of circuits and checks it on another.
 *
 * **Difficulty** is how much of a lap is spent below flat out, from the
 * class's corner, accel and brake numbers. It is checked against how much of
 * the lap the pilot spends off full throttle, as a correlation over the
 * circuits: it is meant to say how often you lift, and lifting is cheap.
 */
import { useTrack } from './circuit';
import { Race, STEP } from './game';
import { Pilot } from './pilot';
import { circuitFor, measureShape, rateTrack, speedPlan, type CornerRating } from './track';
import type { VehicleSpec } from './vehicle';
import { sizeOf, type SizeKey } from './world';

/** The corner numbers the pilot's plans are built from, cautious to reckless. */
const PLANS = [50, 55, 60, 65, 70, 80, 90, 100, 115];
/** The plan the lifting is measured to: brisk, and one every class finishes. */
const LIFT_PLAN = 80;
/** Braking for the plans, which barely moves a lap. */
const PLAN_BRAKE = 3500;

export interface Drive {
  /** The best flying lap, or Infinity if three laps took longer than 90s. */
  lap: number;
  /** Share of the flying laps spent off full throttle. */
  lift: number;
}

/** The pilot round one circuit to one plan: its best flying lap, and how
 *  much of the flying laps it lifted for. Medium unless asked otherwise. */
export function driveTo(spec: VehicleSpec, seed: number, corner: number, size: SizeKey = 'M'): Drive {
  useTrack(seed, size, 'forest');
  const race = new Race();
  race.useVehicle(spec);
  const plan = speedPlan(circuitFor(seed, sizeOf(size)), spec.engine.topSpeed, { corner, accel: 1, brake: PLAN_BRAKE, par: 1 }, false).v;
  const pilot = new Pilot(spec, plan);
  const laps: number[] = [];
  let flying = 0, lifted = 0;
  for (let i = 0; i < 90 / STEP && laps.length < 3; i++) {
    const before = race.lap.laps;
    const input = pilot.drive(race.truck, STEP);
    race.step(STEP, input);
    // the first lap is from a standing start
    if (before >= 1) { flying++; if (input.throttle < 1) lifted++; }
    if (race.lap.laps > before && race.lap.lastLap !== null) laps.push(race.lap.lastLap);
  }
  return { lap: laps.length >= 3 ? Math.min(laps[1], laps[2]) : Infinity, lift: lifted / Math.max(1, flying) };
}

export interface Measured {
  seeds: number[];
  laps: number[];
  lifts: number[];
}

/** The best lap on each circuit from any plan, and the lifting to one. */
export function measure(spec: VehicleSpec, seeds: number[]): Measured {
  return {
    seeds,
    laps: seeds.map((seed) => Math.min(...PLANS.map((corner) => driveTo(spec, seed, corner).lap))),
    lifts: seeds.map((seed) => driveTo(spec, seed, LIFT_PLAN).lift),
  };
}

export interface Score {
  /** Par over the lap driven, less one, per circuit; NaN where it never finished. */
  errors: number[];
  mean: number;
  worst: number;
  /** Correlation between difficulty and the pilot's lifting. */
  liftCorrelation: number;
}

/** How a rating's par times and difficulties compare with what was driven. */
export function score(spec: VehicleSpec, m: Measured, rating: CornerRating): Score {
  const rated = m.seeds.map((seed) => rateTrack(circuitFor(seed, 1), spec.engine.topSpeed, rating));
  const errors = rated.map((r, i) => (Number.isFinite(m.laps[i]) ? r.par / m.laps[i] - 1 : NaN));
  const finite = errors.filter(Number.isFinite);
  return {
    errors,
    mean: finite.reduce((s, e) => s + Math.abs(e), 0) / Math.max(1, finite.length),
    worst: Math.max(...finite.map(Math.abs)),
    liftCorrelation: correlation(rated.map((r) => r.difficulty), m.lifts),
  };
}

/**
 * The par constant: the median of lap over a flat-out lap, over the circuits
 * the pilot got round cleanly. A circuit it lapped more than a tenth slower
 * than that median is left out and the median taken again — a lap like that
 * is the pilot in trouble (#4, #10 and #12 for the two long cars, off the
 * road for half of each lap and into the scenery), and a par time should be
 * a clean lap's, not a median dragged up by three bad ones.
 */
export function fitPar(spec: VehicleSpec, m: Measured): number {
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const ratios = m.seeds
    .map((seed, i) => (m.laps[i] * spec.engine.topSpeed) / measureShape(circuitFor(seed, 1)).length)
    .filter(Number.isFinite);
  const first = median(ratios);
  return Math.round(median(ratios.filter((r) => r <= first * 1.1)) * 1000) / 1000;
}

function correlation(x: number[], y: number[]): number {
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}
