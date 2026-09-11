/**
 * What grows beside the road: a jittered grid of whatever the biome's kinds
 * are, kept off the tarmac and out of the water.
 *
 * This was `forest.ts`, planting one kind of cone everywhere. The algorithm
 * is the same grid-and-jitter it always was — a real wood has no clumps and
 * no bald patches, so roughly even and only roughly is right for a desert's
 * cacti or a marsh's reeds too — generalised to ask a biome which kinds it
 * wants and in what share, rather than assuming there is only one.
 */
import type { GameGroup } from 'artshape-render/game/renderer';
import { TRACK_HALF, where } from './track';
import { ARENA_X, ARENA_Y } from './scene';
import { height } from './terrain';
import { underWater } from './water';
import { SIZE } from './world';
import type { Biome, PropKind } from './biomes';

/**
 * How far from the centreline the planting starts: just behind the lamp
 * posts, which stand at 850. A car has been measured 884 off the line at
 * the very worst, and the widest trunk is 52, so the nearest a truck can
 * touch anything here is about 980 — beyond anything the drivers have
 * managed.
 */
export const FOREST_FROM = TRACK_HALF + 650;
/** How far past the arena's bounds the planting runs. */
const APRON = 380;
/**
 * Beyond this from the centreline, a bigger arena thins the planting rather
 * than filling it at the same density: a truck never gets there, and the
 * count would otherwise grow with the arena's *area*. Within it, full
 * density always: this is what the floods and the headlights actually
 * reach.
 */
const NEAR = 1800;

export interface Prop {
  x: number;
  y: number;
  /** Uniform scale on the unit mesh. */
  scale: number;
  /** The collision radius, zero for a thing a wheel goes through. */
  r: number;
  kind: PropKind;
}

/** A small deterministic generator, so the planting is the same planting
 *  every time and a measurement taken in it can be taken again. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where things stand: a grid over the whole arena, each point jittered by
 * up to half a cell, kept if it is far enough from the road and far enough
 * from the walls. With one kind this is exactly what `forest.ts`'s `plant`
 * did — the RNG draws are in the same order and count, so a forest planted
 * here is pixel-for-pixel the forest that shipped. With more than one it
 * draws one further number per surviving cell to choose which kind takes
 * the spot, weighted by `PropKind.weight`.
 */
export function plantFlora(seed: number, biome: Biome): Prop[] {
  const rand = rng(seed);
  const out: Prop[] = [];
  const x1 = ARENA_X + APRON, y1 = ARENA_Y + APRON;
  const { spacing, kinds } = biome.flora;
  const totalWeight = kinds.reduce((s, k) => s + k.weight, 0);
  const wetKinds = kinds.filter((k) => k.wet);
  const wetWeight = wetKinds.reduce((s, k) => s + k.weight, 0);
  for (let gy = -y1; gy <= y1; gy += spacing) {
    for (let gx = -x1; gx <= x1; gx += spacing) {
      const x = gx + (rand() - 0.5) * spacing;
      const y = gy + (rand() - 0.5) * spacing;
      if (Math.abs(x) > x1 || Math.abs(y) > y1) continue;
      const off = Math.abs(where(x, y).offset);
      if (off < FOREST_FROM) continue;
      // thin, beyond where anything reaches, so the count grows with the
      // lap's length and not the arena's area
      if (off > NEAR && rand() >= 1 / SIZE) continue;
      // In a lake, or on its shore, only what stands in water — a marsh's
      // reeds — and nothing at all in a biome without such a thing. The
      // forest's draws are the same in the same order as before there was a
      // choice here.
      const wet = underWater(x, y, 30);
      const choices = wet ? wetKinds : kinds;
      if (choices.length === 0) continue;
      let kind = choices[0];
      if (choices.length > 1) {
        let r = rand() * (wet ? wetWeight : totalWeight);
        for (const k of choices) { if (r < k.weight) { kind = k; break; } r -= k.weight; }
      }
      const [lo, hi] = kind.scaleRange;
      const scale = lo + rand() * (hi - lo);
      out.push({ x, y, scale, r: kind.radiusOf(scale), kind });
    }
  }
  return out;
}

/** The placement matrices and materials for a planted set, one static group
 *  per kind the biome has — a group is one mesh and one material, and a
 *  biome with a per-instance tint (the forest's greens) still needs one. */
export function floraBuffers(props: Prop[], biome: Biome): GameGroup[] {
  return biome.flora.kinds.map((kind) => {
    const matching = props.filter((p) => p.kind === kind);
    const matrices = new Float32Array(matching.length * 16);
    const material = kind.material;
    const materials = 'tint' in material ? new Float32Array(matching.length * 4) : undefined;
    const rand = rng(11);
    matching.forEach((p, i) => {
      const turn = rand() * Math.PI * 2;
      const c = Math.cos(turn) * p.scale, s = Math.sin(turn) * p.scale;
      const o = i * 16;
      matrices[o] = c; matrices[o + 1] = s;
      matrices[o + 4] = -s; matrices[o + 5] = c;
      matrices[o + 10] = p.scale;
      matrices[o + 12] = p.x; matrices[o + 13] = p.y;
      matrices[o + 14] = height(p.x, p.y) - kind.sink;
      matrices[o + 15] = 1;
      if ('tint' in material && materials) {
        materials.set(material.tint(rand), i * 4);
      }
    });
    const group: GameGroup = { mesh: kind.mesh(), matrices, count: matching.length };
    if (materials) {
      group.materials = materials;
    } else if ('albedo' in material) {
      group.albedo = material.albedo;
      group.roughness = material.roughness;
    }
    return group;
  });
}

/** What is planted now, and how to plant it again for a different circuit
 *  or a different biome. */
export let PROPS: Prop[] = [];
/** `seed` defaults to 7, matching `plantFlora`'s own default seed under the
 *  old `forest.ts`: the jitter pattern is fixed, and only which cells
 *  survive the road and the water moves from one circuit to the next. */
export function replant(seed = 7, biome: Biome) { PROPS = plantFlora(seed, biome); }
