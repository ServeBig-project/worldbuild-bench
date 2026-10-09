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
  chase camera that follows smoothly. Arcade physics are fine — momentum should be felt,
  but drifting simulation is not required.
- **Checkpoints and laps**: ordered checkpoints around the circuit; a lap counts only
  when all checkpoints are passed in order. Show current lap (e.g. "Lap 2/3") and
  race position (e.g. "2nd/3") on the HUD.
- **AI opponents**: at least 2 cars that follow the track at competitive but beatable
  speeds (waypoint following is fine), with simple collision handling against the player.
- **Race flow**: a 3-2-1-GO countdown at the start; a race timer on the HUD.

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
