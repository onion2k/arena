/**
 * The circuit: a closed loop the truck races round.
 *
 * It is defined in polar form, a radius that varies with the angle about the
 * middle of the arena. That is a real constraint on the shape — no hairpins
 * that double back, no figure of eight — and it buys something worth more
 * than either: the nearest point on the centreline to anywhere in the arena
 * is the point at the same angle. So how far round the lap the truck is, is
 * `atan2(y, x)`, exactly, for nothing. No search along the curve, no
 * accumulating error, and a lap line that cannot be crossed sideways.
 */

const R0 = 4200;
const WOBBLE = 700;
const KINK = 300;
const KINK_PHASE = 1.1;
/**
 * A third, faster term. Scaling a track up scales every corner with it, so a
 * circuit three times the size is three times easier to drive — this puts
 * corners back in that are tight against the truck rather than against the
 * radius of the loop.
 */
const TWIST = 440;
const TWIST_PHASE = 2.3;

/** Half the width of the tarmac. The truck is 128 across, so about five of it. */
export const TRACK_HALF = 380;

/** The radius of the centreline at an angle. */
export function radiusAt(theta: number): number {
  return R0 + WOBBLE * Math.sin(2 * theta) + KINK * Math.sin(3 * theta + KINK_PHASE)
    + TWIST * Math.sin(5 * theta + TWIST_PHASE);
}

/** How fast the radius is changing with the angle. */
function dRadius(theta: number): number {
  return 2 * WOBBLE * Math.cos(2 * theta)
    + 3 * KINK * Math.cos(3 * theta + KINK_PHASE)
    + 5 * TWIST * Math.cos(5 * theta + TWIST_PHASE);
}

/**
 * How much of a step along the radius counts as a step across the track.
 *
 * Everything here is measured radially, because that is what makes the
 * progress round the lap free. But the radius is only perpendicular to the
 * track where the track is a circle, and this one is not: where the radius is
 * changing fast the two are well apart, and a step outward along the radius
 * is mostly a step *along* the track rather than across it.
 *
 * Ignoring that put the trackside posts far closer to the racing line than
 * their 640mm said — 437mm of real clearance at the worst corner, against the
 * 176 a truck and a post need between them — and the first fast lap ended
 * jammed against one two hundred millimetres after the start.
 */
function radialToAcross(theta: number): number {
  const r = radiusAt(theta);
  return r / Math.hypot(r, dRadius(theta));
}

/** A point on the centreline. */
export function centreline(theta: number): [number, number] {
  const r = radiusAt(theta);
  return [Math.cos(theta) * r, Math.sin(theta) * r];
}

/** Which way the track runs there, as a unit vector, in the racing direction. */
export function tangentAt(theta: number): [number, number] {
  const d = 1e-3;
  const [ax, ay] = centreline(theta - d);
  const [bx, by] = centreline(theta + d);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / len, (by - ay) / len];
}

/**
 * How far round the lap a point is, 0 to 1, and how far it is from the
 * middle of the track. Off the tarmac when the offset is past TRACK_HALF.
 *
 * The angle is the progress: that is the whole reason the track is a polar
 * curve. Racing runs anticlockwise, which is the direction the angle grows.
 */
export function where(x: number, y: number): { lap: number; offset: number } {
  const theta = Math.atan2(y, x);
  const r = Math.hypot(x, y);
  return {
    lap: (theta + Math.PI) / (Math.PI * 2),
    offset: (r - radiusAt(theta)) * radialToAcross(theta),
  };
}

/** How much grip the surface gives, 1 on the tarmac and less off it. */
export function gripAt(x: number, y: number): number {
  const off = Math.abs(where(x, y).offset);
  if (off <= TRACK_HALF) return 1;
  // a shoulder that lets go over 200mm rather than at a line, so running wide
  // is a mistake that costs rather than a wall
  return 1 - 0.55 * Math.min(1, (off - TRACK_HALF) / 200);
}

/**
 * The tarmac, as slabs: a few abreast, laid along the centreline and turned
 * to follow it. Returned as triples of x, y, heading for the scene to stand
 * on the ground.
 */
export function tarmac(across: number, step: number): number[] {
  const out: number[] = [];
  const gauge = (TRACK_HALF * 2) / across;
  // walk the loop in even steps of arc rather than of angle: the radius
  // varies by a third, so even angles would bunch the slabs on the inside
  for (const theta of walk(step)) {
    const r = radiusAt(theta);
    const [tx, ty] = tangentAt(theta);
    const heading = Math.atan2(ty, tx);
    const nx = -Math.sin(theta); const ny = Math.cos(theta);
    void nx; void ny;
    // a step across the track is a longer step along the radius, by however
    // much the radius is out of square with the track here
    const perRadial = 1 / radialToAcross(theta);
    for (let i = 0; i < across; i++) {
      const d = (i - (across - 1) / 2) * gauge * perRadial;
      out.push(
        Math.cos(theta) * (r + d),
        Math.sin(theta) * (r + d),
        heading,
      );
    }
  }
  return out;
}

/** Where the posts stand: both edges of the track, evenly along it. */
export function posts(step: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  let n = 0;
  for (const theta of walk(step)) {
    const perRadial = 1 / radialToAcross(theta);
    for (const side of [-1, 1]) {
      const r = radiusAt(theta) + side * (TRACK_HALF + 260) * perRadial;
      // alternate tall and short, which is what tells the eye it is looking
      // at distance rather than at smaller posts
      out.push([Math.cos(theta) * r, Math.sin(theta) * r, n % 2 === 0 ? 1.35 : 0.95]);
    }
    n++;
  }
  return out;
}

/** Angles round the loop spaced by roughly `step` of arc length. */
function* walk(step: number): Generator<number> {
  let theta = 0;
  const end = Math.PI * 2;
  while (theta < end) {
    yield theta - Math.PI;
    // dtheta such that r·dtheta is about one step, allowing for the radius
    theta += step / Math.max(radiusAt(theta - Math.PI), 200);
  }
}

/** The total length of the centreline, and the tightest corner on it. */
export function measure(): { length: number; tightest: number } {
  let length = 0;
  let tightest = Infinity;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI;
    const b = ((i + 1) / n) * Math.PI * 2 - Math.PI;
    const [ax, ay] = centreline(a);
    const [bx, by] = centreline(b);
    length += Math.hypot(bx - ax, by - ay);
    // radius of the circle through three consecutive points
    const c = ((i + 2) / n) * Math.PI * 2 - Math.PI;
    const [cx, cy] = centreline(c);
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    if (area > 1e-9) {
      const r = (Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by)
        * Math.hypot(cx - ax, cy - ay)) / (4 * area);
      if (r < tightest) tightest = r;
    }
  }
  return { length, tightest };
}

/**
 * The starting gantry: where its post stands, and where each bulb sits on it.
 *
 * Beside the line rather than over it — a gantry across the track would be in
 * the way of a camera that looks down at the circuit from outside. The bulbs
 * face back the way the cars come, which is against the racing direction.
 */
export function gantry(): {
  post: [number, number];
  bulbs: [number, number, number][];
  facing: number;
} {
  const theta = -Math.PI;
  const r = radiusAt(theta) + TRACK_HALF + 150;
  const [tx, ty] = tangentAt(theta);
  return {
    post: [Math.cos(theta) * r, Math.sin(theta) * r],
    // stacked up the post, the lowest lighting first
    bulbs: [[0, 0, 200], [0, 0, 290], [0, 0, 380]],
    facing: Math.atan2(-ty, -tx),
  };
}
