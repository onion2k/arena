/**
 * What the trucks throw up: smoke off a sliding tyre, spray off a wet one.
 *
 * Both come from the wheel, because that is where both come from. The
 * physics already knows whether a wheel is on the ground, how hard it is
 * sliding and whether its ground is under the water; this reads those and
 * asks the renderer for a burst, and the renderer's GPU pool does the rest.
 * Nothing here is simulated on the CPU — a burst is a few floats a frame.
 *
 * Everything is tinted by the time of day. The particles are unlit — they
 * are drawn after the scene and know nothing of its lamps — so smoke that
 * was white at noon would glow white at midnight over a road that is
 * nearly black. At night it is a grey haze in the floods; by day it is
 * pale. Spray is additive, so at night it is the glint of drops in the
 * lamplight and by day a white splash.
 */
import type { GameRenderer } from 'artshape-render/game/renderer';
import { WHEEL_RADIUS, type Vehicle, type Wheel } from './vehicle';
import { WATER_LEVEL } from './water';

/** A sliding tyre smokes above this much of a slide. */
const SMOKE_FROM = 0.25;
/** Below this speed a wheel raises nothing, sliding or wet. */
const STILL = 250;

/** One wheel's worth, this frame. `day` is the sky's, 0 at night to 1 at noon. */
export function wheelEffects(renderer: GameRenderer, v: Vehicle, w: Wheel, hub: [number, number, number], day: number) {
  if (!w.onGround) return;
  const speed = v.speed;
  if (speed < STILL) return;
  const lit = 0.45 + 0.55 * day;

  if (w.wet) {
    // Droplets: thrown up and forward off the tyre, bright and additive,
    // falling under gravity and dying where they meet the water again.
    renderer.emit({
      position: [hub[0], hub[1], WATER_LEVEL + 6],
      velocity: [v.vx * 0.45, v.vy * 0.45, 220 + speed * 0.22],
      spread: 180 + speed * 0.12,
      count: Math.max(2, Math.min(10, Math.round(speed / 220))),
      life: 0.55, lifeSpread: 0.4,
      size: 8,
      colour: [0.8 * lit, 0.9 * lit, 1.0 * lit],
      alpha: 0,
      gravity: 1,
      floor: WATER_LEVEL,
    });
    // and a little mist that hangs, translucent, and swells as it fades
    renderer.emit({
      position: [hub[0], hub[1], WATER_LEVEL + 20],
      velocity: [v.vx * 0.3, v.vy * 0.3, 120],
      spread: 80,
      count: 2,
      life: 0.5, lifeSpread: 0.3,
      size: 28, growth: 40,
      colour: [0.7 * lit, 0.8 * lit, 0.9 * lit],
      alpha: 0.35,
      gravity: -0.02,
    });
    return;
  }

  if (w.slide > SMOKE_FROM) {
    // Smoke: from the contact patch, drifting with a share of the truck's
    // motion and up, swelling as it thins. More of it the harder the slide.
    renderer.emit({
      position: [hub[0], hub[1], hub[2] - WHEEL_RADIUS + 8],
      velocity: [v.vx * 0.25, v.vy * 0.25, 70],
      spread: 110,
      count: Math.max(1, Math.min(5, Math.round(w.slide * 4))),
      life: 0.9, lifeSpread: 0.35,
      size: 24, growth: 55,
      colour: [0.55 * lit, 0.55 * lit, 0.6 * lit],
      alpha: 0.32,
      gravity: -0.03,
    });
  }
}
