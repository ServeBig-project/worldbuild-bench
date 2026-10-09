# Run 20261009-000436: Strata, maxcache config, 5 segments, finished by the root at t+370.8 (playability 65, coherence 100)

Santa Monica brief (`racing-santa-monica`), 1 root + 4 builders, Strata `strata:0.1.40-sm89-cgfix` with
`experiments/racing-sm/strata-wb-maxcache.json`:
- all KV in VRAM, which is what a 131,072-token request needs
- `--expert-cache 5700` (5,916 slots, 13.33 GiB)
- `--vram-reserve-mib 2048`
- a 16 GiB / 5-slot conversation cache
- cpuset 8-15,24-31

It ran on one RTX 4090 with output cap 32,768, reasoning effort medium and no time budget. Started 00:04:36; the root
declared the game finished at 06:15:27. That is 370.8 min of wall clock, including 58 min with no agent running
between segments.

The run is **not a clean single-harness run**: the harness was changed three times to get past context limits.

## Segments

| seg | wall | harness | how it ended |
|---|---|---|---|
| 1 | 00:04:36-01:49:57 (t+0-105.4) | harness-v2 (racing-sm/run.sh) | All four builders were spawned at t+20.7. VEHICLE, TRACK+RACE and WORLD+SKY each died at about 98-100K prompt (HTTP 400, prompt + 32,768 > 131,072). Then the root died the same way at 101.5K. |
| 2 | 01:53:43-02:01:19 | 2219a64 (max_tokens clamp) | The root re-read files for 15 turns, and the clamp refused the call at an estimated 130,309 tokens. |
| 3 | 02:21:18-03:35:29 | 4d8269d (batch compaction at 80K) | Compaction ran on every turn, because keeping 10 turns or even 4 still landed just under 80K: old compacted turns keep about 0.5-1 KB each. The real prompt was 98,325 against a chars/3 estimate of 88,025, so it overflowed by 21 tokens. |
| 4 | 03:48:05-~04:19 | 0dd3536 (target 40K, drop the oldest turns, tokens/char calibration) | The root repeated one identical turn (same reasoning, same `git diff; git log; ls tests/`) 21 times. The operator stopped it as fully stuck. |
| 5 | 04:22:10-06:15:27 | c270984 (+ repetition note from the 3rd identical turn) | The note fired once and broke the loop. The root then worked alone (AI steering, race flow) and finished. |

All harness commits are local on branches `harness-v2-ctxclamp` and `harness-v2-ctxclamp2`. Compactions over the whole
run: 54. In segment 5 the root went from ~80K down to ~40K about every 10-12 min.

## Output

- **Tokens:** 797,244 output tokens over 859 turns. The root wrote 531.5K; builders wrote TRACK+RACE 72.8K, WORLD+SKY 73.3K, VEHICLE 54.0K and PRESENTATION 65.6K.
- **No builders after t+103:** none ran again, and the root never re-spawned the three that died. Everything after t+103 is the root alone.
- **Code:** 16 files, 4,578 lines.
- **Gates:** playability 65 and world coherence 100.
  - Fails: `no_fatal_errors` (32 console errors), `input_response` (player did not move) and `stable_fps` (4.4 fps headless).
- **Strata at the end:** 44 tok/s answering, 86% expert-cache hits.

## Product

| checkpoint | when | loads | drivable in a fresh page | what it shows |
|---|---|---|---|---|
| mvp (7f8ebca) | t+15:30 | yes | **yes** (9.55 m in 5 s) | box cars on a dark track |
| t+43 .. t+102 (60 snapshots) | | no | - | builders mid-rewrite: `buildTrackMeshes` import, syntax errors, duplicate `ferrisFn` |
| t150 (438287f) | t+150 wall | yes | no | Santa Monica scene: palms, buildings, sunset sky, HUD and standings; the countdown never ends |
| update-1 (ca95bdb) | 06:10 (t+366) | yes | no | race.js fixed: countdown reaches GO, chase cam at the start arch |
| final (5547711) | t+370.8 | yes | no | same scene; race clock stays 0:00.0 and W does not move the car (33 s probe) |

**Best before 2.5 h** (`deliverables/run-20261009-000436-best-before-t150.md`): t150 is the most complete, but it
does not drive; the MVP is the only drivable build.

The root's own `play_game` checks drove full autopilot races, but only through its debug hooks (`__dbgWarp`,
`__dbgAuto`). A fresh page with keyboard input never starts the race clock.

## Timelapse

`~/worldbuild-demo/timelapse/20261009-000436-racing-santa-monica-qwen38-flash-next-strata.mp4`
- 1,366 frames every 15 s, at 30 fps → 45.5 s, 32 MB.
- Gaps between segments are not recorded.
- The 8090 dashboard badge reads "run ended with an error" from segment 3 on: a stale runner error, fixed in 207feb5
  but not applied, because the dashboard process was not restarted.
- The page render was capped at 2 fps until 03:06, then 0.5 fps, because at 2 fps the rich scene cost 2.3 cores.

## Lessons for the harness

1. Builders and the root need context management. Without it, every agent hit the 131K window at about 100 min.
2. Compaction needs hysteresis (compact well below the trigger) and a way to drop old turns; eliding fields alone is
   not bounded.
3. The tokens/char estimate must be calibrated: this JS/bash content runs ~2.65 chars/token.
4. A model can lock into replaying one turn. A plain note in the tool results broke it at once.
5. The root does not re-spawn builders that died. After t+103 one agent did the work of five.
