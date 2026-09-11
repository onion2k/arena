import { describe, expect, it } from 'vitest';
import { gridUnder, useTrack } from './sim';
import { BIOMES, type BiomeKey } from '../biomes';
import { COLUMNS } from '../scene';
import { PROPS } from '../flora';
import { BOLLARDS, RAILS } from '../furniture';
import * as water from '../water';
import { SIZES } from '../world';

const WET: BiomeKey[] = ['forest', 'snow', 'marsh'];
const SEEDS = Array.from({ length: 40 }, (_, i) => i);

/** How deep the water is over the lowest road, as built for the circuit in force. */
const depthNow = () => Math.round((water.WATER_LEVEL - water.lowestRoad()) * 10) / 10;

describe('the water', () => {
  // Fails at the commit this harness lands in, on the forest's #3: the line
  // there is the lowest point of the lap, so even the step-down's floor of
  // no depth at all leaves the road beside the centreline 6mm under.
  it.fails('never puts the road on the grid under it', () => {
    for (const biome of WET) {
      for (const seed of SEEDS) {
        useTrack(seed, 'M', biome);
        expect(gridUnder(water.WATER_LEVEL), `${biome} #${seed}`).toBe(false);
      }
    }
  });

  // Fails at the commit this harness lands in: the step-down in
  // `floodForBiome` runs out of tries on every marsh (110mm is always
  // lowered to 20) and drains the forest's fords on 18 of these 40 seeds,
  // because it tests the ground at one point with a 50mm margin rather than
  // the road on the grid.
  it.fails('is only made shallower than the biome asks when the grid needs it', () => {
    for (const biome of WET) {
      const asked = BIOMES[biome].water.depth!;
      for (const seed of SEEDS) {
        useTrack(seed, 'M', biome);
        const depth = depthNow();
        if (depth >= asked) continue;
        // lowered: then 20mm deeper than it was lowered to, or the depth the
        // biome asked for, would have to wet the grid
        const floor = water.lowestRoad();
        const deeper = Math.min(asked, depth + 20);
        expect(gridUnder(floor + deeper), `${biome} #${seed} lowered to ${depth}`).toBe(true);
      }
    }
  });
});

describe('the arena as built', () => {
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
