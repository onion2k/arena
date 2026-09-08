# Arena

An Asteroids-handling arena on the game path of
[artshape-render](https://github.com/onion2k/artshape-render): turn, thrust,
and shoot the things coming at you before they reach you.

It exists to lean on the two things that path was built for — a great many
moving point lights, and materials shiny enough to show them — and to be the
first real consumer of `artshape-render/game`, which had never drawn a game
before this.

![the arena at wave nine](docs/arena.png)

## Running it

```bash
npm install && npm run dev
```

Needs a browser with WebGPU.

| | |
| --- | --- |
| **A** **D** or ← → | turn |
| **W** or ↑ | thrust, along wherever the nose points |
| **S** or ↓ | brake |
| **space** or **F** | fire (it auto-fires as well) |
| **X** | auto-fire on and off |
| **R** | restart |
| drag | swing the camera round |
| wheel | in and out |
| shift-drag | slide it |
| **C** | put the camera back |

The ship flies the way Asteroids' does. It carries momentum, drag pulls it
down over about a second, and its own velocity carries into the shots it
fires, so running away while shooting backwards gives slow bullets. The walls
are solid rather than a wrap — it keeps about half its speed off one.

The camera is free but starts framed. It solves for a distance that fits the
whole arena in whatever shape the window is, and stays there until you move
it; after that a resize adjusts how far the wheel may go but leaves the view
alone. **C** re-frames. That fit is not a nicety: a hardcoded distance
cropped the near corners on a narrow window, and in a game where enemies come
in from the edges that means dying to something that was never on screen.

## What it is doing

Every frame the light list is cleared and written again from scratch. A shot
carries a light, an enemy carries a light, an explosion carries one that opens
out and dies with the square of what is left, and the muzzle carries one for
about fifty milliseconds. A busy frame is around a hundred and thirty of them.

Nothing is kept between frames. The game renderer offers a `'keep'` mode that
draws the static half once and copies it back, and this demo does not use it:
a moving light relights the arena, so keeping the static frame and having
dynamic lights on static geometry are alternatives rather than an optimisation
you get for free. Redrawing everything costs about a millisecond and buys the
floor lighting up under each explosion.

All the geometry is generated. The arena floor, its tiles, its blocks and its
columns come out of the same parametric library the still-life renderer draws
jewellery with; so does the player, which is a brilliant-cut gem, and the
enemies, which are seven-pointed stars. There is no model file anywhere in the
project.

## What it costs

Measured on a Mac mini (M-series) at 1920×1080, fenced on the queue rather
than timed off `requestAnimationFrame` — a browser tab that is not being
composited stops calling back, and reads as a scene that mysteriously got
slower. `measure(width, height, frames)` is on the console for repeating it.

| scene | lights | ms a frame |
| --- | ---: | ---: |
| empty arena | 18 | 0.64 |
| 20 enemies | 37 | 1.05 |
| 70 enemies | 90 | 1.91 |
| 140 enemies | 146 | 3.12 |
| 140 enemies, point lights off | — | 0.29 |
| 140 enemies, effects off | 146 | 3.14 |

Medians of five runs of 120 frames each; one run in five came back 40% high,
which is why they are medians rather than firsts.

So the point-light loop is 2.8 ms of the 3.1 — about **0.019 ms a light** at
1080p — and the additive effect stage, up to a couple of hundred glows, does
not show above the noise at all. A frame at sixty is 16.7 ms, so there is room
for something like seven hundred more lights before the loop is the problem,
and no reason at all to reach for tiles or clusters at this scale.

Do not read the frame rate in the corner as the cost of any of this. It is
wall-clock between `requestAnimationFrame` callbacks, and a tab the browser is
not compositing stops calling back — which shows up as a scene that
mysteriously got four times slower while the GPU was doing the same work.

The numbers are one machine's and every one of them is fill-bound, so a
laptop with an integrated GPU will read differently. The renderer's calibrator
and quality ladder exist for exactly that and this demo does not use them yet.

## Layout

| file | |
| --- | --- |
| `src/main.ts` | wiring: device, meshes, pools, the frame loop |
| `src/game.ts` | state, flight and rules. Knows nothing about the GPU |
| `src/scene.ts` | the parametric parts and where the static half stands |
| `src/lighting.ts` | the light list and the glow list, rebuilt every frame |
| `src/matrix.ts` | placements, and projecting a point to the screen |
