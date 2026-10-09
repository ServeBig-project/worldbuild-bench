# Run 20261008-183223: stopped by hand at 146 min (GPU needed); all modules landed, no integration

The fourth attempt and the first on harness-v2 (798f10e, 12ee25b). Setup: racing task, 4 builders, local FreeToken
(`freetoken:555efd8`, Qwen3.8-Flash-Next NVFP4, one RTX 4090, up to 4 running requests), output cap 32768, reasoning
effort medium, 150-min budget. Started 18:32:23. Wesley stopped it at 20:58:43, 3.5 min before the budget, because the
GPU was needed for Strata. No result.json exists, so the scores below come from `wb gate`, run by hand on the final
workspace.

All six builder modules landed, and the game loads, renders and drives. The root never reached integration: when the
run stopped it was still waiting in `spawn_agent` for builders 2 and 3.

| time | event |
|---|---|
| 18:32:23 | run start; the root plans alone |
| 18:37:33 | PRD.md (one 7.7K-token turn) |
| 18:43:44 | contracts.md, the shell (index.html, main.js) and 6 stubs; `check_modules` OK |
| 18:45:00 | `test_game` passes after the root fixes a 404 in the import map |
| 18:50:16 | the root spawns 4 builders (turn 15; 24.8K output tokens in total). Root planning took 17.9 min |
| 19:09-19:43 | first real code: player.js 19:09, race.js 19:27, ai.js 19:32, track.js 19:37, hud.js 19:43 |
| 19:45-19:58 | the overwrite guard stops builders 1 and 3 from wiping their own files; `check_modules` flags a half-written track.js and an ai.js with no exports |
| 20:02:00 | all six modules filled in (demo snapshot `run4-t090`, t+89:36) |
| 20:14:36 | `check_modules` OK across all 7 modules |
| 20:31:01 | builder 4 (race + HUD) finishes |
| 20:46:56 | builder 1 (track) finishes |
| 20:22-20:58 | builder 2 says "done" 7 times; it answers each finish nudge with one more check, so it never ends |
| 20:58:43 | stopped by hand. Builders 2 and 3 each had a request open; builder 3 was still tuning the AI in scratch sims |

## Per agent

| agent | role | turns | output tokens | largest turn | largest prompt | state at stop | files (bytes) |
|---|---|---|---|---|---|---|---|
| root | plan, shell, stubs | 15 | 24.8K | 7.7K | 35.8K | waiting in `spawn_agent` | PRD, contracts, index.html, main.js (5,443) |
| builder 1 | track | 26 | 49.5K | 15.6K | 64.6K | finished 20:46:56 | track.js (28,476) |
| builder 2 | player + camera | 38 (+1 open) | 33.2K | 14.7K | 53.2K | looping on finish nudges | player.js (13,810), camera.js (4,992) |
| builder 3 | AI | 37 (+1 open) | 67.1K | 15.5K | 79.8K | still tuning | ai.js (15,555), plus 9 scratch files in `.ai_test/` |
| builder 4 | race + HUD | 20 | 27.7K | 11.0K | 39.5K | finished 20:31:01 | race.js (6,505), hud.js (12,657) |
| total | | 136 | 202.2K | | | | |

No reply hit the 32,768 cap (122 `tool_use`, 14 `end_turn`). The longest turn (builder 1, 15.6K tokens) took 18 min.

## Engine concurrency

The client kept 4 requests open for 78% of the build phase. The engine ran far fewer. From the FreeToken decode log
after 22:32:23Z, weighted by time:

| phase | running requests | share of phase | median gen throughput (tok/s) | median KV use |
|---|---|---|---|---|
| root only (17.9 min) | 1 | 100% | 25.6 | 23% |
| build (128.4 min) | 1 | 65% | 27.6 | 38% |
| | 2 | 33% | 29.4 | 33% |
| | 3 | 1% | 11.2 (during prefill) | 11% |
| | 0 | 1% | | |

- 4 never ran together. 3 ran only in the first seconds after the spawn, while the prompts were ~6K tokens.
- `#queue-req` was above 0 for 128 of the 128.4 build minutes; 3 requests were queued in 52% of the log lines.
- Each admitted request decoded at about single-stream speed (median 27 tok/s per request, from the transcript).
  The builders together produced 23.0 tok/s (177.5K tokens in 128.4 min), the same rate as the root alone
  (24.8K in 17.9 min). Four builders bought no throughput.
- Median time to first token: 3.5 s in the root phase and 122 s in the build phase (p90 302 s, max 17.4 min).
  Prefill ran at ~2,500 tok/s, so most of that wait was queueing. Median call: 17 s versus 169 s.

**KV admission (inferred).** The KV pool holds 122,240 tokens. While requests waited, KV use was 26-53% (p10-p90; max
66%), so memory was not full. The numbers fit an admission rule that reserves each request's full 32,768-token output
cap on top of its prompt. Under that rule, two requests fit only while prompts stay under ~28K tokens
(2 x (28.3K + 32.8K) = 122K), and three only under ~8K. Builder prompts grew to 12-80K, so the engine mostly ran 1 and
sometimes 2. This is not confirmed in the FreeToken source. A lower per-turn cap (no turn here passed 15.6K) should
admit more. Run 2 measured only 30.5 tok/s in total at 4-way, so more admission would mainly cut the queue wait,
not raise throughput.

## Harness-v2 features seen working

- **Streaming.** Calls ran up to 18 min with no transport errors, and every reply logged its first-token and total time.
- **Overwrite guard.** Builder 1 (19:45:23, track.js at 13,589 bytes) and builder 3 (19:57:55, ai.js at 7,718 bytes)
  each sent a later part without `append: true`. Both writes were refused, and both agents resent the part with
  `append: true` (19:50:11 and 20:01:57). In run 3 the same mistake wiped `createPlayer`. Builder 1 built track.js in
  four parts this way.
- **check_modules.** At 19:45 and 19:48, builders 2 and 4 got "js/track.js: syntax error (line 339)" (a part not yet
  appended) and "js/main.js imports createOpponents, updateOpponents, resetOpponents from ./ai.js, but js/ai.js
  exports: (nothing)". Both cleared once the owners finished, and all 7 modules passed from 20:14 on. The builders
  correctly read these as their siblings' problems. 13 calls in total.
- **Empty-reply note.** Builder 3's one empty reply (19:47; 2.5K tokens of thinking, `end_turn`, no text) was dropped
  with a note, and its next turn carried on with an edit.

## Problems seen

| event | count | who |
|---|---|---|
| finish-confirmation nudge | 11 | builder 2: 7, builder 1: 2, builder 4: 2 |
| write_file overwrite refusal | 2 | builder 1, builder 3 |
| empty reply | 1 | builder 3 |
| invalid tool input (`edit_file` without `path`) | 1 | builder 3 |
| bash rejected (absolute path or `..` outside the workspace) | 6 | builders 1 and 3: 2 each; builders 2 and 4: 1 each |
| `error` events | 0 | |

**Finish loop.** An agent ends after two replies in a row with no tool call. Builder 2 answered each nudge with one
more check (`check_modules` or a grep), then said "done" again, which reset the count. It spent its last 36 min
(7 nudges) this way and never returned. A cap on nudges per agent would end it.

## Scores

`wb gate` on the final workspace (headless Chromium with SwiftShader; it wrote `screenshots/`):

| score | value | failed gates |
|---|---|---|
| Playability | 80/100 | `no_fatal_errors` (3 console errors), `stable_fps` (15.6 fps under SwiftShader; threshold 25) |
| World Coherence | 100/100 | none |

`input_response` passed because the state and the screenshot changed, but it reported "player moved: false". A stub
game scored 100/100 on both in run 1, so these scores alone do not show quality.

## Page check and test drive

I served `workspace/` on 127.0.0.1:8093 and loaded it in Playwright (headless Chromium, `--enable-unsafe-swiftshader`).

- 0 page errors and no failed requests. The 3 console errors are all `THREE.WebGLProgram: Shader Error ...
  VALIDATE_STATUS false` for `MeshDepthMaterial` (the shadow pass). This is probably a SwiftShader limit; it was not
  checked on a GPU.
- W held for 4 s right after load: no motion. The race opens with a 3 s countdown (4.0 s of wall time at this frame
  rate), and the hold ended just as the race went live. State went from `menu` to `playing`, speed stayed 0, and the
  position stayed at (191.76, 0, -21.48). This is why the gate saw "player moved: false".
- W held for 4 s after the start: position (191.76, -21.48) to (230.05, 37.92), 70.7 units; speed 31.2 u/s
  (112 km/h); state `{phase: playing, lap: 1, place: 1, elapsed: 3.23}`. Screenshot: `final-drive.png` in the run dir.
- The start grid shows the real scene: road, curbs, start gantry, palms and two AI cars (gate shot
  `screenshots/screenshot-2s.png`). The AI cars drive the course by themselves.

Two bugs showed up in the drive:
- **Off-road speed never drops while accelerating.** Off the road, player.js pulls speed toward 18 u/s at 16 u/s², but
  throttle adds the same 16 u/s² (`ACCEL = 16`, `OFF_EXTRA_DRAG = 16`). Holding W, the car ran straight off the first
  left bend and kept 112 km/h across the sand for 8+ s, while `track.project` reported `onRoad: false` (lateral 30-140
  on a 16-wide road). final-drive.png shows this.
- **Wrong place at the start.** The grid sits just behind the start line (s = 1,048 of 1,070), and race.js ranks by
  `completedLaps x length + s`. AI cars that cross the line wrap to s = 0, so a player parked on the grid reads 1st/3,
  on the HUD as well, until it crosses the line too. Then it drops to 3rd.

## Unfinished

- No integration. The root never got back from `spawn_agent`, so nobody playtested the assembled game or fixed the two
  bugs above. main.js is still the root's shell from 18:41.
- Builder 3 was still tuning AI steering in offline sims. Its 9 scratch files are still in `workspace/.ai_test/`.
- Builder 2 was stuck in the finish loop.
- No wrap-up turn and no result.json.

## Files

- Logs: `runs/20261008-183223-racing-qwen38-flash-next-local/{console.log,freetoken.log,transcript.jsonl}`. Gate shots
  are in `screenshots/` and the drive shot is `final-drive.png`.
- Last dashboard shots: `~/worldbuild-demo/dashboard-shots/dash-203521.png`, `dash-204534.png`, `dash-205547.png`,
  and `dash-205957.png` (after the stop).
- Deliverables: `~/worldbuild-demo/deliverables/run4-t090` (tag `run4-t090`, commit efeba64, t+89:36, the first
  snapshot with all six modules filled in) and `run4-final` (ce7ccbe, t+146:14). Each also has a `.tar.gz`.
- From t+129:40 on, the demo repo's snapshot commits are labeled "integration/repair (root)". That label is wrong: the
  transcript shows only builder edits after that point.
