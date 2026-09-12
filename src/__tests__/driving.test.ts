import { describe, expect, it } from 'vitest';
import { drive, raceOn, stateOf } from './sim';
import { setTrack, circuitFor, centreline, tangentAt, setBenchGrip, rateTrack, TRACK_LIFT } from '../track';
import { kindForVehicle } from '../kind';
import { height } from '../terrain';
import { setBenchFlat } from '../terrain';
import { SUBSTEP, Vehicle, rollDamping } from '../vehicle';
import { driveTo } from '../calibrate';
import { turnCircle } from '../bench';
import { VEHICLES, VEHICLE_KEYS } from '../vehicles';
import type { BiomeKey } from '../biomes';
import type { SizeKey } from '../world';

describe('a scripted drive', () => {
  // Four seconds on the lights and thirty of the script, hashed every frame.
  // Bit for bit: a refactor that is meant to change nothing about how the
  // vehicles drive has to leave every one of these alone, and a change that
  // is meant to change the driving changes them — `npx vitest -u`, and say
  // why in the commit.
  it('matches the recorded trajectories', () => {
    const runs: [number, SizeKey, BiomeKey, string][] = [
      ...VEHICLE_KEYS.map((v): [number, SizeKey, BiomeKey, string] => [0, 'M', 'forest', v]),
      [0, 'M', 'desert', 'technical'],
      [0, 'M', 'snow', 'technical'],
      [0, 'M', 'marsh', 'technical'],
      [63, 'S', 'forest', 'rally'],
      [63, 'XL', 'snow', 'f1'],
    ];
    const out: Record<string, string> = {};
    for (const [seed, size, biome, vehicle] of runs) {
      const race = raceOn(seed, size, biome, vehicle as keyof typeof VEHICLES);
      out[`#${seed} ${size} ${biome} ${vehicle}`] = drive(race, 34, 60);
    }
    expect(out).toMatchSnapshot();
  });
});

describe('every vehicle class', () => {
  /**
   * Flat out in a straight line on flat, full-grip ground, stepped the way
   * the game steps it on a display running at `hz`. Returns the speed after
   * ten seconds and how evenly the load sits across the axles.
   */
  function flatOut(key: keyof typeof VEHICLES, hz: number) {
    setTrack(circuitFor(0, 1));
    setBenchFlat(true);
    setBenchGrip(true);
    try {
      const [x, y] = centreline(-Math.PI);
      const [tx, ty] = tangentAt(-Math.PI);
      const v = new Vehicle(VEHICLES[key], x, y);
      v.reset(x, y, Math.atan2(ty, tx));
      for (let f = 0; f < 10 * hz; f++) v.step(1 / hz, { steer: 0, throttle: 1, brake: 0 });
      const [fl, fr, rl, rr] = v.wheels.map((w) => w.load);
      return { speed: v.speed, lean: Math.max(Math.abs(fl - fr) / (fl + fr), Math.abs(rl - rr) / (rl + rr)) };
    } finally {
      setBenchFlat(false);
      setBenchGrip(false);
    }
  }

  it('stays on four wheels at full speed whatever the display runs at', () => {
    for (const key of VEHICLE_KEYS) {
      const fine = flatOut(key, 1000);
      for (const hz of [20, 30, 60, 120, 144]) {
        const { speed, lean } = flatOut(key, hz);
        expect(lean, `${key} at ${hz}Hz: load across an axle`).toBeLessThan(0.02);
        expect(Math.abs(speed - fine.speed) / fine.speed, `${key} at ${hz}Hz: ${speed.toFixed(0)} against ${fine.speed.toFixed(0)}`).toBeLessThan(0.01);
      }
    }
  });

  it('turns the circle its spec says it does', () => {
    for (const key of VEHICLE_KEYS) {
      const measured = turnCircle(VEHICLES[key]);
      expect(Math.abs(measured / VEHICLES[key].turnCircle - 1), `${key}: measured ${measured.toFixed(0)}`).toBeLessThan(0.02);
    }
  });

  // Drawn on the grid, which is on the tarmac: the tyres meet the road you
  // can see rather than sinking into it, and the body clears it. The physics
  // rides the terrain and the road is drawn above it, so this is what
  // `drawnLift` is for.
  it('sits on the drawn road with its body clear of it', () => {
    for (const key of VEHICLE_KEYS) {
      const race = raceOn(0, 'M', 'forest', key);
      for (let f = 0; f < 240; f++) race.advance(1 / 60, { turn: 0, throttle: 0, brake: 0 });
      const spec = VEHICLES[key];
      const pose = race.shown;
      // the body's frame, as the drawing places a wheel in it
      const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
      const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
      const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
      const f = [cy * cp, sy * cp, -sp];
      const l = [cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr];
      const u = [cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr];
      spec.wheels.forEach(([lx, ly, lz], i) => {
        const hz = lz - pose.wheels[i].drop;
        const x = pose.x + f[0] * lx + l[0] * ly + u[0] * hz;
        const y = pose.y + f[1] * lx + l[1] * ly + u[1] * hz;
        const bottom = pose.z + f[2] * lx + l[2] * ly + u[2] * hz - spec.wheelRadius;
        const road = height(x, y) + TRACK_LIFT;
        expect(Math.abs(bottom - road), `${key} wheel ${i}: ${bottom.toFixed(1)} against the road at ${road.toFixed(1)}`).toBeLessThan(3);
      });
      const body = spec.kit.body().positions;
      let lowest = Infinity;
      for (let k = 2; k < body.length; k += 3) lowest = Math.min(lowest, body[k]);
      const road = height(pose.x, pose.y) + TRACK_LIFT;
      expect(pose.z + lowest, `${key}: body's underside against the road`).toBeGreaterThan(road);
    }
  });

  // A beam comes out of a lamp you can see: every light a class carries has
  // to sit on its model, not in the air beside it. The headlamps toward the
  // front, the tail and exhaust glows toward the back.
  it('carries its lights on its own body', () => {
    for (const key of VEHICLE_KEYS) {
      const kit = VEHICLES[key].kit;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const mesh of [kit.body(), kit.detail.mesh()]) {
        for (let i = 0; i < mesh.positions.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], mesh.positions[i + k]);
            hi[k] = Math.max(hi[k], mesh.positions[i + k]);
          }
        }
      }
      const within = ([x, y, z]: number[]) =>
        x >= lo[0] - 6 && x <= hi[0] + 6 && Math.abs(y) <= hi[1] + 6 && z >= lo[2] - 6 && z <= hi[2] + 6;
      const { head, tail, exhaust, markers } = kit.lights;
      expect(within(head) && head[0] > hi[0] * 0.6, `${key} headlamp ${head}`).toBe(true);
      expect(within(tail) && tail[0] < lo[0] * 0.6, `${key} tail light ${tail}`).toBe(true);
      expect(within([exhaust[0], 0, exhaust[1]]), `${key} exhaust ${exhaust}`).toBe(true);
      expect(within(markers), `${key} markers ${markers}`).toBe(true);
    }
  });

  // Why the test above holds, per class, before anyone has to drive one: a
  // damper integrated explicitly is stable while its rate times the step is
  // under two, and this keeps every class under half of that. A class stiff
  // enough to fail here needs a shorter `SUBSTEP`, not a softer test.
  it('has roll damping the substep can integrate with room to spare', () => {
    for (const key of VEHICLE_KEYS) {
      expect(rollDamping(VEHICLES[key]) * SUBSTEP, key).toBeLessThan(1);
    }
  });
});

describe('the race clock', () => {
  // Constant input, so that what a display's frames sample of it cannot
  // differ: the lights, then ten seconds of a held turn at full throttle.
  const input = { turn: 0.4, throttle: 1, brake: 0 };

  it('runs the same race at any frame rate, bit for bit', () => {
    const states = new Map<number, string>();
    for (const hz of [20, 30, 60, 120, 144, 240]) {
      const race = raceOn(0, 'M', 'forest', 'f1');
      while (race.clock.count < 1680) race.advance(1 / hz, input);
      expect(race.clock.count, `${hz}Hz`).toBe(1680);
      states.set(hz, stateOf(race));
    }
    expect(new Set(states.values()).size, JSON.stringify(Object.fromEntries(states))).toBe(1);
  });

  // At 144Hz a step is longer than a frame, so one frame in six takes no step
  // at all. Drawn from the physics that frame would repeat the last; drawn
  // between the last two steps, it moves on like every other.
  it('draws the truck somewhere new every frame, even when no step was taken', () => {
    const race = raceOn(0, 'M', 'forest', 'technical');
    for (let f = 0; f < 5 * 144; f++) race.advance(1 / 144, input);
    let still = 0;
    let lastX = race.shown.x, lastY = race.shown.y;
    for (let f = 0; f < 144; f++) {
      race.advance(1 / 144, input);
      const { x, y } = race.shown;
      if (Math.hypot(x - lastX, y - lastY) < 1e-6) still++;
      lastX = x; lastY = y;
    }
    expect(still).toBe(0);
  });
});

describe('par', () => {
  // The pilot round the original circuit in every class, to one brisk plan:
  // its best flying lap has to be within 6% of the par the track-select
  // screen quotes. `npm run calibrate` is the full check, over twenty-six
  // circuits and every plan; this is the part of it quick enough to run
  // every time, and it fails if the vehicles, the pilot or the par model
  // drift apart.
  it('is what the pilot laps seed zero in, for every class on its own kind', () => {
    // Each class on the kind of circuit it is offered on. Driving a
    // prototype round a rally stage and holding its par to what it laps
    // there is checking a number against a road the car is never on: the
    // two racing classes' par constants are fitted on tracks, and on a
    // stage they read eight and eleven percent slow — correctly.
    for (const key of VEHICLE_KEYS) {
      const spec = VEHICLES[key];
      const kind = kindForVehicle(key);
      const { lap } = driveTo(spec, 0, 80, 'M', 'forest', false, kind);
      const { par } = rateTrack(circuitFor(0, 1, false, kind), spec.engine.topSpeed, spec.rating);
      expect(Math.abs(par / lap - 1), `${key} on ${kind}: par ${par.toFixed(2)}, driven ${lap.toFixed(2)}`).toBeLessThan(0.06);
    }
  });
});
