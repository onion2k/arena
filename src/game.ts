/**
 * The race: a truck, a circuit, and a clock.
 *
 * What was here was an arena shooter — a crowd of drones, a gun that aimed
 * itself, waves, lives, a score. All of it is gone. What it was standing on
 * turned out to be the interesting part: a vehicle with suspension and tyres
 * on ground that is not flat. So the drones went and the lap counter arrived,
 * and this file is a tenth of what it was.
 */
import { ARENA_X, ARENA_Y, COLUMN_RADIUS, COLUMNS } from './scene';
import { Vehicle } from './vehicle';
import { START_BULBS, radiusAt, tangentAt, where } from './track';

/** How long the lights hold you before the lap starts. */
export const COUNTDOWN = 4;


/** How much of its speed the truck keeps when it meets a wall or a post. */
const BOUNCE = 0.45;
/**
 * How wide the truck is for the purpose of not being inside a post. It is
 * 250 long and 128 across, so no one circle is right; this is between the
 * two, which keeps a corner from visibly sinking into a post without making
 * the gaps between them feel narrower than they look.
 */
const TRUCK_RADIUS = 98;

/** What the driver is asking for. */
export interface Input {
  /** -1 to 1: steering. Not a rate of turn — the front wheels point there. */
  turn: number;
  throttle: number;
  brake: number;
}

export class Race {
  readonly truck = new Vehicle(0, 0);

  get px() { return this.truck.x; }
  get py() { return this.truck.y; }
  get pz() { return this.truck.z; }
  get pAngle() { return this.truck.yaw; }
  get speed() { return this.truck.speed; }
  get airborne() { return this.truck.airborne; }
  get slide() { return this.truck.slide; }
  get thrusting() { return this.truck.throttle; }
  get braking() { return this.truck.braking; }
  get wheelSpin() { return this.truck.wheels[0].spin; }

  /** Laps completed. */
  laps = 0;
  /** Seconds since the line, or since the truck first moved. */
  lapTime = 0;
  /** The last lap and the best one, in seconds. Null until there has been one. */
  lastLap: number | null = null;
  bestLap: number | null = null;
  /** True once the lights have gone out and the clock is running. */
  running = false;
  /**
   * Seconds left on the lights. The truck is held on the line while this is
   * above zero, and the clock does not start until it reaches it — a lap
   * timed from the moment the page happened to finish loading is not a lap
   * time.
   */
  countdown = COUNTDOWN;
  /** Seconds since the lights went out, for the flash to fade on. */
  sinceStart = 0;

  /**
   * How many bulbs are lit, then all out on the go. Spread over the countdown
   * rather than one a second: with five bulbs and a three second count, only
   * three of them ever lit.
   */
  get bulbsLit(): number {
    if (this.countdown <= 0) return 0;
    const through = (COUNTDOWN - this.countdown) / COUNTDOWN;
    return Math.min(START_BULBS, 1 + Math.floor(through * START_BULBS));
  }
  /** How far round the lap it is, 0 to 1, and how far off the middle. */
  progress = 0;
  offset = 0;

  /**
   * Whether it has been round the far side since the line. Without this a
   * truck sitting on the start line with its nose over it counts a lap every
   * time it rocks, and reversing over the line counts one every time.
   */
  private wentHalfway = false;
  private lastProgress = 0;

  constructor() { this.reset(); }

  step(dt: number, input: Input) {
    if (this.countdown > 0) {
      // Held on the line: the wheels are still driven by the same code, with
      // the brake on and no throttle, so the truck settles on its springs
      // where it stands rather than being frozen and dropped at the go.
      this.countdown -= dt;
      this.truck.step(dt, { steer: input.turn, throttle: 0, brake: 0, hold: true });
      this.keepInside();
      if (this.countdown <= 0) { this.countdown = 0; this.running = true; this.lapTime = 0; }
      return;
    }
    this.sinceStart += dt;
    this.truck.step(dt, { steer: input.turn, throttle: input.throttle, brake: input.brake });
    this.keepInside();
    this.timeLap(dt);
  }

  private timeLap(dt: number) {
    const w = where(this.truck.x, this.truck.y);
    this.progress = w.lap;
    this.offset = w.offset;

    this.lapTime += dt;

    if (w.lap > 0.35 && w.lap < 0.65) this.wentHalfway = true;
    // a crossing is a jump between the ends of the range rather than a step
    // through it: the progress is an angle, and it wraps
    const forward = this.lastProgress > 0.75 && w.lap < 0.25;
    const backward = this.lastProgress < 0.25 && w.lap > 0.75;
    if (forward && this.wentHalfway) {
      this.laps += 1;
      this.lastLap = this.lapTime;
      if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
      this.lapTime = 0;
      this.wentHalfway = false;
    } else if (backward) {
      // went back over the line: un-count it rather than let it be farmed
      this.wentHalfway = false;
    }
    this.lastProgress = w.lap;
  }

  /**
   * The walls and the posts, applied to the truck after it has moved.
   *
   * Still a circle against circles in plan, which is the right amount of
   * collision for this: the truck cannot leave the floor sideways and the
   * posts are round. It is pushing a body with momentum and a spin rather
   * than a dot, so a glancing hit turns it.
   */
  private keepInside() {
    const t = this.truck;
    const limX = ARENA_X - 110;
    const limY = ARENA_Y - 110;
    if (t.x < -limX) { t.x = -limX; t.vx = Math.abs(t.vx) * BOUNCE; }
    if (t.x > limX) { t.x = limX; t.vx = -Math.abs(t.vx) * BOUNCE; }
    if (t.y < -limY) { t.y = -limY; t.vy = Math.abs(t.vy) * BOUNCE; }
    if (t.y > limY) { t.y = limY; t.vy = -Math.abs(t.vy) * BOUNCE; }

    for (const [cx, cy, scale] of COLUMNS) {
      const dx = t.x - cx;
      const dy = t.y - cy;
      const reach = COLUMN_RADIUS * scale + TRUCK_RADIUS;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d; const ny = dy / d;
      t.x = cx + nx * reach;
      t.y = cy + ny * reach;
      const into = t.vx * nx + t.vy * ny;
      if (into < 0) {
        t.vx -= into * (1 + BOUNCE) * nx;
        t.vy -= into * (1 + BOUNCE) * ny;
        // a corner clipped off a post turns the truck as well as stopping it
        t.wYaw += (nx * t.vy - ny * t.vx) * 4e-4;
      }
    }
  }

  /** Back to the line, facing the way the track runs, with the clock stopped. */
  reset() {
    // Facing along the tangent, and not along a guess. The line is at the
    // angle -pi, where the track runs toward -y, and a hardcoded +y put the
    // truck on the grid pointing the wrong way down the circuit.
    const [sx, sy] = startLine();
    const [tx, ty] = tangentAt(-Math.PI);
    this.truck.reset(sx, sy, Math.atan2(ty, tx));
    this.laps = 0; this.lapTime = 0;
    this.lastLap = null; this.bestLap = null;
    this.running = false; this.wentHalfway = false;
    this.countdown = COUNTDOWN; this.sinceStart = 0;
    this.lastProgress = where(sx, sy).lap;
  }
}

/** Where the start line is: on the centreline at progress zero. */
export function startLine(): [number, number] {
  const theta = -Math.PI;
  return [Math.cos(theta) * radiusAt(theta), Math.sin(theta) * radiusAt(theta)];
}
