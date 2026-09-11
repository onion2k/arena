import { describe, expect, it } from 'vitest';
import { gridUnder, useTrack } from './sim';
import { BIOMES, type BiomeKey } from '../biomes';
import { COLUMNS } from '../scene';
import { PROPS } from '../flora';
import { BOLLARDS, RAILS, SIGNS } from '../furniture';
import * as water from '../water';
import { SIZES } from '../world';

const WET: BiomeKey[] = ['forest', 'snow', 'marsh'];
const SEEDS = Array.from({ length: 40 }, (_, i) => i);

/** How deep the water is over the lowest road, as built for the circuit in force. */
const depthNow = () => Math.round((water.WATER_LEVEL - water.lowestRoad()) * 10) / 10;

/** The road a race starts on stays this far above the water. */
const CLEARANCE = 10;

describe('the water', () => {
  it('keeps clear of the road on the grid', () => {
    for (const biome of WET) {
      for (const seed of SEEDS) {
        useTrack(seed, 'M', biome);
        // a micron under, because a level set exactly at the clearance can round
        // a hair over it
        expect(gridUnder(water.WATER_LEVEL + CLEARANCE - 1e-6), `${biome} #${seed}`).toBe(false);
      }
    }
  });

  it('is only made shallower than the biome asks as far as the grid needs', () => {
    let lowered = 0;
    for (const biome of WET) {
      const asked = BIOMES[biome].water.depth!;
      for (const seed of SEEDS) {
        useTrack(seed, 'M', biome);
        const depth = water.WATER_LEVEL - water.lowestRoad();
        if (depth >= asked - 1e-6) continue;
        lowered++;
        // a millimetre more water and the grid would no longer be clear
        expect(gridUnder(water.WATER_LEVEL + CLEARANCE + 1), `${biome} #${seed} lowered to ${depth.toFixed(1)}`).toBe(true);
      }
    }
    // and the test is not passing by never lowering anything
    expect(lowered).toBeGreaterThan(0);
  });
});

describe('the arena as built', () => {
  // A size is the same circuit scaled, so the same corners want barriers at
  // every size: the same tyre stacks at every apex, and twice the rails at
  // large and extra large, where each run is laid two rails to a sample. In
  // the desert, so no water cuts a run short. The corner threshold was a
  // fixed 1900mm once, and #63 had no barriers at all at either big size.
  it('guards the same corners at every size', () => {
    for (let seed = 0; seed < 10; seed++) {
      const at = (size: 'S' | 'M' | 'L' | 'XL') => {
        useTrack(seed, size, 'desert');
        return { tyres: BOLLARDS.filter((b) => b.kind === 'tyre').length, rails: RAILS.length, chevrons: SIGNS.filter((c) => c.kind === 'chevron').length };
      };
      const m = at('M');
      expect(m.tyres, `#${seed} has corners to guard`).toBeGreaterThan(0);
      for (const size of ['S', 'L', 'XL'] as const) {
        const got = at(size);
        expect(got.tyres, `#${seed} ${size} tyre stacks`).toBe(m.tyres);
        expect(got.rails, `#${seed} ${size} rails`).toBe(m.rails * (size === 'S' ? 1 : 2));
      }
    }
  });

  // A fingerprint of everything `useTrack` lays out, per size and biome, on
  // the original circuit and one other. A change to any of these numbers is
  // either the point of the change being made or a regression in it; run
  // `npx vitest -u` for the first and read the diff.
  it('matches the recorded layout', () => {
    const out: Record<string, string> = {};
    for (const seed of [0, 63]) {
      for (const size of SIZES) {
        for (const biome of Object.keys(BIOMES) as BiomeKey[]) {
          useTrack(seed, size.key, biome);
          const depth = BIOMES[biome].water.depth === null ? 'dry' : `${depthNow()}mm`;
          out[`#${seed} ${size.key} ${biome}`] =
            `${PROPS.length} props, ${COLUMNS.length} posts, ${RAILS.length} rails, ${BOLLARDS.length} bollards, water ${depth}`;
        }
      }
    }
    expect(out).toMatchSnapshot();
  });
});
