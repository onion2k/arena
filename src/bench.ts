/**
 * Measuring a vehicle in isolation: how tight it turns, how hard it
 * accelerates, how hard it brakes. `VehicleSpec.rating` is these three
 * numbers, and `rateTrack` (`track.ts`) rates a lap by them — so a class
 * whose rating is a guess is a class whose difficulty and par time on the
 * track-select screen are guesses too.
 *
 * Done on flat ground and on the centreline, and that took two real bugs out
 * of the way to find. First: driving the shipped circuit's own straight put
 * the suspension over the swell and the ramp waves from `terrain.ts`, which
 * is not what a bench of the vehicle alone wants — `setBenchFlat` takes the
 * ground out of the way. Second: a bench drives far enough in a straight
 * line, at full throttle, to leave the circuit's own polar notion of "on
 * the tarmac" within a few seconds — `where`'s offset is measured against a
 * loop a few metres across, and a straight line reads as running wide to it
 * long before the real circuit ever would. `setBenchGrip` holds grip at 1
 * for the run.
 *
 * A third thing surfaced once those two were out of the way, and was taken
 * at the time for a real mode of the suspension, in every class: held dead
 * straight at full throttle, a pitch-and-heave oscillation that did not damp
 * out. Nothing like it reproduces on the flat in the technical, the rally
 * car or the prototype, then or now. What does reproduce is the F1's, and it
 * was not the suspension: the bench stepped at a sixtieth, the vehicle in
 * quarters of that, and the F1's roll damping cannot be integrated at a
 * 240th — the load flipped from one side of the car to the other every
 * substep. `SUBSTEP` in `vehicle.ts` has the whole of it; substeps are a
 * 480th at most now, whatever `dt` a caller passes, and the tests hold every
 * class to four wheels flat out at any frame rate.
 *
 * The windows below were chosen to average over that oscillation, and are
 * kept: `v² = u² + 2as` over a wide window is a sound way to read an
 * acceleration regardless, and top speed is not measured at all — it is a
 * design input (`spec.engine.topSpeed`), exact by construction, since
 * `aero()` is defined to balance the engine and the drag exactly there.
 *
 * The technical's own shipped rating, 61/700/2400, is not reproduced by this:
 * benched, it comes out at 54.7/3091/5448. The three new classes are rated
 * by scaling their bench by the ratio between those two — see `vehicles.ts`
 * — which is a calibration against one vehicle and nothing else, and is the
 * next thing to replace with laps actually driven.
 */
import { setBenchFlat } from './terrain';
import { centreline, setBenchGrip, tangentAt, type CornerRating } from './track';
import { Vehicle, type VehicleSpec } from './vehicle';

/** Where the bench drives: the centreline at the start line, for its grip
 *  and not its shape — flat ground makes the curvature there irrelevant. */
function grid(): { x: number; y: number; yaw: number } {
  const theta = -Math.PI;
  const [x, y] = centreline(theta);
  const [tx, ty] = tangentAt(theta);
  return { x, y, yaw: Math.atan2(ty, tx) };
}

/** A fresh vehicle, on the grid, ground flattened underneath it. */
function fresh(spec: VehicleSpec): Vehicle {
  const { x, y, yaw } = grid();
  const v = new Vehicle(spec, x, y);
  v.reset(x, y, yaw);
  return v;
}

/**
 * Net acceleration over a speed window, from `v² = u² + 2as`: drive from a
 * standing start to `from`, then measure the distance to `to`. An integral
 * of distance and of speed-squared, which is what makes this safe to read
 * off a run that is not settled — see the file comment — so long as the
 * window is wide enough to average over several cycles of the oscillation
 * rather than stopping at whatever phase it happens to be at.
 */
function accelOver(spec: VehicleSpec, from: number, to: number, drive: 'throttle' | 'brake'): number {
  const v = fresh(spec);
  while (v.speed < from) v.step(1 / 60, { steer: 0, throttle: 1, brake: 0 });
  const u = v.speed, x0 = v.x, y0 = v.y;
  const input = drive === 'throttle' ? { steer: 0, throttle: 1, brake: 0 } : { steer: 0, throttle: 0, brake: 1 };
  const going = drive === 'throttle' ? () => v.speed < to : () => v.speed > to;
  let steps = 0;
  while (going() && steps++ < 4800) v.step(1 / 60, input);
  const dist = Math.hypot(v.x - x0, v.y - y0);
  return Math.abs(v.speed * v.speed - u * u) / (2 * Math.max(dist, 1));
}

/**
 * `v = corner * sqrt(R)` at full lock, held at whatever speed a fixed,
 * moderate throttle settles the turn to. Full lock and enough throttle to
 * roughly balance a corner's own drag does not coast — it converges to a
 * steady circle in a couple of seconds, cleanly (no trace of the straight-
 * line oscillation `accelOver` has to integrate past; cornering hard turns
 * out to be exactly the asymmetric input that damps it out). So this
 * samples the settled tail of the run rather than a chosen window: the
 * first three seconds are given to reach the circle, and every sample after
 * that is kept and averaged.
 */
function cornerAt(spec: VehicleSpec, throttle: number): { corner: number; speed: number } {
  const v = fresh(spec);
  const samples: number[] = [];
  for (let f = 0; f < 480; f++) {
    v.step(1 / 60, { steer: 1, throttle, brake: 0 });
    if (f > 180) {
      const speed = v.speed, w = Math.abs(v.wYaw);
      if (w > 1e-4) samples.push(speed / Math.sqrt(speed / w));
    }
  }
  return { corner: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length), speed: v.speed };
}

export interface BenchResult extends CornerRating {
  topSpeed: number;
  accelWindow: [number, number];
  brakeWindow: [number, number];
  /** The steady cornering speed the throttle settled to — not chosen, read
   *  off the run, so it can be checked against a plausible racing speed. */
  cornerSpeed: number;
}

/**
 * Bench one spec: accel/brake windowed as a share of its own top speed — a
 * design input, `spec.engine.topSpeed`, exact by construction — rather than
 * the technical's absolute mm/s windows, so a faster class is measured over
 * a faster slice of its own range. Corner is not windowed at all: it is
 * whatever steady speed a fixed throttle at full lock settles to, which
 * `cornerSpeed` reports for a sanity check rather than sets in advance.
 */
export function bench(spec: VehicleSpec): BenchResult {
  setBenchFlat(true);
  setBenchGrip(true);
  try {
    const topSpeed = spec.engine.topSpeed;
    const accelWindow: [number, number] = [topSpeed * 0.2, topSpeed * 0.8];
    const brakeWindow: [number, number] = [topSpeed * 0.75, topSpeed * 0.15];
    const { corner, speed: cornerSpeed } = cornerAt(spec, 0.4);
    return {
      topSpeed,
      accelWindow, brakeWindow, cornerSpeed,
      accel: accelOver(spec, accelWindow[0], accelWindow[1], 'throttle'),
      brake: accelOver(spec, brakeWindow[0], brakeWindow[1], 'brake'),
      corner,
    };
  } finally {
    setBenchFlat(false);
    setBenchGrip(false);
  }
}
