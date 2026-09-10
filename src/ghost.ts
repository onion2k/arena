/**
 * The ghost: your own best lap, driving the circuit beside you.
 *
 * There were three rivals here with a driving model of their own. They were
 * competent and they were not interesting: a driver who is always about as
 * quick as you gives you someone to bump into, and what a circuit this size
 * actually asks is whether you took the last corner better than you did last
 * time. So the field is gone and what runs beside you now is a recording of
 * the best lap you have driven — which is a harder opponent than the AI was,
 * gets harder exactly as fast as you do, and never blocks the road.
 *
 * It is a recording and not a simulation. Twice a second of physics is more
 * than the eye can hold, so a pose goes down thirty times a second — where
 * the body was, which way it was pointing, and what each wheel was doing —
 * and the replay reads between two of them. Nothing is re-driven: a ghost
 * cannot bounce off a post it hit last lap, because it is not there.
 *
 * The recording starts at a line crossing, never at the grid, which is why
 * no ghost appears until the second lap is done. A lap begun from a standing
 * start is not a lap you can compare against, and one recorded from the grid
 * runs its lap fraction backwards through the line before it starts — which
 * is fine for driving and useless for the one thing the fraction is for,
 * which is saying where the ghost was when you were here.
 */

/** The part of a truck a ghost has to carry to be drawn as one. */
export interface Pose {
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  wheels: { drop: number; steer: number; spin: number }[];
}

/** Floats a sample takes: time and lap fraction, the body's six, three a wheel. */
const STRIDE = 2 + 6 + 4 * 3;
/** Seconds between samples. A lap is fourteen, so a good one is 420 of them. */
const EVERY = 1 / 30;
/** Two minutes of it: far more than a lap anyone will finish. */
const CAPACITY = Math.ceil(120 / EVERY);

const TWO_PI = Math.PI * 2;
/** Between two angles the short way round, which is how a heading blends. */
function turnTo(a: number, b: number, t: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

export class Ghost {
  /** The lap being driven now, and how many samples of it are down. */
  private live = new Float32Array(CAPACITY * STRIDE);
  private liveCount = 0;
  /** The best lap kept, its samples, and what it took. */
  private best: Float32Array | null = null;
  private bestCount = 0;
  private bestTime = Infinity;
  private clock = 0;
  private since = 0;
  /** Scratch, handed back by `poseAt`: one object, rewritten every frame. */
  private out: Pose = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
    wheels: [0, 1, 2, 3].map(() => ({ drop: 0, steer: 0, spin: 0 })),
  };

  /** Whether there is a lap to run beside you yet. */
  get has(): boolean { return this.best !== null; }
  /** What the kept lap took, or null before there is one. */
  get lap(): number | null { return this.best === null ? null : this.bestTime; }

  /** A fresh recording. Called on a line crossing and nowhere else. */
  begin() {
    this.liveCount = 0;
    this.clock = 0;
    // so the first step of the lap lays down a sample rather than waiting
    this.since = EVERY;
  }

  /** One step of the lap you are driving. */
  record(dt: number, t: Pose, at: number) {
    this.clock += dt;
    this.since += dt;
    if (this.since < EVERY || this.liveCount >= CAPACITY) return;
    this.since -= EVERY;
    const d = this.live;
    const o = this.liveCount * STRIDE;
    d[o] = this.clock; d[o + 1] = at;
    d[o + 2] = t.x; d[o + 3] = t.y; d[o + 4] = t.z;
    d[o + 5] = t.yaw; d[o + 6] = t.pitch; d[o + 7] = t.roll;
    for (let i = 0; i < 4; i++) {
      const w = t.wheels[i];
      const p = o + 8 + i * 3;
      d[p] = w.drop; d[p + 1] = w.steer; d[p + 2] = w.spin;
    }
    this.liveCount++;
  }

  /**
   * The lap just ended, and took this long. Kept only if it beats what is
   * held — so the ghost is the best lap it has seen, which after a standing
   * start is never the first one.
   */
  finish(time: number) {
    if (this.liveCount < 2 || time >= this.bestTime) return;
    const n = this.liveCount * STRIDE;
    const keep = new Float32Array(n);
    keep.set(this.live.subarray(0, n));
    this.best = keep;
    this.bestCount = this.liveCount;
    this.bestTime = time;
  }

  /** Nothing recorded and nothing kept: a new session on the same page. */
  clear() {
    this.best = null; this.bestCount = 0; this.bestTime = Infinity;
    this.begin();
  }

  /** The sample at or before `value` in column `col`, by bisection. */
  private find(col: number, value: number): number {
    const d = this.best!;
    let lo = 0, hi = this.bestCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (d[mid * STRIDE + col] <= value) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Where the ghost is `t` seconds into its lap, or null before there is a
   * lap or after it has finished the one it has. Read between the two
   * samples either side, so a thirty-a-second recording plays back as smooth
   * as the frame it is drawn in.
   */
  poseAt(t: number): Pose | null {
    if (this.best === null || t < 0 || t > this.bestTime) return null;
    const d = this.best;
    const i = this.find(0, t);
    const j = Math.min(i + 1, this.bestCount - 1);
    const a = i * STRIDE, b = j * STRIDE;
    const span = d[b] - d[a];
    const k = span > 1e-6 ? Math.min(1, Math.max(0, (t - d[a]) / span)) : 0;
    const mix = (o: number) => d[a + o] + (d[b + o] - d[a + o]) * k;
    const o = this.out;
    o.x = mix(2); o.y = mix(3); o.z = mix(4);
    o.yaw = turnTo(d[a + 5], d[b + 5], k);
    o.pitch = mix(6); o.roll = mix(7);
    for (let w = 0; w < 4; w++) {
      const p = 8 + w * 3;
      o.wheels[w].drop = mix(p);
      o.wheels[w].steer = mix(p + 1);
      o.wheels[w].spin = turnTo(d[a + p + 2], d[b + p + 2], k);
    }
    return o;
  }

  /**
   * How far behind the ghost you are, in seconds, at the point of the lap
   * you have reached: positive means it got here sooner than you did. Null
   * until there is a lap to compare with.
   *
   * By lap fraction and not by time, because that is the question — at this
   * corner, was I quicker? Comparing at the same *time* would say where each
   * of you had got to, which is the same information read the hard way.
   */
  deltaAt(at: number, lapTime: number): number | null {
    if (this.best === null || this.bestCount < 2) return null;
    const d = this.best;
    // before the ghost's first sample it has no time here to compare
    if (at < d[1]) return null;
    const i = this.find(1, at);
    const j = Math.min(i + 1, this.bestCount - 1);
    const a = i * STRIDE, b = j * STRIDE;
    const span = d[b + 1] - d[a + 1];
    const k = span > 1e-6 ? Math.min(1, Math.max(0, (at - d[a + 1]) / span)) : 0;
    const its = d[a] + (d[b] - d[a]) * k;
    return lapTime - its;
  }
}
