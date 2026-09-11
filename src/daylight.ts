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
 * the day and once for the night and swapped while the sky is still dark.
 * So "daylight" here is mostly a large ambient against a bright sky, with
 * the sun on top for the glints, and that is what a bright day is.
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
  /**
   * How much there is in the air, 0 to 1: the dawn mist where there is one,
   * and otherwise a thin haze for as long as the lamps are on, so that they
   * have something to throw a cone through. See `mistAt` and `NIGHT_HAZE`.
   */
  mist: number;
}

/**
 * Mist at dawn.
 *
 * Ground fog is a dawn thing for a reason. The ground loses heat all night
 * and by the small hours it is colder than the air over it; the air against
 * it cools to its dew point and the water in it comes out as mist, which
 * lies in the low ground because cold air is heavy and runs downhill. Then
 * the sun comes up and burns it off within an hour or two. So it thickens
 * through the last of the night, is at its worst just as the sun clears the
 * horizon — which is also when the light is nearly horizontal and rakes
 * through the trees — and is gone by the middle of the morning.
 *
 * Evening is deliberately clear. Mist does form at dusk over water, but the
 * ground is still warm and it is a fraction of what dawn gives you; two
 * mists a lap would make the effect ordinary.
 */
/**
 * How much haze there is whenever the street lights are on, as a fraction of
 * the dawn mist.
 *
 * Not weather: air. A clear night still has enough in it to show a beam —
 * that is what a beam is, light bouncing off what is there — and without it
 * every lamp in the arena is a bright head over a lit patch of road with
 * nothing in between. A third of the dawn mist is thin enough that you can
 * see the far side of the circuit through it and thick enough that the lamps
 * and the headlights have cones.
 */
const NIGHT_HAZE = 0.3;

export function mistAt(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  // up from two o'clock, full from half four to seven, gone by half nine
  return smooth(2, 4.5, h) * (1 - smooth(7, 9.5, h));
}

/**
 * The sky as keyframes over the sun's height, -1 at midnight to 1 at noon.
 *
 * It was two states with an hour of blend between them, and it looked like
 * a switch: noon was 09:00 was 16:00, 22:00 was 03:00, and the whole of
 * dawn was over in a third of a lap. A day is not two states. It is a deep
 * night that lifts before the sun, a horizon that goes orange while the
 * lamps are still on, a golden hour, a cool bright morning, a noon, and all
 * of that again backwards and redder in the evening — so it is a table, and
 * the hour reads along it.
 *
 * Each row is a height of the sun, and the values are blended between rows
 * with a smoothstep so nothing kinks. The moon is in here too: below the
 * horizon the "sun" is the moon, dim and cold, and it crosses the sky
 * opposite the sun so the glint on the road moves through the night.
 */
interface Key {
  e: number;
  sun: [number, number, number];
  ambient: number;
  sky: [number, number, number];
}

const KEYS: Key[] = [
  { e: -1.00, sun: [0.040, 0.052, 0.092], ambient: 0.035, sky: [0.006, 0.011, 0.026] },   // midnight
  { e: -0.45, sun: [0.040, 0.052, 0.092], ambient: 0.040, sky: [0.008, 0.013, 0.032] },   // small hours
  { e: -0.18, sun: [0.055, 0.070, 0.140], ambient: 0.090, sky: [0.030, 0.045, 0.110] },   // the sky lifts
  { e: -0.06, sun: [0.30, 0.20, 0.22], ambient: 0.20, sky: [0.16, 0.14, 0.26] },          // first light
  { e: 0.00, sun: [1.50, 0.52, 0.18], ambient: 0.32, sky: [0.60, 0.33, 0.20] },           // the sun on the horizon
  { e: 0.12, sun: [1.85, 0.95, 0.42], ambient: 0.50, sky: [0.62, 0.50, 0.46] },           // golden
  { e: 0.30, sun: [1.90, 1.45, 0.95], ambient: 0.72, sky: [0.50, 0.58, 0.76] },           // morning
  { e: 0.60, sun: [1.90, 1.72, 1.40], ambient: 0.88, sky: [0.42, 0.57, 0.84] },           // late morning
  { e: 1.00, sun: [1.90, 1.80, 1.55], ambient: 1.00, sky: [0.36, 0.55, 0.88] },           // noon
];

/** The evening is the morning played backwards, but redder and a touch
 *  darker: dust and a long day. Applied to the sun and the sky by how far
 *  through the afternoon it is, most at the horizon. */
const EVENING_TINT: [number, number, number] = [1.06, 0.88, 0.80];

/** How far the sun is up, in radians, at the top of its arc. */
const NOON_ELEVATION = 1.15;
/** The sun and the moon both cross through this quarter of the sky at their
 *  highest — the quarter the fixed moon used to sit in. */
const NOON_AZIMUTH = Math.atan2(0.52, 0.34);

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

/** The row above and below a height of the sun, and how far between them. */
function keyed(e: number): { a: Key; b: Key; t: number } {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].e <= e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  return { a, b, t: smooth(a.e, b.e, e) };
}

/** A light's direction at an hour: east at six, up through NOON_AZIMUTH at
 *  twelve, west at eighteen — for the sun, or for the moon twelve hours on. */
function arc(hours: number, e: number): [number, number, number] {
  const az = NOON_AZIMUTH + (Math.PI / 2) * ((12 - hours) / 6);
  const el = NOON_ELEVATION * Math.max(0.05, e);
  return [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
}

/**
 * `tint` and `ambientScale` are the biome's say over an otherwise shared sky:
 * a warm multiply for a desert, a cold bright one for snow, nothing at all
 * for the forest the table was built against. One table and a tint over it
 * rather than a table per biome, because the nine rows above encode a dawn
 * arc that was tuned by eye against real timings, and four more tables would
 * be thirty-six rows of colour with nothing to check them against.
 */
export function skyAt(hours: number, nightAmbient: number, tint: [number, number, number] = [1, 1, 1], ambientScale = 1): Sky {
  const h = ((hours % 24) + 24) % 24;
  const e = elevationAt(h);
  const { a, b, t } = keyed(e);
  let sun = mix(a.sun, b.sun, t);
  let sky = mix(a.sky, b.sky, t);
  let ambient = (a.ambient + (b.ambient - a.ambient) * t) * ambientScale;
  const day = smooth(-0.06, 0.30, e);
  // the table's night floor is 0.035; the slider moves it, and its say
  // fades out as the day comes in
  ambient += (nightAmbient - KEYS[0].ambient) * (1 - day);

  // the evening, redder than the morning, most so near the horizon
  if (h > 12) {
    const near = 1 - smooth(0.05, 0.6, e);
    const k = 0.35 + 0.65 * near;
    const tint: [number, number, number] = [1 + (EVENING_TINT[0] - 1) * k, 1 + (EVENING_TINT[1] - 1) * k, 1 + (EVENING_TINT[2] - 1) * k];
    sun = [sun[0] * tint[0], sun[1] * tint[1], sun[2] * tint[2]];
    sky = [sky[0] * tint[0], sky[1] * tint[1], sky[2] * tint[2]];
  }

  // The sun by day and the moon by night, each crossing the sky; through the
  // horizon the direction is blended so the glint on the road slides from
  // one to the other rather than jumping.
  const sunDir = arc(h, e);
  const moonDir = arc((h + 12) % 24, -e);
  const toSun = smooth(-0.08, 0.04, e);
  const d = mix(moonDir, sunDir, toSun);
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const dir: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];

  // The lamps stay on through the sunrise, while the horizon is orange, and
  // go out in the golden hour; and come on again as the sun goes down
  // rather than waiting for the dark. Above a fifth of the way up, off.
  const lampsOn = 1 - smooth(0.04, 0.22, e);
  sun = [sun[0] * tint[0], sun[1] * tint[1], sun[2] * tint[2]];
  sky = [sky[0] * tint[0], sky[1] * tint[1], sky[2] * tint[2]];
  return { sunDir: dir, sunColour: sun, ambient, background: sky, lampsOn, day, mist: Math.max(mistAt(h), lampsOn * NIGHT_HAZE) };
}

/** The clock as a label: "22:00", "06:15". */
export function clockLabel(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.round((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
