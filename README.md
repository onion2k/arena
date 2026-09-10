# Arena

A night circuit, on the game path of
[artshape-render](https://github.com/onion2k/artshape-render): drive a truck
round a lit track over rolling ground against three others, and try to take a
second off your best lap.

It was an arena shooter until the driving turned out to be the more
interesting half. The drones, the gun and the score are gone; the vehicle they
were standing on — suspension, tyres, and a floor with hills in it — is the
whole game now.

![the circuit](docs/arena.png)

## Running it

```bash
npm install && npm run dev
```

Needs a browser with WebGPU.

| | |
| --- | --- |
| **A** **D** or ← → | steer |
| **W** or ↑ | throttle |
| **S** or ↓ | brake, and reverse once stopped |
| **R** | back to the line |
| drag | swing the camera round |
| wheel | in, or out until the whole circuit is in frame |
| **C** | put the camera back |

## The field

Four cars, the player's and three driven by the same line-follower that has
been testing the track since it existed. It reads the centreline the lap
counter reads — offset by its own preferred line, looking further up the road
the faster it goes, lifting and braking for whatever it cannot steer round.
No racing line solved in advance, no lap of practice, no memory of the corner
it is in.

A precomputed ideal line with a speed for every corner is what a serious
racing game does and would drive better than this. It would also be a second
description of the track, needing redone every time the circuit changed.

Two things it needs beyond following: a pull back toward the middle when it is
off the road, because a driver that runs wide and keeps its preferred offset
points further off it and ends the race beached on the inside; and a reverse,
because a car cannot steer without moving and is pushed straight back out of
whatever it hits, so without one a single bad corner ends its race where it
happened.

Cars are pushed apart and their closing speed exchanged. Not a real impulse —
no spin, no mass, nothing conserved — but enough that a car cannot be driven
through, and that being leaned on in a corner costs you the corner.

## The truck

It is a rigid body on four wheels, not a dot with a velocity. Every frame a
ray goes down from each wheel to find the ground; each wheel that finds it
pushes the body up through a spring and a damper, and that push is also the
load that wheel is carrying and so the size of the friction circle its tyre
has to spend. In that circle each tyre kills what sideways velocity it can and
drives or brakes along its own facing, and asking for more than the circle
holds is what makes a corner a corner. Everything is summed as force *and* as
torque about the centre of mass, so it dives, leans and pitches over a crest
without any of those being written down anywhere.

It steers rather than turning: the front wheels point, and a stopped car does
not rotate. Hold the brake once it has stopped and it reverses, which matters
more than it sounds — a car pushed straight back out of whatever it hits, and
unable to steer without moving, is wedged there forever otherwise. Space is
the handbrake, which is a different thing: it locks the back wheels and takes
most of their sideways grip, and is for pointing the truck somewhere other
than where it is going.

A wheel with no ground under it makes no force at all, so a jump is not a
special case: the springs run out of travel, the wheels stop pushing, and
gravity is all that is left.

It was too light, too slidy and too wide in a corner. What fixed each:

- **Light** was the springs. It sagged 13mm of its 26mm of travel standing
  still — half the suspension used up doing nothing — so the body floated and
  pitched at every input. At 305 it sags 8mm and a 60mm drop settles in 0.2s.
  Anti-roll bars took the lean out without taking the travel out, and the
  inertias carry a gyration factor, because a vehicle is not a uniform box:
  its mass is at the corners, and how long something takes to agree to change
  direction is most of what tells you it is heavy.
- **Slidy** was the tyres taking 90ms to decide, and not a shortage of grip.
  At 55ms they bite. Grip went up too, which mattered less than it sounds.
- **Short** it stayed until later. The wheelbase is 220 now and the body 300,
  a third longer between the axles than the 166 it was built with. A long
  wheelbase is a calmer truck and a wider turning circle, and the circle is
  the thing to watch: turn radius is wheelbase over tan of the road wheel
  angle, so 33% more wheelbase is 33% more radius on the same lock, and the
  circle at 1500 mm/s went straight from 443mm to 560 against a tightest
  corner of 568. That is no margin at all, and it is exactly the state the
  steering lock was raised to fix once before. Taking the lock from 0.62 to
  0.72 — 41 degrees at a standstill, the top of what a real rack gives — puts
  it back to 458/482/506mm at 900/1500/2100. The inertias are worked out from
  the body length, so lengthening it makes the truck slower to pitch and to
  change direction, which is most of what the extra length is for.
- **The turning circle** was the steering lock winding off too hard with
  speed. At 1500 mm/s it was leaving 0.116 radians, a 1426mm circle — wider
  than the tightest corner on the track, so that corner could not be taken at
  speed however much grip there was. It now keeps 0.23 radians and turns
  inside 800mm.

The brakes are deliberately weaker than the tyres. Grip alone stopped it from
full speed in sixty millimetres — a fifth of a truck length, in a tenth of a
second — which is not a brake but a wall, and it took braking out of the game
entirely: no corner had to be slowed for. Capped, it stops in 1.6 truck
lengths, and where to brake is a question again.

Together those took a lap from 8.65 seconds to 5.60, and the line-follower
that drives it from wandering 295mm off the centreline to 56.

### Then it turned out none of that was the limit

All of the above is about the car being heavy and precise, and it worked, and
the game still was not much fun to play. Measuring the thing nobody had
measured said why. On a full-lock skidpad at every speed the truck can reach,
it used **between four and fifteen per cent of the grip it had**, peaking at
0.31g of lateral acceleration against tyres worth 2.15. The tightest corner on
the circuit asks 0.87g at top speed. So the tyres were never the limit,
nothing could overdrive a corner, nothing a bump or a throttle did could
unsettle it, and the radius it turned in was decided by the steering geometry
alone. It was a slot car with a minimum radius, and the only input that
mattered was holding the wheel over and waiting.

Four things followed from that.

- **Grip came down to 1.35 and the steering falloff went up to 2600.** Full
  lock at 2200 mm/s now asks for 1.03g against the 1.35 the tyres have. Peak
  lateral went from 0.31g to 0.76 and grip use from 4–15% to 26–56%: the
  driver can ask for more than the car has, which is the only way a limit can
  be something you drive to. It cannot go much lower while the engine is this
  strong — the rear tyres have to be able to put 5800 down, and at 1.05 they
  could not, so a field of four spent 91% of a race stationary and spinning
  its wheels.
- **The rear tyres get 92% of the front's grip**, so the back lets go first
  and lets go progressively, and there is something to catch.
- **`gripAt` was wired in.** It had been sitting in the track module, fully
  written, called by nothing: the grass gripped exactly as well as the road. A
  racing line you are not punished for missing is not a racing line. It takes
  a third of the grip away over a 200mm shoulder, and off-track rolling
  resistance takes speed as well — needed because on a track defined as a
  radius about a middle, cutting the inside makes the lap *shorter*, and the
  fastest driver in the field was doing exactly that for a fifth of every lap.
- **A handbrake**, on the space bar, which is the one input that is not a
  request for more of something.

The measured result, over a two-minute four-car race: every car finishes, best
laps 14.18 to 14.82 seconds, no spins, no car stationary at any point, and
10.7% of the time with a wheel off the road. Solo, the four skill levels
separate by 1.7 seconds a lap.

### The handbrake is not a fast way round anything

It was swept over how much sideways grip it leaves the rear and how hard it
locks, and it never once turned the truck through more of a corner than
steering did: cutting the rear's sideways grip cuts the rear's share of the
cornering with it, so the truck rotates and runs wide at the same time. What
it buys is 45 degrees of slip angle that comes back the moment you let go,
for three quarters of the speed carried in. That is what a handbrake turn
costs a real car too, and it is kept on those terms.

Getting there took three wrong tunings, each of which is recorded in the
source where it matters:

- Left alone the handbrake took **99% of the speed away in seven tenths of a
  second** — a parking brake, not a drift. Its longitudinal force is capped
  now.
- That was also why it looked random. With the truck nearly stopped, any
  rotation at all reads as a slip angle of 180 degrees, so the same key gave a
  tidy 42-degree slide at full lock and an apparent spin at three quarters.
- Fading it out on the yaw rate rather than the slip angle sounded better and
  measured worse. It is on the slip angle, with full grip back by 60 degrees —
  well inside the 90 past which a tyre stops arresting a spin and starts
  feeding it, because once the truck is travelling sideways the direction its
  contact patch is sliding is along the truck rather than across it.

### The drivers

An opponent follows the centreline offset by a line of its own, and it now
does two things it did not. It **steers for a yaw rate** rather than
multiplying the heading error by a constant: that constant was chosen when
full lock at speed was 0.23 radians and could not spin anything, and with the
lock the truck has now it saturated at any error over 22 degrees and put full
opposite lock on at 2000 mm/s. And it **brakes for the radius ahead** rather
than for the corner it is already in — it reads how tight the track is far
enough up the road to stop from here, works out what the tyres will hold
there, and arrives already slowed.

That rule does not currently fire, and it is worth saying so rather than
leaving the claim standing. Measured over a lap since the wheelbase went up:
the driver is at **full throttle 100% of the time**, and its speed never gets
past 79% of the limit it works out, median 56%. The truck's top speed is below
what the tyres would hold in every corner on this circuit, so what limits a
lap is the engine against the drag, not the road. The rule stays because it is
the right one and because more power or a tighter corner would make it bite —
but nothing out there is being out-braked today.

It also aims at a point corrected outward by the sagitta of the chord it is
driving. A driver steering straight at a point on an arc passes inside that
arc — at the tightest corner here, 178mm of a track whose half width is 380 —
which is why the fastest car in the field spent a fifth of its lap off the
road on the inside of every corner. Correcting it took that from 20.9% to
9.7%, and the other three drivers to zero.

## The circuit

A closed loop 29 metres round, defined in polar form — a radius that varies
with the angle about the middle of the arena. That is a real constraint on the
shape, no hairpins and no figure of eight, and it buys something worth more:
the nearest point on the centreline to anywhere in the arena is the point at
the same angle, so **how far round the lap you are is `atan2(y, x)`, exactly,
for nothing.** No search along the curve, no accumulating error, and a start
line that cannot be crossed sideways.

A gantry either side of the line holds you for four seconds: five bulbs on
each post light in turn, all ten go out, and the clock starts. Nothing is timed before that —
a lap measured from whenever the page happened to finish loading is not a lap
time. The truck is held on its handbrake rather than frozen, so it settles on
its springs where it stands instead of being dropped there at the go.

A lap counts when that progress wraps forward past zero, and only if you have
been round the far side since the last one — so rocking back and forth over
the line counts nothing, and reversing over it un-arms the next lap rather
than scoring one.

The tightest corner is 568mm. The truck's steering lock winds off with speed,
so it turns inside 631mm at 1200 and 1015mm at full speed — which is to say
that corner has to be braked for, and a lap is a question about where.

Scaling a track up scales every corner with it, so a circuit three times the
size is three times easier to drive. A third and faster term in the radius
puts corners back in that are tight against the truck rather than against the
radius of the loop.

Everything about the track is measured along the radius, because that is what
makes the progress free — but the radius is only perpendicular to the track
where the track is a circle, and this one is not. Where the radius changes
fast the two are well apart, and a step outward along the radius is mostly a
step *along* the track rather than across it. Correcting for that is one
cheap factor, and without it the trackside posts sat far closer to the racing
line than their 640mm claimed: 437mm of real clearance at the worst corner,
against the 176 a truck and a post need between them. Off the
tarmac the grip falls away over 200mm rather than at a line, so running wide
is a mistake that costs rather than a wall.

### Behind the truck, on V

An experiment, and off by default. The overhead view is the game's own; this
puts the camera 1500mm behind the truck at 22 degrees above the horizon and
turns it with the nose.

It is driven through the orbit controller rather than around it — the mode
writes an azimuth every frame and leaves the polar and the radius to the drag
and the wheel, so how high and how far back the chase sits is still the
player's, and only which way round the truck to stand is taken away. The
controller's own easing is the camera lag, and measures at 5.4 degrees behind
the nose at 1.24 rad/s of yaw and 8.3 through a handbrake slide, with the
truck never leaving the middle of the frame by more than 0.03 of its width.

Two things had to be got right, and both were wrong first:

- The azimuth is kept as a **continuous angle, never wrapped into a turn**,
  and entering the mode picks the value nearest where the camera already is.
  The orbit eases toward what it is handed by plain interpolation, so an angle
  a full turn away from an identical one is a camera that swings the long way
  round to arrive where it could have reached in a fifth of the distance. It
  did exactly that: 4.95 radians, on a switch that should be barely a
  movement.
- The **lead is a third of what the overhead view uses**. 0.32 seconds of
  travel at racing speed is 590mm, which from 3900mm up and back is a nudge
  and from 1500mm behind is the truck off the side of the frame.

What it costs is what you would expect: from behind, the posts are in the way
and the road ahead disappears over every crest, so it is much harder to see
what the corner does before arriving. That is the trade the overhead view was
chosen to avoid, and it is why this is on a key rather than instead.

## The minimap

The whole circuit in the corner, with a dot per car. Two dimensions and no
GPU: the track is an analytic curve, so its shape is an SVG path built once
at startup from the same function the wheels and the lap counter read, and
the only thing that changes from frame to frame is four pairs of coordinates.
A second render pass would cost a second pass; this costs eight attribute
writes.

## The camera

It follows the truck at a fixed distance behind it, leading it a little in the
direction it is going so there is more road ahead than behind. The circuit
does not fit on one screen and is not meant to: the view is about five metres
wide against twenty-nine of track, and the road scrolls past.
Zooming out to the whole circuit is still there for looking at the lap you
have just driven.

The distance is a length rather than a fraction of the arena, which is the
point of the change: how much road you can see should not depend on how big
the circuit happens to be. It used to be held on a leash whose length was how
much of the arena was off screen, which kept the whole thing in frame — right
when the whole thing fitted, and it no longer does.

## The ground

The tarmac is one ribbon of triangles following the centreline, and not a run
of slabs. Slabs were placed at even steps of arc measured on the centreline,
which is fine on a straight and wrong on a corner — the outer row spreads and
the inner bunches, so the road broke into scattered paving exactly where the
track turned. It is lifted 22mm above the terrain, which has to beat the
difference between two linear interpolations of the same curved surface at
different spacings: the ground is sampled every 85mm and the ribbon every 90,
which over the sharpest ramp is about five millimetres either way.

Under it is a field of shallow hills described by one function that the wheels, the ground
mesh, the tarmac, the posts and the walls all read. Nothing approximates
anything else, so the truck can never be seen floating over a hill or sunk
into one.

Each wave is a plain sine except the ramps, which are multiplied by a much
longer wave — an envelope — so that they appear in bands with rolling ground
between them rather than covering the floor. That envelope is cubed. A plain
sine one is above half for half of its cycle, which meant a ramp that was
exciting at its crest was a washboard everywhere else and the arena read as
corrugated iron: the median slope of the whole floor was 14 degrees, and it
was the ramps setting it. Cubed, it has fallen to an eighth of its height by
the midpoint of the cycle, and the median is 5 degrees with the 95th
percentile still 24 — a smooth floor with steep ramps in it.

Narrowing the bands moved them, though, and the one the circuit used to cross
came off it: the speed needed to leave the ground anywhere on the racing line
went from 1559 mm/s to 2373, which against a top speed of 2800 is no jump at
all. The envelope's length and phase were swept for a band that lands back
under the road without the floor going rough again. It needs 1443 mm/s now,
over about 5% of the lap, and a run over the crest at 2400 lifts all four
wheels for five frames and 48mm of daylight.

The kerbs are blocks laid down both edges of the tarmac, red and off-white
alternately, which is two meshes rather than one because material here belongs
to a draw. The tarmac and the ground either side of it are both dark, and a
change of shade at a grazing angle in the dark is not an edge you can drive
to; a banded strip that catches the floodlights is legible far enough ahead to
plan a corner. They stand 8mm proud of the road and nothing collides with
them.

### Then they turned out to be steep enough to strand a car

The ramps' flanks reached 29 degrees and the tarmac 32. A car on the shoulder
either side of the road cannot climb past **23.5** from a standstill — the
reduced grip out there leaves the rear tyres unable to put the engine down —
so a car that ran a little wide onto a ramp flank and stopped, stayed, wheels
spinning. The drivers found it reliably.

A sine's steepest gradient is A·2pi/L and its curvature at the crest is
A(2pi/L)². One is what strands a car and the other is what throws it, and they
are not the same number, so shortening the wave and taking the amplitude down
with it moves them apart. At 36 by 720 the steepest ground within a truck's
width of the road is 21.9 degrees against 32, the arena's worst anywhere is
22.1 against 32.9, and none of the thirty steepest spots beside the road holds
a car that stops on one — the slowest climbs away to 1467 mm/s. A three-minute
four-car race runs 12 to 13 laps a car with best laps of 13.40 to 13.90 and
**nothing stationary at any point**, against 14.15 to 14.82 before.

The jump is the price, and it was not recoverable:

- The amplitude cannot simply be dropped to buy the curvature back: at 26 of
  amplitude the crest condition said the truck should fly at 1716 mm/s, and at
  2300 it did not lift a wheel. (The reason first given here was that the
  springs absorb a crest no taller than their travel. That was wrong — see
  below.)
- Nine (amplitude, length) pairs were measured across the whole range that
  keeps the slope under 25 degrees. Not one got all four wheels off the ground
  at a speed the truck can reach.
- Making the shoulder climbable instead does not work either. With it softened
  from taking a third of the grip to taking a seventh, and the old ramps put
  back, seven of the thirty steepest spots beside the road still held a
  stopped car. The limit is the engine against the truck's weight on a slope,
  not the surface.

#### Why it cannot jump, corrected

It is not the suspension travel, which is what this file said first. `TRAVEL`
is the clamp on how far a spring may be *squashed*; the reach that decides
whether a wheel is touching is `REST + WHEEL_RADIUS` below the mounting point,
and `TRAVEL` does not appear in it. Measured at 26, 45 and 70 over the sharpest
crest on the circuit, the three runs are identical frame for frame. Droop is
the quantity that matters and it works the wrong way round — more of it holds
the wheels down, and even at a droop of 10mm, which is a very harsh truck, all
four came off for a single frame.

What stops it is the truck's own length. One wheel lifts easily: there is 8mm
of static sag, so the body need only rise that far. For all four to lift, the
ground has to fall away from the whole 250mm of it at once, and over any crest
gentle enough to be safe the truck pitches through instead — nose up on the way
in, which plants the rear, then nose down over the top, which plants the front.
Logged over a purpose-built ramp: front wheels at zero compression while the
rear read nine, and by the time the rear reached zero the front was back down.

Purpose-built ramps were tried, on the tarmac only, where the surface allows 31
degrees rather than the shoulder's 23.5 — twelve shapes, including asymmetric
ones ending in a lip. The lip does get all four wheels off. For one frame. That
is a flick, not a jump, and it costs 27 to 32 degrees of slope on the racing
line, so it was taken out again.

And the thing that makes the trade easy: **that same race, measured on the old
steep terrain, never got all four wheels off either.** The jump only existed in
a straight line at 2400 mm/s in a test, never in a lap. What this gives up is
very nearly nothing that was being had; what it buys is a race-ending bug.

The ramps in it are sized against the truck rather than for the look. A wheel
leaves a crest when v²·κ exceeds gravity, but the climb is paid for out of the
same speed, so for each wavelength there is a best height and a lowest
approach speed that can clear it at all: 520mm wants 1800 mm/s, 650mm wants
2015, 820mm wants 2263. They are 650 by 52 against a top speed of about 2400.
Nothing shorter, whatever it would do for the jumps: at three wheelbases the
axles sit on opposite phases of every ripple and a truck that should be riding
a hill is being shaken by a washboard.

## The light

Eighty-four floodlights on the trackside posts light the circuit and nothing
else, which is what makes the track read as a track: the environment
contributes 0.035 of what it would and the sun is nearly off. They used to
sweep, which was right when the game was about finding things in the dark and
is wrong now — a driver needs to know what a corner does before entering it,
and a light that will be pointing elsewhere by the time you arrive is worse
than no light.

### They are street lights, and they stand back

They were eight-sided columns 88mm across with a floodlight balanced on top,
standing 260mm from the edge of a road 760 wide — at the scale of this arena,
a row of chimneys on the shoulder, and the circuit read as a corridor.

A lamp post is three pieces now: a slim pole, an arm out over the road, and a
head on the end of the arm. That shape is the point and not the decoration,
because it is what let the posts move: **a light on top of a column has to
stand where the light is wanted, and a light on the end of an arm does not.**
So the poles went from 260mm off the tarmac to 470 and the mast went from
88mm across to 34, while the lamps themselves stayed within 30mm of where
they had always been — the cone from each still crosses the full width of the
road with about 190mm to spare, and the circuit is lit exactly as it was.

Which way a post's arm reaches is now a property of the post rather than
something worked out from its position in a list. It had been derived from
the index in two different files, and one of them had the parity backwards
for a while: half the floodlights spent that time lighting the empty middle
of the arena while the road beside them stayed dark. There is one definition,
`lampAt`, and the arm, the head, the beam and the glow are all placed from
it, so a head is never anywhere but on the end of its own arm.

The alternating tall-and-short posts went with them. That was a depth cue
when they were columns; a row of street lights of two different heights just
looks wrong, so they vary by six per cent instead of forty.

The head of every post is drawn as a glow as well. A post is lit by its own
flood from directly above and so is barely lit at all: the outer row stood as
black poles against a black arena, which is clutter rather than scenery, and a
line of lamps running away round a corner is the strongest thing in the scene
for showing where the track goes before you get there. They are glows and not
lights — nothing is being lit, only seen — which is a screen-space quad each
against a light's whole shading loop. The kerbs and the eighty-four post heads
together cost 0.16ms of a 2.65ms frame at 1080p, measured fenced, median of
five.

The truck carries two headlamps that wash the road ahead, an exhaust glow
under power and brake lights, all bolted to a body that pitches and rolls, so
they are placed and aimed in its frame rather than on a plane at zero.

## What it costs

Measured on a Mac mini (M-series) at 1920×1080, fenced on the queue rather
than timed off `requestAnimationFrame` — a browser tab that is not being
composited stops calling back, and reads as a scene that mysteriously got
slower. `measure(width, height, frames)` is on the console for repeating it.

| | lights | ms a frame |
| --- | ---: | ---: |
| the circuit, driving | 31 | 1.18 |

Less than half what the shooter cost, which was 2.63 ms: the crowd is gone,
and with it the tracers, the explosions and the searchlight. A frame at sixty
is 16.7 ms. Nearly all of the 1.18 is the floodlights, which burn whether the
truck is moving or not.

The CPU side is **0.02 ms** a step, almost all of it the vehicle — four
substeps of a rigid body on four suspension rays.

Do not read the frame rate in the corner as the cost of any of this. It is
wall-clock between `requestAnimationFrame` callbacks, and a tab the browser is
not compositing stops calling back — which shows up as a scene that
mysteriously got four times slower while the GPU was doing the same work.

## Layout

| file | |
| --- | --- |
| `src/main.ts` | wiring: device, meshes, pools, the frame loop, the camera |
| `src/game.ts` | the race: the truck, the walls, the lap and the clock |
| `src/vehicle.ts` | the truck: suspension, tyres, a body with mass |
| `src/track.ts` | the circuit, and where on it a point is |
| `src/terrain.ts` | the ground, as one function everything reads |
| `src/scene.ts` | the parametric parts and where the static half stands |
| `src/lighting.ts` | the light list and the glow list, rebuilt every frame |
| `src/matrix.ts` | placements, and projecting a point to the screen |
