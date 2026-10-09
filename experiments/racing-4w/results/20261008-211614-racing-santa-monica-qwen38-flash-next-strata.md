# Run 20261008-211614: Strata, stopped by the context limit at 106 min; the root never spawned builders

The first run on the Santa Monica brief (`racing-santa-monica`, 9.3 KB versus 3.4 KB for the old racing brief) and
the first on Strata. Setup: harness-v2, 1 root + 4 builders planned, local Strata (`strata:0.1.40-sm89-cgfix`,
Qwen3.8-Flash-Next UD-IQ4_XS GGUF, MTP speculative decoding `--spec 4`, INT8 KV with `--kv-resident 32768` of a
131,072-token context), one RTX 4090, output cap 32768, reasoning effort medium, no time budget. Started 21:16:14. At
23:02:41 (t+106.4) the runner stopped on HTTP 400: "prompt (100138 tokens) + max tokens (32768) exceeds the context
(131072)". result.json exists: 69 turns, 65.6K output tokens, all from the root.

The root worked alone for the whole run and never called `spawn_agent`. What exists is its shell: PRD, contracts,
index.html, a full main.js and 12 stub modules. It loads and drives straight ahead over a flat ground plane.

| time | t+ (min) | event |
|---|---|---|
| 21:16:14 | 0 | start; 5 short turns read TASK.md and the skills (prompt 6.4K to 16.7K) |
| 21:21:39 | 5.4 | `update_tasks` (9-item plan) after a 9.9K-token turn (4.5 min) |
| 21:32:43 | 16.5 | PRD.md (7.2 KB) after a 10.1K-token turn (10.7 min) |
| 21:46:49 | 30.6 | game/contracts.md (13.9 KB) after a 7.6K-token turn (14.1 min) |
| 21:57:38 | 41.4 | index.html (3.1 KB) after a 4.6K-token turn (8.0 min) |
| 22:02:48 | 46.6 | js/main.js (10.3 KB: game loop, phase flow, `window.__bench`) |
| 22:06:45-22:18:12 | 50.5-62.0 | 12 stubs, mostly two per turn: track, race, sky, scenery, vehicle, physics, player, ai, cars, camera, hud, audio |
| 22:18:50 | 62.6 | `check_modules` OK (14 modules). Root output so far 46.0K tokens, prompt 64K |
| 22:19:11 | 62.9 | first `test_game`: one 404, no canvas |
| 22:19-22:34 | 63.6-77.8 | Rapier wasm detour (below), 20 turns |
| 22:33:59 | 77.8 | the real 404 fixed: index.html imported `three.module.min.js`, which the scaffold does not ship |
| 22:34-23:02 | 78.2-106.4 | shader-error detour (below), 24 turns |
| 22:43:37 | 87.4 | demo checkpoint `run-20261008-211614-mvp` (snapshot 713e370, t+84:38) |
| 22:55:46 | 99.5 | `docker update --cpuset-cpus 8-15,24-31` on the Strata container |
| 23:02:40 | 106.4 | `test_game` with 0 console errors after `setPixelRatio(1)` |
| 23:02:41 | 106.4 | turn 69 refused: 100,138 prompt + 32,768 max_tokens > 131,072 |

Against run 4 (FreeToken, old brief):

| | run 4 | this run |
|---|---|---|
| PRD.md written | t+5.2 | t+16.5 |
| contracts, shell and stubs, `check_modules` OK | t+11.4 (6 stubs, contracts 4.6 KB) | t+62.6 (12 stubs, contracts 13.9 KB) |
| shell loads without a 404 | t+12.6 | t+78.2 (with shader errors) |
| builders spawned | t+17.9, after 15 turns and 24.8K output | never (69 turns, 65.6K output) |
| root's largest prompt | 35.8K | 100.1K |
| root decode | 25.6 tok/s (median) | 37 tok/s below 32K context, about 9.5 above it |

Planning produced about 2x run 4's output tokens, and more than half of them decoded at about 9.5 tok/s, a third of
run 4's speed.

## Decode speed

From strata-engine.log (one line per request: prompt, reused, generated, tok/s, drafts accepted), matched 1:1 to the
68 turns. The 20-60 s windows come from the progress lines in strata.log.

| prompt | Strata CPUs | requests | generated | decode tok/s | range (requests of 100+ tokens) | drafts accepted |
|---|---|---|---|---|---|---|
| 6.4-27K (whole turn below 32,768) | 8 hw threads | 7 | 10.5K | 37.4 | 37.1-46.1 | 63% |
| 28K, crosses 32,768 mid-turn | 8 | 1 | 10.1K | 15.9 | | 64% |
| 38-75K | 8 | 37 | 33.4K | 9.4 | 6.6-10.8 | 74% |
| 77-86K (from 22:34) | 8 | 9 | 5.9K | 5.9 | 5.5-6.3 | 67% |
| 87.5K, spans the cpuset change | 8, then 16 | 1 | 2.1K | 7.8 | | 67% |
| 90-98K (from 22:55:46) | 16 | 13 | 3.6K | 14.4 | 12.9-16.3 | 74% |

Two steps are visible inside single requests:

- **The 32K cliff.** In the PRD turn (prompt 28,178) decode ran at 38.8 and 39.5 tok/s for the first two minutes.
  The context reached 32,871 at 120 s, and the next minute ran at 17.5, then 8-11 tok/s for the last 8 min. Speed is
  flat on either side: 35-39 tok/s from 17K to 32.8K, and about 9.5 from 38K to 75K. The cliff sits where
  `--kv-resident 32768` stops holding KV in VRAM and the engine streams the rest from 1.55 GiB of pinned RAM.
  Draft acceptance did not drop (63-74%), so speculative decoding is not the cause.
- **CPU starvation.** froot has a Threadripper PRO 5955WX (16 cores, 32 threads; CPU n and n+16 are SMT siblings).
  The cpusets created at 16:34:16 are `perf` 0-7,16-23 and `rest` 8-15,24-31. The container had CPUs 8-15: 8 cores
  with one hardware thread each, for Strata's 15 pool workers plus its host thread (16 threads). In the request at
  87.5K, 20-s windows ran 5.8-7.0 tok/s from 20 s up to 223 s into decode (about 22:55:50, seconds after the 22:55:46
  `docker update`), then 14.4, 15.6 and 16.1. Over whole turns, 77-86K ran at 5.9 tok/s before and 90-98K at 14.4
  after (2.4x), faster even than the 9.4 tok/s at 38-75K before.

So the path above 32K is CPU-sensitive, while below 32K the 8 threads were enough for 37 tok/s. No request ran at
38-75K with 16 threads, so this run cannot say how much of the cliff is KV streaming and how much is starvation.

A third step at about 22:34 (t+78): about 10 tok/s at 74.7K to a steady 6 from 76.9K on. It coincides with KV read
from RAM per generated token rising from 0.1-0.3 MiB to 0.6-1.2 MiB, and that stayed at 0.65-1.0 MiB after the
cpuset change. It may be context-driven, but froot keeps no sysstat history, so outside load on CPUs 8-15 cannot be
ruled out.

Model calls took 103.8 of the 106.2 min (98%), 99.6 min of it decoding. Prefill was never the problem: 99.0% of the
4.51M input tokens were reused from the prefix cache, and most prompts were read in 1-5 s. At 37 tok/s the whole
65.6K output would have taken about 30 min.

## Why the context ran out

- The root's prompt grew by about its full output each turn. Turn 6 produced 9,922 tokens (thinking, then one
  `update_tasks` call) and the next prompt was 10,075 tokens longer: the thinking stays in the history, as in run 3.
  At the stop: 6.4K start + 65.6K output + about 28K of tool results = 100.1K.
- The harness asks for `max_tokens` 32,768 on every turn, so the largest prompt Strata accepts is 131,072 - 32,768 =
  98,304. Strata refuses rather than shrinking the cap; its message suggests `"fit_max_tokens": true` in the model's
  strata-<model>.json. No turn here produced more than 10.1K tokens. The runner treats the 400 as fatal, so the run
  ended mid-fix with no wrap-up turn.

## Detours

**Rapier wasm (t+63.6-77.8, 14 min, 20 turns, 7.9K output).** The first `test_game` showed one 404. The root assumed
it was Rapier's wasm: it grepped `lib/rapier/rapier.mjs` for how the wasm is loaded, ran `npm view
@dimforge/rapier3d-compat` and `npm pack @dimforge/rapier3d@0.19.3` against the npm registry (3 network calls,
22:22-22:28), and copied `rapier_wasm3d_bg.wasm` (1.57 MB) into `lib/rapier/` at 22:27:59. None of this was needed.
NOTICE.md lists the bundle as `@dimforge/rapier3d-compat`, which inlines the wasm, and the root's own Node check at
22:25:02 printed "RAPIER OK, version 0.19.3" while `lib/rapier/` held only LICENSE, rapier.mjs and VERSION. The 404
remained. At t+77.3 the root curled each file and found the real cause in its own import map, and one edit fixed it.
5 bash commands in this stretch were rejected for absolute paths (`/`, `/tmp`, `//`) or `..`. Nothing stopped bash
from reaching the npm registry.

**Shader errors (t+78.2-106.4, 28 min, 24 turns, 11.7K output).** Once three.js loaded, `test_game` reported
`THREE.WebGLProgram: Shader Error ... VALIDATE_STATUS false` for `MeshDepthMaterial` (the shadow pass, as in run 4,
where it looked like a headless SwiftShader limit) and for `MeshStandardMaterial`. In order, the root:
- switched PCFSoft to PCF shadows, then disabled shadows (a `sed` for this was rejected: the pattern starts with `/`);
- suspected a stuck countdown and checked the race stub in Node, then with `play_game`. The shell drove: 64.4 km/h
  after 1.5 s of W, with `racePhase` racing;
- wrapped the frame loop in try/catch/finally and turned tone mapping off;
- wrote `shader-probe.html`, first under `.tmp/` (the test server answered 404), then at the workspace root. It ran
  5 variants (all off, then adding shadows, tone mapping, hemisphere light, fog and antialias), all clean;
- set `renderer.setPixelRatio(1)`. The `test_game` at 23:02:40 had 0 console errors, and the next turn hit the limit.

The end-of-run gate still counted 1 console error, so the fix is not confirmed. No gameplay code was written in these
28 min.

| event | count |
|---|---|
| bash rejected (absolute path or `..`) | 6 |
| invalid tool input (`edit_file` without `path`) | 1 |
| `test_game` calls | 13 (6 of them on the probe page) |
| `play_game` calls | 1 |
| `spawn_agent` calls | 0 |

## Scores

result.json (gates run by the runner after the stop):

| score | value | failed gates |
|---|---|---|
| Playability | 90/100 | `no_fatal_errors` (1 console error; result.json does not name it) |
| World Coherence | 100/100 | none |

`stable_fps` passed at 39.7 fps. `input_response` passed on state and screenshot change but reported "player moved:
false". All 12 modules are contract stubs, so the score says little (a stub game scored 100/100 in run 1).

## State at stop

- Checkpoint `~/worldbuild-demo/deliverables/run-20261008-211614-mvp` (taken 22:43:37 from snapshot 713e370,
  t+84:38): the shell with stubs. Its probe found no page errors; the car moved 94.6 units in 4 s and reached
  170.6 km/h. The screenshot shows a flat brown ground, a purple sky, one road-edge line, a black box for the car and
  the HUD (lap 1/3, position 1/4, timer, speed, control hints).
- Checkpoint `run-20261008-211614-end-error` (tag, 32f6ae9, t+105:50): the same shell plus the shader edits; the
  probe car moved 164.2 units and reached 216 km/h. Both checkpoints carry the unneeded 1.57 MB wasm, and end-error
  also has `shader-probe.html` at the root.
- Track, vehicle physics, AI, scenery, sky, cars, camera, HUD and audio are all stubs. No builder ran.

## For the next Strata run

- Give the container 16 hardware threads (8-15,24-31) from the start, or have Strata start no more threads than its
  cpuset has.
- Measure decode at 40-75K with 16 threads, to split the 32K cliff into KV streaming and CPU starvation.
- Set `fit_max_tokens` (or a lower per-turn cap) so a long prompt does not end the run. This buys about 20K tokens at
  most: the root's context grows by its full output, so a root that keeps working alone still runs out.

## Files

- Logs: `runs/20261008-211614-racing-santa-monica-qwen38-flash-next-strata/{console.log,transcript.jsonl,result.json,
  strata.log,strata-engine.log}`. Gate shots are in `screenshots/`.
- Deliverables: `~/worldbuild-demo/deliverables/run-20261008-211614-mvp` and `run-20261008-211614-end-error`, each
  with a `.tar.gz`, a `.png` and a `.probe.json`.
