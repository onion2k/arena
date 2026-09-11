import { describe, expect, it } from 'vitest';
import { drive, raceOn, stateOf } from './sim';
import { setTrack, circuitFor, centreline, tangentAt, setBenchGrip, rateTrack } from '../track';
import { setBenchFlat } from '../terrain';
import { SUBSTEP, Vehicle, rollDamping } from '../vehicle';
import { driveTo } from '../calibrate';
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
  it('is what the pilot laps the original circuit in, for every class', () => {
    for (const key of VEHICLE_KEYS) {
      const spec = VEHICLES[key];
      const { lap } = driveTo(spec, 0, 80);
      const { par } = rateTrack(circuitFor(0, 1), spec.engine.topSpeed, spec.rating);
      expect(Math.abs(par / lap - 1), `${key}: par ${par.toFixed(2)}, driven ${lap.toFixed(2)}`).toBeLessThan(0.06);
    }
  });
});
