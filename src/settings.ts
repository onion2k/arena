/**
 * The knobs a player may turn while the game is running, and their ranges.
 *
 * Everything the game is tuned by is a constant in the module that uses it,
 * with a comment saying why it is what it is, and that is the right place
 * for a number that was measured. These are the few that are a matter of
 * taste rather than measurement — how dark the night is, how fast the trucks
 * go, how many of them there are — and they are kept together here so the
 * panel that shows them has one table to read and the modules that use them
 * have one object to look in.
 *
 * Read live, every frame, by whoever needs them: nothing is copied out at
 * startup, so a slider moved mid-race takes effect on the next step.
 */

import { clockLabel } from './daylight';

export interface Settings {
  /** How much the environment lights everything, before any lamp does. */
  ambient: number;
  /** The trackside floodlights, as the intensity each one is given. */
  flood: number;
  /**
   * The time of day, in hours round the clock. It moves the sun, the sky and
   * the ambient together and switches the lamps off by day: see `daylight`.
   * The ambient above is the night's; by day it is set by the daylight.
   */
  time: number;
  /** Where the engine and the drag balance, in mm/s. */
  topSpeed: number;
  /** A multiplier on the steering lock: under one turns wider, over tighter. */
  steering: number;
  /** How many trucks have a driver, not counting yours. */
  opponents: number;
}

export const DEFAULTS: Readonly<Settings> = {
  ambient: 0.035,
  flood: 5.8,
  time: 22,
  topSpeed: 2300,
  steering: 1,
  opponents: 3,
};

/** One row of the panel: which setting, what to call it, how far it goes. */
export interface Control {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  /** How to print the value beside the slider. */
  show: (v: number) => string;
}

export const CONTROLS: Control[] = [
  { key: 'ambient', label: 'ambient light', min: 0, max: 0.3, step: 0.005, show: (v) => v.toFixed(3) },
  { key: 'flood', label: 'floodlights', min: 0, max: 14, step: 0.2, show: (v) => v.toFixed(1) },
  { key: 'time', label: 'time of day', min: 0, max: 24, step: 0.25, show: clockLabel },
  { key: 'topSpeed', label: 'top speed', min: 1200, max: 3400, step: 50, show: (v) => `${v} mm/s` },
  { key: 'steering', label: 'steering', min: 0.5, max: 1.6, step: 0.05, show: (v) => `×${v.toFixed(2)}` },
  { key: 'opponents', label: 'opponents', min: 0, max: 7, step: 1, show: (v) => String(v) },
];

const KEY = 'arena.settings';

/**
 * The live values. Mutated in place by the panel and read in place by the
 * game, so there is exactly one copy.
 */
export const SETTINGS: Settings = { ...DEFAULTS, ...load() };

/** Whatever was saved last time, clamped to the ranges above; nothing if
 *  storage is unavailable or holds something that is not ours. */
function load(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Settings> = {};
    for (const c of CONTROLS) {
      const v = saved[c.key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[c.key] = Math.min(c.max, Math.max(c.min, v));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(SETTINGS)); } catch { /* a private window, or full */ }
}

export function restoreDefaults() {
  Object.assign(SETTINGS, DEFAULTS);
  save();
}
