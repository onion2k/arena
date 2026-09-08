/**
 * The arena's state and its rules. Nothing here knows about the GPU.
 *
 * Everything is a fixed-capacity pool with a live count, because that is what
 * the renderer wants: one buffer allocated at the start, one write a frame,
 * and a count that moves. Killing an enemy swaps the last live one into its
 * slot rather than leaving a hole, so the live prefix stays dense.
 */
import { ARENA_X, ARENA_Y } from './scene';

export const MAX_ENEMIES = 140;
export const MAX_BOLTS = 220;
export const MAX_BLASTS = 28;

/**
 * The ship flies the way Asteroids' does: it turns, it thrusts along where it
 * is pointing, and it keeps going. Nothing here steers toward a cursor.
 */
const TURN_RATE = 3.7;         // radians a second
const THRUST = 1650;           // mm a second squared
/** Drag as a rate: velocity is multiplied by exp(-rate · dt) each step, so it
 *  is frame-rate independent in a way `v *= 0.98` is not. */
const DRAG = 0.5;
const BRAKE = 3.4;
const MAX_SPEED = 820;
/** How much of its speed the ship keeps when it meets a wall. */
const BOUNCE = 0.45;
const BOLT_SPEED = 1450;
const BOLT_LIFE = 1.3;
const FIRE_EVERY = 0.085;
const ENEMY_RADIUS = 34;
const HIT_RADIUS = 42;

export interface Blast { x: number; y: number; age: number; life: number; power: number }

/** What the player is asking for this step. */
export interface Input {
  /** -1 to 1: which way to turn, and how hard. */
  turn: number;
  /** 0 to 1: thrust along where the nose points. */
  thrust: number;
  /** 0 to 1: brake, which is drag rather than reverse. */
  brake: number;
  firing: boolean;
}

export class Arena {
  // the player
  px = 0; py = -220; pAngle = Math.PI / 2; pSpin = 0; aim = Math.PI / 2;
  /** Velocity. The ship carries it: nothing else in the arena does. */
  pvx = 0; pvy = 0;
  /** How hard it is thrusting, for the plume to be drawn from. */
  thrusting = 0;
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

  private spawnIn = 0.5;
  private waveLeft = 16;

  step(dt: number, input: Input) {
    this.flyShip(dt, input);
    this.pSpin += dt * 1.9;
    if (this.invuln > 0) this.invuln -= dt;

    this.cooldown -= dt;
    this.lastShot += dt;
    if (input.firing && this.cooldown <= 0) {
      this.fire();
      this.cooldown = FIRE_EVERY;
      this.lastShot = 0;
    }

    this.stepBolts(dt);
    this.stepEnemies(dt);
    this.stepSpawns(dt);
    for (const b of this.blasts) b.age += dt;
    this.blasts = this.blasts.filter((b) => b.age < b.life);
  }

  private flyShip(dt: number, input: Input) {
    // eased, so the bank the hull is drawn with does not snap on and off
    this.lastTurn += (input.turn - this.lastTurn) * Math.min(1, dt * 9);
    this.pAngle += input.turn * TURN_RATE * dt;
    this.thrusting = Math.max(0, Math.min(1, input.thrust));
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

    // a shot goes where the nose points, not where a cursor is
    this.aim = this.pAngle;
  }

  /** How fast it is going, for the panel and for the plume. */
  get speed(): number { return Math.hypot(this.pvx, this.pvy); }

  private fire() {
    // a shot from either side of the hull, so the muzzle flash has width
    for (const side of [-1, 1]) {
      if (this.bolts >= MAX_BOLTS) return;
      const i = this.bolts++;
      const off = this.aim + Math.PI / 2;
      const spread = (Math.random() - 0.5) * 0.05;
      this.bx[i] = this.px + Math.cos(off) * side * 26 + Math.cos(this.aim) * 40;
      this.by[i] = this.py + Math.sin(off) * side * 26 + Math.sin(this.aim) * 40;
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
      const out = Math.abs(this.bx[i]) > ARENA_X - 40 || Math.abs(this.by[i]) > ARENA_Y - 40;
      if (this.blife[i] <= 0 || out) {
        if (out) this.blasts.push({ x: this.bx[i], y: this.by[i], age: 0, life: 0.16, power: 0.35 });
        this.dropBolt(i);
        continue;
      }
      // a shot against every live enemy: two hundred by a hundred and forty is
      // twenty-eight thousand distance tests, which is nothing beside a frame
      for (let e = this.enemies - 1; e >= 0; e--) {
        const dx = this.ex[e] - this.bx[i];
        const dy = this.ey[e] - this.by[i];
        if (dx * dx + dy * dy > HIT_RADIUS * HIT_RADIUS) continue;
        this.ehp[e] -= 1;
        this.eflash[e] = 0.12;
        if (this.ehp[e] <= 0) {
          this.blasts.push({ x: this.ex[e], y: this.ey[e], age: 0, life: 0.55, power: 1 });
          this.score += 100;
          this.dropEnemy(e);
        } else {
          this.blasts.push({ x: this.bx[i], y: this.by[i], age: 0, life: 0.14, power: 0.4 });
        }
        this.dropBolt(i);
        break;
      }
    }
  }

  private stepEnemies(dt: number) {
    for (let i = this.enemies - 1; i >= 0; i--) {
      if (this.eflash[i] > 0) this.eflash[i] -= dt;
      this.ephase[i] += dt * 3.4;
      const dx = this.px - this.ex[i];
      const dy = this.py - this.ey[i];
      const d = Math.hypot(dx, dy) || 1;
      const speed = 130 + this.wave * 9;
      // a wobble across the line of approach, so a crowd does not become one dot
      const wob = Math.sin(this.ephase[i]) * 0.55;
      let vx = (dx / d) * speed + (-dy / d) * speed * wob;
      let vy = (dy / d) * speed + (dx / d) * speed * wob;
      // and a shove away from whoever is nearest, so they spread as they arrive
      for (let j = 0; j < this.enemies; j++) {
        if (j === i) continue;
        const sx = this.ex[i] - this.ex[j];
        const sy = this.ey[i] - this.ey[j];
        const s2 = sx * sx + sy * sy;
        if (s2 > (ENEMY_RADIUS * 2.4) ** 2 || s2 < 1e-3) continue;
        const s = Math.sqrt(s2);
        vx += (sx / s) * 190; vy += (sy / s) * 190;
      }
      this.ex[i] = clamp(this.ex[i] + vx * dt, -ARENA_X + 70, ARENA_X - 70);
      this.ey[i] = clamp(this.ey[i] + vy * dt, -ARENA_Y + 70, ARENA_Y - 70);

      if (d < 62 && this.invuln <= 0) {
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
    this.spawnIn = Math.max(0.09, 0.5 - this.wave * 0.03);
    if (this.waveLeft <= 0 && this.enemies === 0) {
      this.wave += 1;
      this.waveLeft = 14 + this.wave * 4;
      return;
    }
    // in from an edge, away from the player, so nothing lands on top of them
    for (let n = 0; n < 1 + Math.floor(this.wave / 3); n++) this.spawnOne();
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
      if (Math.hypot(x - this.px, y - this.py) < 320 && attempt < 7) continue;
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
    this.waveLeft = 16; this.spawnIn = 1.0;
    this.px = 0; this.py = -220; this.invuln = 2;
    this.pvx = 0; this.pvy = 0; this.pAngle = Math.PI / 2; this.aim = this.pAngle;
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
