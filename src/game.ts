/**
 * The race: a truck, a circuit, and a clock.
 *
 * What was here was an arena shooter — a crowd of drones, a gun that aimed
 * itself, waves, lives, a score. All of it is gone. What it was standing on
 * turned out to be the interesting part: a vehicle with suspension and tyres
 * on ground that is not flat. So the drones went and the lap counter arrived,
 * and this file is a tenth of what it was.
 *
 * There were three rivals here after that, with a driving model of their own
 * to work them. They were competent and they did not add much: a driver who
 * is always about as quick as you gives you something to bump into, and the
 * question a circuit this size actually asks is whether you took the last
 * corner better than you took it last time. Both are gone, and what runs
 * beside you is your own best lap: see `ghost.ts`.
 */
import { ARENA_X, ARENA_Y, COLUMN_RADIUS, COLUMNS } from './scene';
import { Vehicle, type VehicleSpec } from './vehicle';
import { VEHICLES } from './vehicles';
import { Ghost } from './ghost';
import { SETTINGS } from './settings';
import { PROPS } from './flora';
import { BOLLARDS, RAILS, RAIL_DEEP } from './furniture';
import { START_BULBS, radiusAt, tangentAt, where } from './track';
import type { CircleGrid } from './spatial';

/** How long the lights hold you before the lap starts. */
export const COUNTDOWN = 4;


/** How much of its speed the truck keeps when it meets a wall or a post. */
const BOUNCE = 0.45;

/**
 * Every lamp post, tree and bollard, in one grid, so `keepOneInside` can ask
 * "what is near the truck" instead of scanning every one of them. Rebuilt by
 * `useTrack` whenever the circuit does, since all three lists move with it.
 * Null only for the first instant before that has happened once, in which
 * case the truck is not near anything worth checking against yet.
 */
let collisionGrid: CircleGrid | null = null;
export function setCollisionGrid(grid: CircleGrid) { collisionGrid = grid; }
/** The widest reach worth asking the grid for: a post or a tree plus a vehicle. */
const COLLISION_REACH = 260;

/** What the driver is asking for. */
export interface Input {
  /** -1 to 1: steering. Not a rate of turn — the front wheels point there. */
  turn: number;
  throttle: number;
  brake: number;
  /** The handbrake: a slide you asked for. */
  handbrake?: boolean;
}

/** Where the truck has got to, and how long its laps have taken. */
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
  /**
   * How far it has driven since the grid, in laps, continuously: the sum of
   * every step round the loop, forwards counting up and backwards down. Not
   * `total`, which is an angle plus a count and dips at the line — the grid
   * sits just short of it, so `total` starts near one and falls to nothing
   * as the car crosses — and the clock wants something that only ever runs
   * on.
   */
  driven = 0;

  reset(x: number, y: number) {
    this.laps = 0; this.lapTime = 0; this.driven = 0;
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
    // the step round the loop this frame, taken the short way round
    let step = w.lap - this.last;
    if (step > 0.5) step -= 1; else if (step < -0.5) step += 1;
    this.driven += step;
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

/**
 * How many trucks can be on the road at once: you and your ghost. Every pool
 * that holds one — matrices, lamps, dots on the map — is sized to this, and
 * the second is only drawn once there is a lap to draw it from.
 */
export const TRUCKS = 2;

/** The paint: yours, and the ghost's. */
export const PAINT: [number, number, number][] = [
  [1.0, 0.79, 0.36],   // the player: gold, as it always was
  // The ghost is a cold pale blue and deliberately not a colour a truck is
  // painted. There is no transparency in this renderer, so it cannot be the
  // see-through thing a ghost usually is; what makes it read as a recording
  // rather than as a rival is that it is lit like ice and carries no lamps.
  [0.62, 0.78, 0.95],
];

/**
 * How fast the day goes by: three hours of sky for every lap of the road.
 * A lap is fourteen seconds, so a race of eight is a full day, and the field
 * that sets off under street lights finishes under the sun.
 */
export const HOURS_PER_LAP = 3;

export class Race {
  truck: Vehicle = new Vehicle(VEHICLES.technical, 0, 0);
  readonly lap = new Progress();
  /** Your best lap, kept and replayed: see `ghost.ts`. */
  readonly ghost = new Ghost();

  constructor() { this.reset(); }

  /**
   * Change what you are driving. A new `Vehicle` and not a spec swapped into
   * the old one: the wheel count, the inertia and the collision radius all
   * come from the spec at construction, and a body mid-corner does not want
   * to discover its own suspension travel changed under it. The ghost goes
   * with it — a best lap belongs to the class it was driven in as much as to
   * the circuit, and a rally car's ghost drawn as an F1 car's meshes is not
   * a bug you would report, it is a bug you would stop trusting the ghost
   * over. See `newTrack` in `main.ts` for the same argument about the road.
   */
  useVehicle(spec: VehicleSpec) {
    this.truck = new Vehicle(spec, 0, 0);
    this.ghost.clear();
    this.reset();
  }

  /**
   * What time it is: the setting is when the race starts, and the clock runs
   * on from there with the player's own progress — not with the wall clock,
   * so a driver who stops to look at the forest does not watch it dawn.
   */
  get hours(): number {
    const driven = Math.max(0, this.lap.driven);
    return (SETTINGS.time + driven * HOURS_PER_LAP) % 24;
  }

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

  get laps() { return this.lap.laps; }
  get lapTime() { return this.lap.lapTime; }
  get lastLap() { return this.lap.lastLap; }
  get bestLap() { return this.lap.bestLap; }
  get progress() { return this.lap.at; }
  get offset() { return this.lap.offset; }

  /**
   * How far behind your own best lap you are at this point of the circuit,
   * in seconds, or null until there is one to be behind.
   */
  get delta(): number | null {
    if (!this.running) return null;
    return this.ghost.deltaAt(this.lap.at, this.lap.lapTime);
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
  step(dt: number, input: Input) {
    if (this.countdown > 0) {
      // Held on the line: the wheels are still driven by the same code, with
      // the handbrake on, so the truck settles on its springs where it
      // stands rather than being frozen and dropped at the go.
      this.countdown -= dt;
      this.truck.step(dt, { steer: 0, throttle: 0, brake: 0, hold: true });
      this.lap.update(dt, this.truck.x, this.truck.y, false);
      this.keepInside();
      if (this.countdown <= 0) { this.countdown = 0; this.running = true; }
      return;
    }
    this.sinceStart += dt;

    this.truck.step(dt, {
      steer: input.turn, throttle: input.throttle, brake: input.brake, handbrake: input.handbrake,
    });
    this.keepInside();

    const was = this.lap.laps;
    this.lap.update(dt, this.truck.x, this.truck.y, true);
    if (this.lap.laps > was) {
      // A lap ended on the line. Offer it to the ghost, which keeps it only
      // if it beats what it holds, and start recording the next one — from
      // the line, which is the only place a comparable lap can start.
      if (this.lap.lastLap !== null) this.ghost.finish(this.lap.lastLap);
      this.ghost.begin();
    }
    this.ghost.record(dt, this.truck, this.lap.at);
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
    this.keepOneInside(this.truck);
  }

  // Cars used to be pushed apart here, and their closing speed exchanged.
  // There is one car now, and the ghost is a recording: it has no momentum
  // to trade and nothing to be leaned on with, which is the one way it is an
  // easier opponent than the drivers were.

  private keepOneInside(t: Vehicle) {
    const limX = ARENA_X - 110;
    const limY = ARENA_Y - 110;
    if (t.x < -limX) { t.x = -limX; t.vx = Math.abs(t.vx) * BOUNCE; }
    if (t.x > limX) { t.x = limX; t.vx = -Math.abs(t.vx) * BOUNCE; }
    if (t.y < -limY) { t.y = -limY; t.vy = Math.abs(t.vy) * BOUNCE; }
    if (t.y > limY) { t.y = limY; t.vy = -Math.abs(t.vy) * BOUNCE; }

    // The lamp posts, the trees, the drums and the tyre stacks: a circle
    // each, and a truck that meets one is put outside it and bounced. All
    // four lists grow with the arena — the forest quadratically before it
    // was thinned — so they are looked up through a grid rather than
    // scanned; see `spatial.ts`. Only if the grid has somehow not been built
    // yet does this fall back to the plain scan it replaced.
    if (collisionGrid) {
      collisionGrid.forEachNear(t.x, t.y, COLLISION_REACH, (c) => this.keepOff(t, c.x, c.y, c.r));
    } else {
      for (const post of COLUMNS) this.keepOff(t, post.x, post.y, COLUMN_RADIUS * post.scale);
      // zero radius is a prop a wheel goes through — a marsh's reeds —
      // and not a collision at all, not a very small one
      for (const prop of PROPS) if (prop.r > 0) this.keepOff(t, prop.x, prop.y, prop.r);
      for (const b of BOLLARDS) this.keepOff(t, b.x, b.y, b.r);
    }
    // The barriers are not. A rail is a line, and what the truck meets is
    // the nearest point on it — which turns the whole thing into the circle
    // case again, with a circle that slides along the rail as the truck
    // does. `keepOff` reflects only the part of the velocity along the
    // normal, so a glancing hit scrapes and carries on, which is what a
    // barrier is for; a square-on one stops you, which is also what it is
    // for.
    for (const r of RAILS) {
      const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
      const len2 = dx * dx + dy * dy;
      let u = len2 > 1e-9 ? ((t.x - r.x1) * dx + (t.y - r.y1) * dy) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      this.keepOff(t, r.x1 + dx * u, r.y1 + dy * u, RAIL_DEEP / 2);
    }
  }

  /** Push a truck out of a round thing at (cx, cy) of radius r, and bounce it. */
  private keepOff(t: Vehicle, cx: number, cy: number, r: number) {
    const dx = t.x - cx;
    const dy = t.y - cy;
    const reach = r + t.spec.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach || d2 < 1e-6) return;
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

  /**
   * Back to the grid just short of the line, with the clock stopped and the
   * lights counting again. The ghost is left alone: a restart is another go
   * at the same circuit, and throwing your best lap away because you pressed
   * R is not what R is for.
   */
  reset() {
    // Facing along the tangent, and not along a guess. The line is at the
    // angle -pi, where the track runs toward -y, and a hardcoded +y put the
    // truck on the grid pointing the wrong way down the circuit.
    const [tx, ty] = tangentAt(-Math.PI);
    const yaw = Math.atan2(ty, tx);
    const x = Math.cos(-Math.PI) * radiusAt(-Math.PI) - tx * 90;
    const y = Math.sin(-Math.PI) * radiusAt(-Math.PI) - ty * 90;
    this.truck.reset(x, y, yaw);
    this.lap.reset(x, y);
    this.ghost.begin();
    this.running = false;
    this.countdown = COUNTDOWN; this.sinceStart = 0;
  }
}

/** Where the start line is: on the centreline at progress zero. */
export function startLine(): [number, number] {
  const theta = -Math.PI;
  return [Math.cos(theta) * radiusAt(theta), Math.sin(theta) * radiusAt(theta)];
}
