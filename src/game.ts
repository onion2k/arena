/**
 * The arena's state and its rules. Nothing here knows about the GPU.
 *
 * Everything is a fixed-capacity pool with a live count, because that is what
 * the renderer wants: one buffer allocated at the start, one write a frame,
 * and a count that moves. Killing an enemy swaps the last live one into its
 * slot rather than leaving a hole, so the live prefix stays dense.
 */
import { ARENA_X, ARENA_Y, COLUMN_RADIUS, COLUMNS } from './scene';

export const MAX_ENEMIES = 300;
export const MAX_BOLTS = 300;
export const MAX_BLASTS = 28;

/**
 * The ship flies the way Asteroids' does: it turns, it thrusts along where it
 * is pointing, and it keeps going. Nothing here steers toward a cursor.
 */
const TURN_RATE = 3.7;         // radians a second
/** How fast the gun can be swung round. A turret slews; it does not snap. */
const SLEW_RATE = 6.5;
/** Where the gun sits along the truck, and how far the muzzle is past it. */
export const TURRET_BACK = -52;
export const BARREL_REACH = 150;
const THRUST = 2150;           // mm a second squared
/** Drag as a rate: velocity is multiplied by exp(-rate · dt) each step, so it
 *  is frame-rate independent in a way `v *= 0.98` is not. */
const DRAG = 0.5;
const BRAKE = 3.4;
const MAX_SPEED = 1180;
/** How much of its speed the ship keeps when it meets a wall or a post. */
const BOUNCE = 0.45;
/**
 * How wide the truck is for the purpose of not being inside a post. It is
 * 250 long and 128 across, so no one circle is right; this is between the
 * two, which keeps a corner from visibly sinking into a post without making
 * the gaps between them feel narrower than they look.
 */
const SHIP_RADIUS = 98;
const BOLT_SPEED = 1950;
const BOLT_LIFE = 1.5;
const FIRE_EVERY = 0.085;
const ENEMY_RADIUS = 34;
const HIT_RADIUS = 42;

/**
 * A grid over the floor, so that neither the shots nor the crowd is an
 * every-one-against-every-one problem.
 *
 * It was one until the arena went square and 4.8 metres across, which took
 * the pool to three hundred enemies. Measured on the same busy state, a fresh
 * page each time: scanning every enemy for every query costs 0.56 ms a step,
 * bucketing costs 0.16. Neither is anywhere near a frame's budget — this is
 * headroom for the next size rather than a fire being put out — but the
 * scan grows with the square of the crowd and this does not.
 *
 * (An earlier reading put the scan at 2.6 ms. It has not reproduced in any
 * later run, cold page or warm, and the number above is what six runs agree
 * on. Recorded because a number that does not reproduce is worth saying so
 * about rather than quietly dropping.)
 *
 * The cell is wider than any radius asked of it, so a query never reads more
 * than the nine cells around a point.
 */
const CELL = 240;
const GRID_W = Math.ceil((ARENA_X * 2) / CELL) + 1;
const GRID_H = Math.ceil((ARENA_Y * 2) / CELL) + 1;

export interface Blast { x: number; y: number; age: number; life: number; power: number }

/** What the player is asking for this step. */
export interface Input {
  /** -1 to 1: which way to steer, and how hard. */
  turn: number;
  /** 0 to 1: throttle, along where the truck is pointing. */
  thrust: number;
  /** 0 to 1: brake, which is drag rather than reverse. */
  brake: number;
  /** Where on the floor the gun is being pointed. Null keeps it where it is. */
  aimAt: [number, number] | null;
  firing: boolean;
}

export class Arena {
  // the player
  px = 0; py = -700; pAngle = Math.PI / 2; aim = Math.PI / 2;
  /** How far the wheels have rolled, in radians. Only the bolts show it. */
  wheelSpin = 0;
  /** Velocity. The ship carries it: nothing else in the arena does. */
  pvx = 0; pvy = 0;
  /** How hard the throttle and brake are down, for the lamps to be drawn from. */
  thrusting = 0;
  braking = 0;
  /** Which way it was last asked to turn, for the hull to bank by. */
  lastTurn = 0;
  lives = 3; invuln = 0; score = 0; wave = 1;
  /** Counts down after a shot; drives the muzzle flash as well as the cadence. */
  cooldown = 0;
  lastShot = 99;

  // enemies: dense prefix of length `enemies`
  enemies = 0;
  ex = new Float32Array(MAX_ENEMIES);
  ey = new Float32Array(MAX_ENEMIES);
  ephase = new Float32Array(MAX_ENEMIES);
  ehp = new Float32Array(MAX_ENEMIES);
  /** Seconds left of the white flash a hit puts on one. */
  eflash = new Float32Array(MAX_ENEMIES);

  bolts = 0;
  bx = new Float32Array(MAX_BOLTS);
  by = new Float32Array(MAX_BOLTS);
  bvx = new Float32Array(MAX_BOLTS);
  bvy = new Float32Array(MAX_BOLTS);
  blife = new Float32Array(MAX_BOLTS);

  blasts: Blast[] = [];

  /** Head of each cell's list, and the next-in-cell for each enemy. -1 ends. */
  private cellHead = new Int32Array(GRID_W * GRID_H).fill(-1);
  private cellNext = new Int32Array(MAX_ENEMIES).fill(-1);

  private spawnIn = 0.5;
  private waveLeft = 34;

  step(dt: number, input: Input) {
    this.drive(dt, input);
    this.slewGun(dt, input);
    if (this.invuln > 0) this.invuln -= dt;
    this.rebuildGrid();

    this.cooldown -= dt;
    this.lastShot += dt;
    if (input.firing && this.cooldown <= 0) {
      this.fire();
      this.cooldown = FIRE_EVERY;
      this.lastShot = 0;
    }

    this.stepBolts(dt);
    // the shots have killed some and swapped the pool about; the crowd needs
    // an honest grid before it asks who its neighbours are
    this.rebuildGrid();
    this.stepEnemies(dt);
    this.stepSpawns(dt);
    for (const b of this.blasts) b.age += dt;
    this.blasts = this.blasts.filter((b) => b.age < b.life);
  }

  private drive(dt: number, input: Input) {
    // eased, so the bank the hull is drawn with does not snap on and off
    this.lastTurn += (input.turn - this.lastTurn) * Math.min(1, dt * 9);
    this.pAngle += input.turn * TURN_RATE * dt;
    this.thrusting = Math.max(0, Math.min(1, input.thrust));
    this.braking = Math.max(0, Math.min(1, input.brake));
    if (this.thrusting > 0) {
      this.pvx += Math.cos(this.pAngle) * THRUST * this.thrusting * dt;
      this.pvy += Math.sin(this.pAngle) * THRUST * this.thrusting * dt;
    }
    // exponential, so the same dt twice slows it by the same amount as one
    // step of twice the dt — a fixed factor a frame would not
    const drag = Math.exp(-(DRAG + BRAKE * Math.max(0, Math.min(1, input.brake))) * dt);
    this.pvx *= drag; this.pvy *= drag;
    const speed = Math.hypot(this.pvx, this.pvy);
    if (speed > MAX_SPEED) {
      this.pvx = (this.pvx / speed) * MAX_SPEED;
      this.pvy = (this.pvy / speed) * MAX_SPEED;
    }
    this.px += this.pvx * dt;
    this.py += this.pvy * dt;

    // the walls are solid rather than a wrap: the arena has an inside
    const limX = ARENA_X - 110;
    const limY = ARENA_Y - 110;
    if (this.px < -limX) { this.px = -limX; this.pvx = Math.abs(this.pvx) * BOUNCE; }
    if (this.px > limX) { this.px = limX; this.pvx = -Math.abs(this.pvx) * BOUNCE; }
    if (this.py < -limY) { this.py = -limY; this.pvy = Math.abs(this.pvy) * BOUNCE; }
    if (this.py > limY) { this.py = limY; this.pvy = -Math.abs(this.pvy) * BOUNCE; }

    // and against the posts: pushed out of the overlap, then the part of its
    // velocity going into the post reflected, which leaves the part going
    // along it alone. Sliding round one at speed is the point of them.
    for (const [cx, cy, scale] of COLUMNS) {
      const dx = this.px - cx;
      const dy = this.py - cy;
      const reach = COLUMN_RADIUS * scale + SHIP_RADIUS;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d; const ny = dy / d;
      this.px = cx + nx * reach;
      this.py = cy + ny * reach;
      const into = this.pvx * nx + this.pvy * ny;
      if (into < 0) {
        this.pvx -= into * (1 + BOUNCE) * nx;
        this.pvy -= into * (1 + BOUNCE) * ny;
      }
    }

    // the wheels roll by however far the truck went along its own nose; a
    // slide sideways does not turn them, which is what makes a skid look like
    // a skid
    const along = this.pvx * Math.cos(this.pAngle) + this.pvy * Math.sin(this.pAngle);
    this.wheelSpin += (along * dt) / 31;
  }

  /**
   * The gun is not the truck. It swings toward where it is being pointed at
   * its own rate, so shooting one way while driving another is the whole
   * point of the thing.
   */
  private slewGun(dt: number, input: Input) {
    if (!input.aimAt) return;
    const want = Math.atan2(input.aimAt[1] - this.gunY, input.aimAt[0] - this.gunX);
    // the short way round, so it never takes the long path through the back
    let d = want - this.aim;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = SLEW_RATE * dt;
    this.aim += Math.abs(d) <= step ? d : Math.sign(d) * step;
  }

  /** Where the turret stands, in the world. */
  get gunX(): number { return this.px + Math.cos(this.pAngle) * TURRET_BACK; }
  get gunY(): number { return this.py + Math.sin(this.pAngle) * TURRET_BACK; }
  /** Where the muzzle is: what the shots come out of and the flash sits on. */
  get muzzleX(): number { return this.gunX + Math.cos(this.aim) * BARREL_REACH; }
  get muzzleY(): number { return this.gunY + Math.sin(this.aim) * BARREL_REACH; }

  /** How fast it is going, for the panel and for the plume. */
  get speed(): number { return Math.hypot(this.pvx, this.pvy); }

  /** Bucket every live enemy by where it is standing. */
  private rebuildGrid() {
    this.cellHead.fill(-1);
    for (let i = 0; i < this.enemies; i++) {
      const c = this.cellOf(this.ex[i], this.ey[i]);
      this.cellNext[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  private cellOf(x: number, y: number): number {
    const cx = clamp(Math.floor((x + ARENA_X) / CELL), 0, GRID_W - 1);
    const cy = clamp(Math.floor((y + ARENA_Y) / CELL), 0, GRID_H - 1);
    return cy * GRID_W + cx;
  }

  /**
   * The enemies within `radius` of a point, near enough — it walks whole
   * cells, so it hands back a few that are further. Every caller measures the
   * real distance anyway.
   *
   * An index may be stale by the time it is visited: killing an enemy swaps
   * the last one into its slot, and the grid still lists it under the old
   * one. Indices past the live end are skipped, so the worst that happens is
   * that one enemy goes untested for one frame, which nothing can see.
   */
  private near(x: number, y: number, radius: number, visit: (i: number) => boolean | void) {
    const x0 = clamp(Math.floor((x - radius + ARENA_X) / CELL), 0, GRID_W - 1);
    const x1 = clamp(Math.floor((x + radius + ARENA_X) / CELL), 0, GRID_W - 1);
    const y0 = clamp(Math.floor((y - radius + ARENA_Y) / CELL), 0, GRID_H - 1);
    const y1 = clamp(Math.floor((y + radius + ARENA_Y) / CELL), 0, GRID_H - 1);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let e = this.cellHead[cy * GRID_W + cx]; e !== -1; e = this.cellNext[e]) {
          if (e >= this.enemies) continue;
          if (visit(e) === true) return;
        }
      }
    }
  }

  private fire() {
    // both barrels, a little apart, so the muzzle flash has width
    for (const side of [-1, 1]) {
      if (this.bolts >= MAX_BOLTS) return;
      const i = this.bolts++;
      const off = this.aim + Math.PI / 2;
      const spread = (Math.random() - 0.5) * 0.05;
      this.bx[i] = this.muzzleX + Math.cos(off) * side * 13;
      this.by[i] = this.muzzleY + Math.sin(off) * side * 13;
      // the ship's own velocity carries into the shot, as it should when the
      // ship has momentum: firing backwards while running away is slower
      this.bvx[i] = Math.cos(this.aim + spread) * BOLT_SPEED + this.pvx;
      this.bvy[i] = Math.sin(this.aim + spread) * BOLT_SPEED + this.pvy;
      this.blife[i] = BOLT_LIFE;
    }
  }

  private dropBolt(i: number) {
    const last = --this.bolts;
    this.bx[i] = this.bx[last]; this.by[i] = this.by[last];
    this.bvx[i] = this.bvx[last]; this.bvy[i] = this.bvy[last];
    this.blife[i] = this.blife[last];
  }

  private dropEnemy(i: number) {
    const last = --this.enemies;
    this.ex[i] = this.ex[last]; this.ey[i] = this.ey[last];
    this.ephase[i] = this.ephase[last]; this.ehp[i] = this.ehp[last];
    this.eflash[i] = this.eflash[last];
  }

  private stepBolts(dt: number) {
    for (let i = this.bolts - 1; i >= 0; i--) {
      this.bx[i] += this.bvx[i] * dt;
      this.by[i] += this.bvy[i] * dt;
      this.blife[i] -= dt;
      let out = Math.abs(this.bx[i]) > ARENA_X - 40 || Math.abs(this.by[i]) > ARENA_Y - 40;
      if (!out) {
        for (const [cx, cy, scale] of COLUMNS) {
          const dx = this.bx[i] - cx; const dy = this.by[i] - cy;
          const r = COLUMN_RADIUS * scale;
          if (dx * dx + dy * dy < r * r) { out = true; break; }
        }
      }
      if (this.blife[i] <= 0 || out) {
        if (out) this.blasts.push({ x: this.bx[i], y: this.by[i], age: 0, life: 0.16, power: 0.35 });
        this.dropBolt(i);
        continue;
      }
      // only the enemies in the cells this shot is over
      let hit = false;
      this.near(this.bx[i], this.by[i], HIT_RADIUS, (e) => {
        const dx = this.ex[e] - this.bx[i];
        const dy = this.ey[e] - this.by[i];
        if (dx * dx + dy * dy > HIT_RADIUS * HIT_RADIUS) return;
        this.ehp[e] -= 1;
        this.eflash[e] = 0.12;
        if (this.ehp[e] <= 0) {
          this.blasts.push({ x: this.ex[e], y: this.ey[e], age: 0, life: 0.55, power: 1 });
          this.score += 100;
          this.dropEnemy(e);
        } else {
          this.blasts.push({ x: this.bx[i], y: this.by[i], age: 0, life: 0.14, power: 0.4 });
        }
        hit = true;
        return true;
      });
      if (hit) this.dropBolt(i);
    }
  }

  private stepEnemies(dt: number) {
    for (let i = this.enemies - 1; i >= 0; i--) {
      if (this.eflash[i] > 0) this.eflash[i] -= dt;
      this.ephase[i] += dt * 3.4;
      const dx = this.px - this.ex[i];
      const dy = this.py - this.ey[i];
      const d = Math.hypot(dx, dy) || 1;
      const speed = 205 + this.wave * 13;
      // a wobble across the line of approach, so a crowd does not become one dot
      const wob = Math.sin(this.ephase[i]) * 0.55;
      let vx = (dx / d) * speed + (-dy / d) * speed * wob;
      let vy = (dy / d) * speed + (dx / d) * speed * wob;
      // and a shove away from whoever is nearest, so they spread as they arrive
      const spread = ENEMY_RADIUS * 2.4;
      this.near(this.ex[i], this.ey[i], spread, (j) => {
        if (j === i) return;
        const sx = this.ex[i] - this.ex[j];
        const sy = this.ey[i] - this.ey[j];
        const s2 = sx * sx + sy * sy;
        if (s2 > spread * spread || s2 < 1e-3) return;
        const s = Math.sqrt(s2);
        vx += (sx / s) * 190; vy += (sy / s) * 190;
      });
      this.ex[i] = clamp(this.ex[i] + vx * dt, -ARENA_X + 70, ARENA_X - 70);
      this.ey[i] = clamp(this.ey[i] + vy * dt, -ARENA_Y + 70, ARENA_Y - 70);
      // they do not bounce, they are simply never inside one, so a crowd
      // arriving from one side flows round a post rather than through it
      for (const [cx, cy, scale] of COLUMNS) {
        const dx = this.ex[i] - cx; const dy = this.ey[i] - cy;
        const reach = COLUMN_RADIUS * scale + ENEMY_RADIUS;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        this.ex[i] = cx + (dx / d) * reach;
        this.ey[i] = cy + (dy / d) * reach;
      }

      if (d < 82 && this.invuln <= 0) {
        this.blasts.push({ x: this.ex[i], y: this.ey[i], age: 0, life: 0.7, power: 1.6 });
        this.dropEnemy(i);
        this.lives -= 1;
        this.invuln = 1.6;
        if (this.lives <= 0) this.restart();
        return;
      }
    }
  }

  private stepSpawns(dt: number) {
    this.spawnIn -= dt;
    if (this.spawnIn > 0) return;
    this.spawnIn = Math.max(0.08, 0.45 - this.wave * 0.028);
    if (this.waveLeft <= 0 && this.enemies === 0) {
      this.wave += 1;
      this.waveLeft = 30 + this.wave * 9;
      return;
    }
    // in from an edge, away from the player, so nothing lands on top of them
    for (let n = 0; n < 3 + Math.floor(this.wave / 2); n++) this.spawnOne();
  }

  private spawnOne() {
    if (this.waveLeft <= 0 || this.enemies >= MAX_ENEMIES) return;
    this.waveLeft -= 1;
    const i = this.enemies++;
    for (let attempt = 0; attempt < 8; attempt++) {
      const edge = Math.floor(Math.random() * 4);
      const t = Math.random();
      const x = edge < 2 ? (t * 2 - 1) * (ARENA_X - 90) : (edge === 2 ? -1 : 1) * (ARENA_X - 90);
      const y = edge < 2 ? (edge === 0 ? -1 : 1) * (ARENA_Y - 90) : (t * 2 - 1) * (ARENA_Y - 90);
      if (Math.hypot(x - this.px, y - this.py) < 900 && attempt < 7) continue;
      this.ex[i] = x; this.ey[i] = y;
      break;
    }
    this.ephase[i] = Math.random() * 6.28;
    this.ehp[i] = 1 + Math.floor(this.wave / 4);
    this.eflash[i] = 0;
  }

  restart() {
    this.enemies = 0; this.bolts = 0; this.blasts = [];
    this.lives = 3; this.score = 0; this.wave = 1;
    this.waveLeft = 34; this.spawnIn = 1.0;
    this.px = 0; this.py = -700; this.invuln = 2;
    this.pvx = 0; this.pvy = 0; this.pAngle = Math.PI / 2; this.aim = this.pAngle;
    this.wheelSpin = 0;
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
