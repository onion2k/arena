/**
 * An arena, on the game path of artshape-render.
 *
 * The demo exists to push the two things that path was built for: a lot of
 * moving point lights, and materials shiny enough to show them. Every frame
 * it throws away the light list and writes a new one — a shot, an enemy, an
 * explosion and a muzzle flash all carry their own — and redraws the whole
 * scene rather than keeping the static half, because a moving light relights
 * the arena and the two are alternatives.
 */
import { createContext } from 'artshape-render/gpu/context';
import { Orbit } from 'artshape-render/gpu/camera';
import { bakeEnvironment } from 'artshape-render/render/env';
import { GameRenderer, EFFECT_STRIDE, type GameGroup } from 'artshape-render/game/renderer';
import { LightPool } from 'artshape-render/game/lights';
import { Arena, MAX_BOLTS, MAX_ENEMIES, type Input } from './game';
import { ARENA_X, ARENA_Y, MESHES, arenaMatrices } from './scene';
import { hide, placeTipped, project } from './matrix';
import { EFFECT_CAPACITY, LIGHT_CAPACITY, effectsFor, lightsFor, setProjectionScale } from './lighting';

const FOV = 40;
/** Where the dynamic groups sit, in the order they are handed over. */
const HULL = 0, CORE = 1, RING = 2, DRONES = 3, BOLTS = 4;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bootMsg = document.getElementById('bootMsg')!;
const scorePanel = document.getElementById('score')!;
const statsPanel = document.getElementById('stats')!;
const helpPanel = document.getElementById('help')!;

main().catch((err) => { bootMsg.textContent = String(err?.message ?? err); console.error(err); });

async function main() {
  const ctx = await createContext(canvas);
  bootMsg.textContent = 'compiling shaders…';

  const renderer = new GameRenderer(ctx, LIGHT_CAPACITY, EFFECT_CAPACITY);
  renderer.look = {
    ...renderer.look,
    // low and warm, so the sun picks out the tops of things and leaves the
    // floor for the point lights to do
    sunDir: [0.34, 0.52, 0.78],
    sunColour: [0.9, 0.86, 1.0],
    exposure: 1.05,
    // the environment lights the metal but is never drawn, so this is the
    // whole sky: near black, to leave the point lights all the contrast
    background: [0.004, 0.004, 0.007],
  };

  bootMsg.textContent = 'generating the arena…';
  // One frame's grace, so the message is painted before the geometry blocks
  // the thread. Raced against a timer because a tab that is not being
  // composited never calls back, and a loading screen that waits forever for
  // one is worse than no loading screen at all.
  await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });

  const mesh = {
    floor: MESHES.floor(), tile: MESHES.tile(), block: MESHES.block(), column: MESHES.column(),
    hull: MESHES.hull(), core: MESHES.core(), ring: MESHES.ring(),
    drone: MESHES.drone(), bolt: MESHES.bolt(),
  };
  const at = arenaMatrices();

  renderer.setStatic([
    { mesh: mesh.floor, matrices: identity(), albedo: [0.052, 0.056, 0.072], roughness: 0.14 },
    { mesh: mesh.tile, matrices: at.tiles, albedo: [0.10, 0.11, 0.14], roughness: 0.24 },
    { mesh: mesh.block, matrices: at.blocks, albedo: [0.60, 0.63, 0.70], roughness: 0.26 },
    { mesh: mesh.column, matrices: at.columns, albedo: [0.78, 0.62, 0.35], roughness: 0.18 },
  ]);

  // The pools. Their size is fixed here and never changes again: what moves
  // each frame is the live count, and the matrices written into the prefix.
  const hullM = new Float32Array(16);
  const coreM = new Float32Array(16);
  const ringM = new Float32Array(16);
  const droneM = new Float32Array(MAX_ENEMIES * 16);
  const boltM = new Float32Array(MAX_BOLTS * 16);
  const droneMat = new Float32Array(MAX_ENEMIES * 4);
  const dynamic: GameGroup[] = [
    // not a mirror: a polished metal under a near-black sky has nothing to
    // reflect and reads as a dark shape. A little roughness gives the point
    // lights a highlight wide enough to see the colour in.
    { mesh: mesh.hull, matrices: hullM, albedo: [1.0, 0.79, 0.36], roughness: 0.22 },
    { mesh: mesh.core, matrices: coreM, albedo: [0.85, 0.93, 1.0], roughness: 0.12 },
    { mesh: mesh.ring, matrices: ringM, albedo: [0.96, 0.97, 1.0], roughness: 0.16 },
    { mesh: mesh.drone, matrices: droneM, count: 0, albedo: [0.86, 0.17, 0.12], roughness: 0.27 },
    { mesh: mesh.bolt, matrices: boltM, count: 0, albedo: [0.38, 0.95, 1.0], roughness: 0.05 },
  ];
  renderer.setDynamic(dynamic);

  bootMsg.textContent = 'baking the environment…';
  const env = bakeEnvironment(ctx, 'dusk', { size: 128, mips: 6 });
  renderer.setEnvironment(env.specular, env.brdf, env.mips);

  renderer.camera.fov = FOV;
  setProjectionScale(FOV);

  const arena = new Arena();
  const lights = new LightPool(LIGHT_CAPACITY);
  const quads = new Float32Array(EFFECT_CAPACITY * EFFECT_STRIDE);
  const input = watchInput(arena);
  // Drag to swing the camera round, wheel to come in and out, shift-drag to
  // slide it. The floor is opaque from below and the arena is meant to be
  // looked into, so the polar range stops short of the horizon and of
  // straight down.
  const orbit = new Orbit(renderer.camera, {
    element: canvas,
    minPolar: 0.18,
    maxPolar: 1.36,
    rotateSpeed: 0.42,
    zoomSpeed: 0.8,
    // the camera follows the ship, so its target is not the player's to move
    panSpeed: 0,
    // less carry than the still-life viewer's: a camera that keeps drifting
    // after the hand comes off is a camera you fight while trying to fly
    inertia: 0.45,
  });
  // for poking at from the console while tuning
  /**
   * Draw the same frame `n` times and fence on the queue, for measuring what
   * a setting costs without the compositor in the way. Frame time off a
   * requestAnimationFrame loop is only as honest as the tab is visible, and
   * a browser pane that is not on screen stops calling back altogether —
   * which reads as a scene that got mysteriously slower.
   */
  const measure = async (w = 1920, h = 1080, n = 120) => {
    // Size it explicitly. A pane that is not on screen lays its canvas out at
    // nothing, and a measurement of a one-pixel frame is a measurement of the
    // driver's overhead — which is how an earlier calibration in this family
    // of projects came back with seven hundred thousand ms a megapixel.
    renderer.resize(w, h);
    const off = ctx.device.createTexture({
      size: [w, h], format: ctx.format, usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    upload();
    const view = () => off.createView();
    for (let i = 0; i < 10; i++) renderer.frame(view());
    await ctx.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.frame(view());
    await ctx.queue.onSubmittedWorkDone();
    const ms = (performance.now() - t0) / n;
    off.destroy();
    renderer.resize(width, height);
    return {
      ms: +ms.toFixed(3), mpx: +((w * h) / 1e6).toFixed(2),
      msPerMpx: +(ms / ((w * h) / 1e6)).toFixed(2),
      lights: lights.count, drones: arena.enemies, shots: arena.bolts,
    };
  };
  /**
   * Draw one frame at a chosen size and post it to the dev server, which
   * writes it to docs/. A screenshot of the browser is a screenshot of the
   * browser: this is the frame itself, at whatever size the picture wants.
   */
  const shoot = async (w = 1600, h = 900) => {
    canvas.width = w; canvas.height = h;
    renderer.resize(w, h);
    if (!touched) reframe(true, w / h);
    // the orbit eases toward where it was sent, and a capture does not have
    // a hundred frames to get there
    followShip(1);
    orbit.update();
    upload();
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw');
    await ctx.queue.onSubmittedWorkDone();
    const png = canvas.toDataURL('image/png');
    await fetch('/__shot', { method: 'POST', body: png });
    return png.length;
  };
  Object.assign(globalThis as Record<string, unknown>, { arena, renderer, orbit, measure, shoot });

  /**
   * Frame the arena, and set how far in and out the wheel may go from there.
   * `touched` latches the moment the camera is moved by hand, after which a
   * resize adjusts the limits but leaves the view where it was put.
   */
  let touched = false;
  /** The distance at which the whole arena is in frame. Set by every reframe. */
  let fitted = 2000;
  const reframe = (move: boolean, aspect = canvas.width / Math.max(1, canvas.height)) => {
    const before = renderer.camera.position.slice() as [number, number, number];
    const target = renderer.camera.target.slice() as [number, number, number];
    fitted = fitCamera(renderer.camera, aspect);
    orbit.minDistance = fitted * 0.22;
    orbit.maxDistance = fitted;
    if (move) {
      // In closer than the fitted distance, so the ship reads: the whole
      // arena is what the wheel is for. Moved before the orbit adopts it,
      // because `setSpherical` eases and a view that drifts into place over
      // the first second of play looks like something is wrong.
      const t = renderer.camera.target;
      const pos = renderer.camera.position;
      renderer.camera.position = [
        t[0] + (pos[0] - t[0]) * START_ZOOM,
        t[1] + (pos[1] - t[1]) * START_ZOOM,
        t[2] + (pos[2] - t[2]) * START_ZOOM,
      ];
      renderer.camera.update();
      orbit.forcePosition();
      return;
    }
    renderer.camera.position = before;
    renderer.camera.target = target;
    renderer.camera.update();
  };

  /**
   * Where the camera looks: the ship, held inside the arena by however much
   * of the arena is off screen.
   *
   * `fitted` is by construction the distance at which the whole arena is in
   * frame, so at that distance the camera must stay dead centre and nothing
   * can come in unseen; from there the leash lengthens as you zoom in, in
   * proportion, until up close it simply follows. That is one behaviour
   * rather than a follow mode and a whole-arena mode, and zooming all the way
   * out is the whole-arena mode.
   */
  const aim: [number, number, number] = [0, 0, CAMERA_HEIGHT];
  const followShip = (dt: number) => {
    const slack = Math.max(0, 1 - orbit.distance / fitted);
    const wantX = clamp(arena.px, -ARENA_X * slack, ARENA_X * slack);
    const wantY = clamp(arena.py, -ARENA_Y * slack, ARENA_Y * slack);
    // eased, so a bounce off a wall does not snap the whole scene sideways
    const k = Math.min(1, dt * 3.4);
    aim[0] += (wantX - aim[0]) * k;
    aim[1] += (wantY - aim[1]) * k;
    renderer.camera.target = [aim[0], aim[1], aim[2]];
  };
  canvas.addEventListener('pointerdown', () => { touched = true; });
  canvas.addEventListener('wheel', () => { touched = true; }, { passive: true });

  let width = 0, height = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // A canvas in a document that is not being laid out measures zero, and
    // fitting a camera to a one-pixel frame pulls it back until the arena is
    // a speck. Fall back to a plain 16:9 rather than believing it.
    const laidOut = canvas.clientWidth > 4 && canvas.clientHeight > 4;
    width = laidOut ? Math.round(canvas.clientWidth * dpr) : 1280;
    height = laidOut ? Math.round(canvas.clientHeight * dpr) : 720;
    canvas.width = width; canvas.height = height;
    renderer.resize(width, height);
    // Re-frame only while the camera is where the arena put it. Once it has
    // been moved, a resize must not yank it back — but the distance that
    // fits does change with the shape of the window, so the limits move.
    reframe(!touched);
  };
  addEventListener('resize', resize);
  resize();

  await renderer.ready;
  for (const el of [scorePanel, statsPanel, helpPanel]) el.removeAttribute('hidden');
  boot.classList.add('gone');
  setTimeout(() => boot.setAttribute('hidden', ''), 500);

  /**
   * Everything the GPU needs for the state the arena is in: where each thing
   * is, what colour it is, what is lighting it, and what is glowing over the
   * top. The frame loop calls it, and so does `shoot` — a capture that only
   * drew would draw whatever the loop last uploaded, which on a paused tab is
   * an empty arena lit by a full set of lights.
   */
  const upload = (): number => {
    // The hull lies flat and points where the nose points, banking a little
    // into a turn. The stone on top of it spins on its own, and the ring the
    // other way — those two are decoration and must not be mistaken for the
    // heading, so only the hull carries `pAngle` alone.
    const hover = 86 + Math.sin(t * 2.2) * 5;
    const bank = -arena.lastTurn * 0.32;
    placeTipped(hullM, 0, arena.px, arena.py, hover, arena.pAngle, bank, 1);
    renderer.move(HULL, hullM, 1);
    placeTipped(coreM, 0, arena.px, arena.py, hover + 34, arena.pAngle + arena.pSpin, 0.42, 1);
    renderer.move(CORE, coreM, 1);
    placeTipped(ringM, 0, arena.px, arena.py, hover + 12, -arena.pSpin * 0.7, 0.2, 1);
    renderer.move(RING, ringM, 1);

    for (let i = 0; i < arena.enemies; i++) {
      placeTipped(droneM, i, arena.ex[i], arena.ey[i], 44 + Math.sin(arena.ephase[i] * 0.8) * 10,
        arena.ephase[i] * 0.9, Math.sin(arena.ephase[i] * 0.35) * 0.45);
      const flash = arena.eflash[i] > 0 ? arena.eflash[i] / 0.12 : 0;
      const o = i * 4;
      droneMat[o] = 0.86 + flash * 0.14;
      droneMat[o + 1] = 0.17 + flash * 0.8;
      droneMat[o + 2] = 0.12 + flash * 0.85;
      droneMat[o + 3] = 0.27 - flash * 0.2;
    }
    renderer.move(DRONES, droneM, arena.enemies);
    if (arena.enemies) renderer.tint(DRONES, droneMat);

    for (let i = 0; i < arena.bolts; i++) {
      // the bolt is modelled standing up, so it lies over and then turns a
      // quarter past its heading to point along it
      placeTipped(boltM, i, arena.bx[i], arena.by[i], 44,
        Math.atan2(arena.bvy[i], arena.bvx[i]) + Math.PI / 2, Math.PI / 2);
    }
    if (arena.bolts < MAX_BOLTS) hide(boltM, arena.bolts);
    renderer.move(BOLTS, boltM, arena.bolts);

    lightsFor(lights, arena, t);
    renderer.setLights(lights);
    renderer.camera.update();
    const effects = effectsFor(quads, arena, renderer.camera.viewProjection);
    renderer.setEffects(quads, effects);
    return effects;
  };

  let last = performance.now();
  let t = 0;
  let smoothed = 16.7;
  let statsIn = 0;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    // a long pause — a tab in the background, a garbage collection — must not
    // teleport everything through a wall
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now; t += dt;

    if (input.takeRecentre()) { aim[0] = 0; aim[1] = 0; reframe(true); }
    followShip(dt);
    orbit.update();
    arena.step(dt, input.read());

    const effects = upload();

    // redraw, not keep: every one of those lights moves, and a kept static
    // half would be lit by where they were when it was baked
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw');

    smoothed += (dt * 1000 - smoothed) * 0.08;
    statsIn -= dt;
    if (statsIn <= 0) {
      statsIn = 0.2;
      scorePanel.innerHTML =
        `<b>${arena.score.toLocaleString()}</b><span class="lives">`
        + [0, 1, 2].map((i) => `<i class="${i < arena.lives ? '' : 'spent'}">◆</i>`).join('')
        + `</span> · wave <span>${arena.wave}</span>`;
      statsPanel.innerHTML =
        `<span>${smoothed.toFixed(1)}</span> ms · <span>${Math.round(1000 / smoothed)}</span> fps<br>`
        + `<span>${lights.count}</span> lights · <span>${effects}</span> glows<br>`
        + `<span>${arena.enemies}</span> drones · <span>${arena.bolts}</span> shots · <span>${arena.blasts.length}</span> blasts<br>`
        + `<span>${Math.round(arena.speed)}</span> speed · fire <span>${input.autofire ? 'auto' : 'held'}</span><br>`
        + `<span>${width}×${height}</span>`;
    }
  };
  requestAnimationFrame(frame);
}

/**
 * Back the camera off until the whole arena is inside the frame.
 *
 * The angle it looks from is a choice; the distance is not, and hardcoding
 * one crops the near corners on a window the wrong shape — which in a game
 * where enemies come in from the edges means being killed by something that
 * was never on screen. So the corners are projected and the distance is
 * solved for, on every resize.
 */
function fitCamera(cam: GameRenderer['camera'], aspect: number): number {
  const target: [number, number, number] = [0, 0, CAMERA_HEIGHT];
  // back and up from the target, at the angle the arena reads best from
  const back = norm([0, -1.32, 0.915]);
  const corners: [number, number, number][] = [];
  for (const x of [-ARENA_X, ARENA_X]) {
    for (const y of [-ARENA_Y, ARENA_Y]) {
      for (const z of [0, 230]) corners.push([x, y, z]);
    }
  }
  cam.aspect = aspect;
  cam.target = target;
  let lo = 500, hi = 6000;
  for (let i = 0; i < 22; i++) {
    const d = (lo + hi) / 2;
    cam.position = [target[0] + back[0] * d, target[1] + back[1] * d, target[2] + back[2] * d];
    cam.update();
    const fits = corners.every((c) => {
      const p = project(cam.viewProjection, c[0], c[1], c[2]);
      return p !== null && Math.abs(p[0]) <= 0.985 && Math.abs(p[1]) <= 0.985;
    });
    if (fits) hi = d; else lo = d;
  }
  cam.position = [target[0] + back[0] * hi, target[1] + back[1] * hi, target[2] + back[2] * hi];
  cam.update();
  return hi;
}

/** Where the camera starts, as a fraction of the distance that fits the arena. */
const START_ZOOM = 0.68;
/** How high off the floor the camera looks. The fit solves for this exact
 *  point, so at full zoom-out the guarantee that everything is in frame holds. */
const CAMERA_HEIGHT = 55;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * Asteroids: left and right turn, forward thrusts along the nose, back
 * brakes. The mouse is not part of it — it belongs to the camera now.
 */
function watchInput(arena: Arena) {
  const held = new Set<string>();
  let autofire = true;
  let recentre = false;

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'r') arena.restart();
    if (k === 'x') autofire = !autofire;
    if (k === 'c') recentre = true;
    // the arrows and space scroll the page otherwise, which in a game that
    // uses both is the page jumping about under the player
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    held.add(k);
  });
  addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  // a window that loses focus mid-turn would otherwise keep turning forever
  addEventListener('blur', () => held.clear());

  const down = (...keys: string[]) => keys.some((k) => held.has(k));
  return {
    get autofire() { return autofire; },
    /** True once, for the frame the camera should be framed again. */
    takeRecentre() { const r = recentre; recentre = false; return r; },
    read(): Input {
      return {
        turn: (down('a', 'arrowleft') ? 1 : 0) - (down('d', 'arrowright') ? 1 : 0),
        thrust: down('w', 'arrowup') ? 1 : 0,
        brake: down('s', 'arrowdown') ? 1 : 0,
        firing: autofire || down('f', ' '),
      };
    },
  };
}

const norm = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
