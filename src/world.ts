/**
 * How big the world is, as one number everything else is scaled by.
 *
 * The circuit generator and the arena's own bounds used to agree only by
 * being the same fixed numbers everywhere they were written down — nothing
 * in the code said they were the same thing. This is that thing: one factor,
 * picked on the track-select screen, that `scene.ts` multiplies its bounds
 * by and `track.ts` multiplies a canonical circuit by. A seed still means
 * the same *shape* at every size; it just comes out bigger or smaller.
 */
export type SizeKey = 'S' | 'M' | 'L' | 'XL';

export interface SizeOption {
  key: SizeKey;
  label: string;
  /** Linear scale on the shipped arena and circuit. */
  scale: number;
}

export const SIZES: SizeOption[] = [
  { key: 'S', label: 'small', scale: 0.75 },
  { key: 'M', label: 'medium', scale: 1 },
  { key: 'L', label: 'large', scale: 1.5 },
  { key: 'XL', label: 'extra large', scale: 2 },
];

export function sizeOf(key: SizeKey): number {
  return SIZES.find((s) => s.key === key)?.scale ?? 1;
}

export function labelOf(key: SizeKey): string {
  return SIZES.find((s) => s.key === key)?.label ?? key;
}

/**
 * The scale in force. A live global rather than a parameter everywhere,
 * because the things that read it — the arena's bounds, the ground mesh's
 * cell size, how hard the forest is thinned — are themselves module-level
 * singletons rebuilt by `useTrack`, and threading the number through all of
 * them would be a parameter that never varies independently of this one.
 */
export let SIZE = 1;

export function setSize(key: SizeKey) { SIZE = sizeOf(key); }
