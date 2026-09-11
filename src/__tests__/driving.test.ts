import { describe, expect, it } from 'vitest';
import { drive, raceOn } from './sim';
import { setTrack, circuitFor, centreline, tangentAt, setBenchGrip } from '../track';
import { setBenchFlat } from '../terrain';
import { Vehicle } from '../vehicle';
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

  // Fails at the commit this harness lands in. The physics is stepped at
  // whatever the frame took, in quarters; the stiffer classes' roll damping
  // outruns a quarter of a sixtieth, and the body locks into a flip-flop
  // that never shows at the frame — two wheels carrying everything and two
  // nothing. The F1 does it at 60Hz and tops out at 2275 instead of 3183.
  it.fails('stays on four wheels at full speed whatever the display runs at', () => {
    for (const key of VEHICLE_KEYS) {
      const fine = flatOut(key, 1000);
      for (const hz of [20, 30, 60, 144]) {
        const { speed, lean } = flatOut(key, hz);
        expect(lean, `${key} at ${hz}Hz: load across an axle`).toBeLessThan(0.02);
        expect(Math.abs(speed - fine.speed) / fine.speed, `${key} at ${hz}Hz: ${speed.toFixed(0)} against ${fine.speed.toFixed(0)}`).toBeLessThan(0.01);
      }
    }
  });
});
