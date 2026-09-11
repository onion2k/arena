import { afterEach, describe, expect, it, vi } from 'vitest';
import { raceOn } from './sim';
import { LightPool } from 'artshape-render/game/lights';
import { LIGHT_CAPACITY, lightsFor } from '../lighting';
import { BALL_BEAMS, pulse } from '../disco';
import { filigree, presentation, PLINTH_TOP } from '../concours';
import { SETTINGS } from '../settings';
import { COLUMNS } from '../scene';
import { VEHICLES, VEHICLE_KEYS } from '../vehicles';
import { COUNTDOWN } from '../game';

afterEach(() => {
  SETTINGS.disco = false;
  SETTINGS.concours = false;
  SETTINGS.time = 22;
  vi.restoreAllMocks();
});

describe('disco night', () => {
  const lightsAt = (seconds: number, disco: boolean) => {
    SETTINGS.disco = disco;
    SETTINGS.time = 12;
    vi.spyOn(performance, 'now').mockReturnValue(seconds * 1000);
    const race = raceOn(0, 'M', 'forest', 'technical');
    const pool = new LightPool(LIGHT_CAPACITY);
    lightsFor(pool, race);
    return { count: pool.count, data: pool.data.slice(0, pool.count * (pool.data.length / LIGHT_CAPACITY)) };
  };

  // At noon the lamps are out; on the dance floor they are on regardless, and
  // the mirror ball adds its beams on top of the floods and the headlights.
  it('lights the floods, the headlights and the mirror ball at any hour', () => {
    const day = lightsAt(10, false);
    const disco = lightsAt(10, true);
    expect(day.count).toBeLessThan(COLUMNS.length);
    expect(disco.count).toBeGreaterThanOrEqual(COLUMNS.length + 2 + BALL_BEAMS);
    expect(disco.count).toBeLessThanOrEqual(LIGHT_CAPACITY);
  });

  it('changes with the beat', () => {
    const a = lightsAt(10, true), b = lightsAt(10.37, true);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
    // a flash on the beat that decays before the next
    expect(pulse(0)).toBeGreaterThan(pulse(0.2));
  });
});

describe("concours d'élégance", () => {
  // Every class wears stones on both flanks, set on its own body rather than
  // in the air beside it: the filigree is laid by ray against the body mesh.
  it('sets stones on both flanks of every class, on the body', () => {
    for (const key of VEHICLE_KEYS) {
      const spec = VEHICLES[key];
      const { sites, mesh } = filigree(spec);
      expect(sites.filter((s) => s.side > 0).length, `${key} left`).toBeGreaterThanOrEqual(5);
      expect(sites.filter((s) => s.side < 0).length, `${key} right`).toBeGreaterThanOrEqual(5);
      expect(mesh.positions.length).toBeGreaterThan(0);
      const body = spec.kit.body().positions;
      let widest = 0;
      for (let i = 1; i < body.length; i += 3) widest = Math.max(widest, Math.abs(body[i]));
      for (const s of sites) expect(Math.abs(s.at[1]), `${key} stone at ${s.at}`).toBeLessThanOrEqual(widest + 3);
    }
  });

  // The car turns on the plinth through the countdown, is square to the road
  // when the lights go out, and is set down on it within half a second.
  it('turns on the plinth for the countdown and settles at the go', () => {
    const start = presentation(COUNTDOWN, COUNTDOWN, 0, false)!;
    const go = presentation(0, COUNTDOWN, 0, false)!;
    expect(start.spin).toBeGreaterThan(Math.PI * 2);
    expect(go.spin).toBe(0);
    expect(go.lift).toBe(PLINTH_TOP);
    const settling = presentation(0, COUNTDOWN, 0.2, true)!;
    expect(settling.lift).toBeGreaterThan(0);
    expect(settling.lift).toBeLessThan(PLINTH_TOP);
    expect(presentation(0, COUNTDOWN, 1, true)).toBeNull();
  });
});
