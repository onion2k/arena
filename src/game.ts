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
import { SKILLS, driveRound, type Skill } from './racer';
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
  /** The handbrake: a slide you asked for. */
  handbrake?: boolean;
}

/**
 * Where a car has got to, and how long its laps took. One of these per car,
 * so the running order is a question about numbers rather than about which
 * one happens to be the player.
 */
export class Progress {
  laps = 0;
  lapTime = 0;
  lastLap: number | null = null;
  bestLap: number | null = null;
  /** How far round the lap it is, 0 to 1, and how far off the middle. */
  at = 0;
  offset = 0;
  private wentHalfway = false;
  private last = 0;

  /** Laps plus the part-lap, which is what the running order is sorted on. */
  get total(): number { return this.laps + this.at; }

  reset(x: number, y: number) {
    this.laps = 0; this.lapTime = 0;
    this.lastLap = null; this.bestLap = null;
    this.wentHalfway = false;
    this.at = where(x, y).lap;
    this.last = this.at;
  }

  update(dt: number, x: number, y: number, running: boolean) {
    const w = where(x, y);
    this.at = w.lap; this.offset = w.offset;
    if (!running) { this.last = w.lap; return; }
    this.lapTime += dt;
    if (w.lap > 0.35 && w.lap < 0.65) this.wentHalfway = true;
    // a crossing is a jump between the ends of the range rather than a step
    // through it: the progress is an angle, and it wraps
    const forward = this.last > 0.75 && w.lap < 0.25;
    const backward = this.last < 0.25 && w.lap > 0.75;
    if (forward && this.wentHalfway) {
      this.laps += 1;
      this.lastLap = this.lapTime;
      if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
      this.lapTime = 0;
      this.wentHalfway = false;
    } else if (backward) {
      this.wentHalfway = false;
    }
    this.last = w.lap;
  }
}

/** One car in the race. The player is the first; the rest have a driver. */
export interface Car {
  vehicle: Vehicle;
  lap: Progress;
  colour: [number, number, number];
  skill: Skill | null;
}

/** How many cars line up, the player included. */
export const FIELD = 4;

const PAINT: [number, number, number][] = [
  [1.0, 0.79, 0.36],   // the player: gold, as it always was
  [0.35, 0.62, 1.0],
  [1.0, 0.30, 0.26],
  [0.42, 0.95, 0.55],
];

export class Race {
  readonly cars: Car[] = PAINT.slice(0, FIELD).map((colour, i) => ({
    vehicle: new Vehicle(0, 0),
    lap: new Progress(),
    colour,
    skill: i === 0 ? null : SKILLS[(i - 1) % SKILLS.length],
  }));

  /** The player's, which is the first of them. */
  get truck() { return this.cars[0].vehicle; }

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

  get laps() { return this.cars[0].lap.laps; }
  get lapTime() { return this.cars[0].lap.lapTime; }
  get lastLap() { return this.cars[0].lap.lastLap; }
  get bestLap() { return this.cars[0].lap.bestLap; }
  get progress() { return this.cars[0].lap.at; }
  get offset() { return this.cars[0].lap.offset; }

  /**
   * Where the player is running, counting from one. Sorted on laps plus the
   * part lap, so it is right the moment anyone crosses anything.
   */
  get position(): number {
    const mine = this.cars[0].lap.total;
    return 1 + this.cars.filter((c) => c.lap.total > mine).length;
  }
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
  constructor() { this.reset(); }

  step(dt: number, input: Input) {
    if (this.countdown > 0) {
      // Everyone is held on the line, the player and the field alike: the
      // wheels are still driven by the same code, with the handbrake on, so
      // each car settles on its springs where it stands rather than being
      // frozen and dropped at the go.
      this.countdown -= dt;
      for (const c of this.cars) {
        c.vehicle.step(dt, { steer: 0, throttle: 0, brake: 0, hold: true });
        c.lap.update(dt, c.vehicle.x, c.vehicle.y, false);
      }
      this.keepInside();
      if (this.countdown <= 0) { this.countdown = 0; this.running = true; }
      return;
    }
    this.sinceStart += dt;

    const all = this.cars.map((c) => c.vehicle);
    for (const c of this.cars) {
      const drive = c.skill === null
        ? { steer: input.turn, throttle: input.throttle, brake: input.brake, handbrake: input.handbrake }
        : driveRound(c.vehicle, c.skill, all);
      c.vehicle.step(dt, drive);
    }
    this.keepInside();
    for (const c of this.cars) c.lap.update(dt, c.vehicle.x, c.vehicle.y, true);
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
    for (const c of this.cars) this.keepOneInside(c.vehicle);
    this.keepApart();
  }

  /**
   * Cars against each other: pushed apart and their closing speed exchanged.
   *
   * Not a real impulse — no spin, no mass, nothing conserved — but it is
   * enough that a car cannot be driven through, and being leaned on in a
   * corner costs you the corner.
   */
  private keepApart() {
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i].vehicle, b = this.cars[j].vehicle;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const reach = TRUCK_RADIUS * 1.6;
        if (d2 >= reach * reach || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const overlap = (reach - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (closing < 0) {
          const push = closing * 0.55;
          a.vx += push * nx; a.vy += push * ny;
          b.vx -= push * nx; b.vy -= push * ny;
          a.wYaw -= 3e-4 * closing; b.wYaw += 3e-4 * closing;
        }
      }
    }
  }

  private keepOneInside(t: Vehicle) {
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

  /**
   * Everyone back to the grid, in a staggered pair of columns behind the
   * line, with the clock stopped and the lights counting again.
   */
  reset() {
    // Facing along the tangent, and not along a guess. The line is at the
    // angle -pi, where the track runs toward -y, and a hardcoded +y put the
    // truck on the grid pointing the wrong way down the circuit.
    const [tx, ty] = tangentAt(-Math.PI);
    const yaw = Math.atan2(ty, tx);
    this.cars.forEach((c, i) => {
      // back down the road in pairs, alternating sides, the player at the front
      const back = Math.floor(i / 2) * 460 + 90;
      const side = (i % 2 === 0 ? -1 : 1) * 150;
      const x = Math.cos(-Math.PI) * radiusAt(-Math.PI) - tx * back - ty * side;
      const y = Math.sin(-Math.PI) * radiusAt(-Math.PI) - ty * back + tx * side;
      c.vehicle.reset(x, y, yaw);
      c.lap.reset(x, y);
    });
    this.running = false;
    this.countdown = COUNTDOWN; this.sinceStart = 0;
  }
}

/** Where the start line is: on the centreline at progress zero. */
export function startLine(): [number, number] {
  const theta = -Math.PI;
  return [Math.cos(theta) * radiusAt(theta), Math.sin(theta) * radiusAt(theta)];
}
