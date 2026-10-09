# Racing

Build **Sunset Apex**, a 3D circuit racing game: the player races a vehicle against AI
opponents over 3 laps on a closed track with checkpoints.

## Concept

An arcade street-circuit racer at golden hour on the Santa Monica waterfront. The fantasy: threading a sleek
sportback through sweeping coastal bends along Ocean Avenue while the sun sits on the Pacific horizon.

- **Setting and landmarks**:
  - The ocean lies on one side. On the other is a low-rise promenade of Spanish-revival and Art Deco buildings:
    stucco walls, pastel facades, arched windows and rooftop signs.
  - **Palm rows are the signature element.** Rows of tall, slender palms line Ocean Avenue on both sides and stay
    in view for the whole lap. Give them recognizable silhouettes: tall thin trunks with a slight curve, a dense
    crown of fanned fronds against the sunset sky. Instance them so they stay cheap.
  - The hero landmark is the pier with a lit Ferris wheel, visible from most of the lap.
  - Add lifeguard towers on the beach, plus streetlights and barriers that help the player read upcoming corners.
  - Apart from the palms, favor buildings and man-made props over foliage.
  - The ocean is a simple flat plane with a color gradient: no water shader and no reflections.
- **Aesthetic**: detailed stylized, not photoreal. Aim for believable proportions, layered detail and good
  materials, in a warm dusk palette with long shadows. Streetlights and neon accents glow with a subtle bloom.
  The road must read clearly at speed.
- **Sky and light**:
  - One sun drives everything. The visible sun, the sky gradient, the directional light that casts the long
    shadows and the fog/horizon color all share one direction and one warm color. Define the sun once and share it.
  - Use the bundled atmospheric sky (`three/examples/jsm/objects/Sky.js`) with the sun just above the horizon,
    and derive an environment map from it so car paint and glass reflect the sunset.
  - Render the sun as a bright disc with a soft glow (bloom) and a subtle lens flare (`Lensflare`). Draw its
    textures on a canvas: no image files.
  - Add a few layers of soft stylized clouds near the horizon (billboards with canvas-drawn textures), backlit
    by the sun with orange/pink rims and darker undersides, drifting slowly.
- **Cars**:
  - The player car takes the proportions of a modern German performance sportback, Audi RS7-like:
    - a long sloping fastback roof and wide flared haunches;
    - a large dark hexagonal grille and slim LED headlight strips;
    - a full-width LED light bar across the rear and two large oval exhaust tips;
    - big multi-spoke wheels.
  - **No logos or brand names.**
  - AI cars share the same body in different paint.
- **Road**: asphalt with lane markings and kerbs. Show a darker worn racing line and rubber marks that are
  heavier in braking zones and corners. The player's car leaves fading skid marks when it slides.
- **Feel**: fast but forgiving: grip-first arcade handling with a real sense of momentum. Racing the AI is about
  clean lines and overtakes, not collisions.
- **Core loop**: countdown → 3 laps of cornering, checkpoints and overtaking → standings screen → restart and
  chase a better result.

The concept is fixed: interpret it and execute it well rather than replacing it.

## Objective

Finish a **3-lap race** on a closed circuit against **at least 2 AI opponents**, placing
1st to win. The track must be a recognizable closed loop (curves, not a bare oval is a
plus) with visible edges, and off-track driving must be discouraged (slowdown or
reset-to-track).

## Required mechanics

- **Vehicle**: accelerate/brake/steer with keyboard; speed-sensitive steering and a
  chase camera that follows smoothly. Momentum must be felt; physics and collisions follow
  the Physics and collisions section below.
- **Checkpoints and laps**: ordered checkpoints around the circuit; a lap counts only
  when all checkpoints are passed in order. Show current lap (e.g. "Lap 2/3") and
  race position (e.g. "2nd/3") on the HUD.
- **AI opponents**: at least 2 cars that follow the track at competitive but beatable
  speeds (waypoint following is fine), with simple collision handling against the player.
- **Race flow**: a 3-2-1-GO countdown at the start; a race timer on the HUD.

## Physics and collisions

- **Collisions use the bundled Rapier engine.**
  - Give each car one dynamic rigid body and collider, with continuous collision detection on.
  - Add static colliders along both track edges (barriers) and for solid props, plus a ground plane.
  - When a car hits a barrier, it slides along it and loses about 30% of its speed into the wall. It never stops
    dead, gets stuck, or passes through.
  - When two cars touch, they push apart without interpenetrating.
- **Drive and grip come from your own simple tire model**, applied as forces to the rigid body each physics step:
  - Use a bicycle model with front and rear axles and a lateral grip limit, so the car can understeer and
    oversteer.
  - Past the limit the car slides, and counter-steer recovers it.
  - Rapier's `DynamicRayCastVehicleController` is an optional upgrade once the simple model is stable.
- **Fixed physics step**: run physics at 120 Hz with an accumulator, independent of the frame rate, and
  interpolate poses for rendering.
- **One shared vehicle module drives every car.** The AI produces throttle, brake and steer inputs for the same
  physics the player uses.
- **Feel targets and starting values**:
  - mass 1500 kg, wheelbase 2.9 m;
  - 0-100 km/h in about 4 s, top speed about 220 km/h, 100-0 km/h braking in about 35 m;
  - up to about 1.1 g lateral on asphalt;
  - steering lock 30° at standstill, down to 8° at top speed;
  - on sand, grip and top speed halve.
- **Verify with numbers.** Keep the physics step a pure function that also runs in Node, with a test script
  that reports:
  - 0-100 km/h time, top speed and braking distance;
  - steady-state lateral g;
  - speed and heading after a 30° barrier hit;
  - an autopilot lap time.

  Tune the constants until the targets are met.

## Camera

- **Spring and speed**: a chase camera on a critically damped spring. Distance, height and FOV (62° to 76°)
  scale with speed.
- **Look ahead along the track**: aim at `track.sample(s + d)`, where `d` grows from 8 m at low speed to 30 m at
  top speed, so corners open up before the car turns in.
- **Show slides**: follow the velocity direction blended with the heading, so a slide shows its drift angle.
- **Occlusion**: raycast from the car to the camera. When a building, palm or barrier blocks the view, smoothly
  pull the camera in or fade the occluder.
- **Impact feedback**: a short decaying shake on kerbs, barrier hits and car contacts, driven by collision
  events, with a capped amplitude.
- **Cinematics**:
  - During the countdown, run an about 6 s fly-by around the grid that shows the pier's Ferris wheel and the
    sunset, and ends in the chase position at GO.
  - After the finish, slowly orbit the player's car behind the results screen.

## Win / lose

- **Win**: finish 3 laps in 1st place → results screen with final time and standings.
- **Lose**: finish in any other position → results screen with standings.
- Both end screens offer a Restart control that resets the full race without reloading.

## Controls

- `W`/`ArrowUp` accelerate, `S`/`ArrowDown` brake/reverse, `A`/`D` or arrows steer.
- Control hints visible on screen at all times.

## Shared constraints (apply to every task)

- The game must run entirely from **static files** in this workspace: open `index.html`
  from a plain static file server, no build step, no server-side code.
- **No external network requests** of any kind. Use only the bundled libraries under
  `./lib/` through the import map in the provided `index.html` — Three.js, and
  optionally the Rapier physics engine (see the `threejs-game` skill).
- Implement the **`window.__bench` telemetry contract** exactly as specified in the
  `bench-telemetry` skill (player = the player's vehicle; entities = all cars).
  Scoring is capped without it.
- Target **60 fps** on a mid-range machine; use delta-time-based movement.
- Playable immediately: visible instructions, working restart, reachable win and lose
  states. Validate with the `test_game` tool before finishing.
