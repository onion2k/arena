/**
 * The time of day, as everything the sky does to the arena.
 *
 * One number in, hours round the clock, and out comes where the sun is, what
 * colour it is, how much the sky lights everything, what the sky itself
 * looks like, and whether the street lights are on. The renderer has no
 * notion of any of this — it has a directional light, an ambient, and a
 * background — so this is the place where a clock turns into those three.
 *
 * The sun in the renderer is a specular light only: it puts a highlight on
 * things and does not otherwise light them. What lights the ground by day is
 * the environment, through `ambient`, and the environment is baked once for
 * the day and once for the night and swapped at dawn and dusk. So "daylight"
 * here is mostly a large ambient against a bright sky, with the sun on top
 * for the glints, and that is what a bright overcast-to-clear day is.
 */

export interface Sky {
  /** Toward the light. Unit length. */
  sunDir: [number, number, number];
  sunColour: [number, number, number];
  /** How much the environment lights everything. */
  ambient: number;
  background: [number, number, number];
  /** The street lights and headlights, 1 on to 0 off, with a fade between. */
  lampsOn: number;
  /** How far into day it is, 0 at night to 1 in full daylight. */
  day: number;
}

/**
 * The moon: dim and cold, from a fixed place in the sky. This was the sun
 * before there was a day — see the settings, where it was "moonlight" — and
 * it is what the night is lit by when the floods and the ambient are off.
 */
const MOON_DIR: [number, number, number] = [0.34, 0.52, 0.78];
const MOONLIGHT: [number, number, number] = [0.040, 0.052, 0.092];

/** The sun at noon: from the same quarter as the moon, higher. */
const NOON_AZIMUTH = Math.atan2(MOON_DIR[1], MOON_DIR[0]);
const NOON_ELEVATION = 1.15;
/** Full daylight, and the warm version of it at the horizon. */
const DAY_SUN: [number, number, number] = [1.9, 1.75, 1.45];
const DAWN_SUN: [number, number, number] = [1.8, 0.85, 0.40];
/**
 * How much the environment lights everything at noon. It is most of what
 * daylight is here, because the renderer's sun is a highlight and not a
 * lamp: at 0.62 the arena at noon measured a frame-wide mean of 59 against
 * 54 at night, an overcast afternoon at best. 1.0 is a day.
 */
const DAY_AMBIENT = 1.0;
const DAY_SKY: [number, number, number] = [0.40, 0.56, 0.84];
const DAWN_SKY: [number, number, number] = [0.46, 0.34, 0.30];
const NIGHT_SKY: [number, number, number] = [0.006, 0.011, 0.026];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Where the sun is as a fraction of the way up: -1 at midnight, 0 at six and
 * eighteen, 1 at noon. A sine of the hour, which is what a sun does.
 */
export function elevationAt(hours: number): number {
  return Math.sin((Math.PI * (hours - 6)) / 12);
}

export function skyAt(hours: number, nightAmbient: number): Sky {
  const e = elevationAt(hours);
  // Day comes in as the sun clears the horizon and is full by the time it is
  // a fifth of the way up. Below the horizon it is night, and the sun's
  // colour is the moon's.
  const day = smooth(-0.04, 0.22, e);
  // The lamps go off a little after the sun is up and come on a little
  // before it is down: a street light that was still on at noon would be
  // wrong, and one that waited for full dark would be too.
  const lampsOn = 1 - smooth(0.0, 0.14, e);
  // warm near the horizon, white once it is up
  const warm = 1 - smooth(0.02, 0.35, e);

  let sunDir: [number, number, number];
  if (e > 0) {
    // east at six, through the moon's quarter at noon, to west at eighteen
    const az = NOON_AZIMUTH + (Math.PI / 2) * ((12 - hours) / 6);
    const el = NOON_ELEVATION * e;
    sunDir = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
  } else {
    sunDir = MOON_DIR;
  }
  const daySun = mix(DAY_SUN, DAWN_SUN, warm);
  const sunColour = mix(MOONLIGHT, daySun, day);
  const daySky = mix(DAY_SKY, DAWN_SKY, warm);
  const background = mix(NIGHT_SKY, daySky, day);
  const ambient = nightAmbient + (DAY_AMBIENT - nightAmbient) * day;
  return { sunDir, sunColour, ambient, background, lampsOn, day };
}

/** The clock as a label: "22:00", "06:15". */
export function clockLabel(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.round((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
