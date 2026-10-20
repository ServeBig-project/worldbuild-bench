# Two users, progressive game builds

Run `arena-combat` and `racing` concurrently against one configured model endpoint.
Each task has its own root and defaults to six parallel builders: up to twelve
builder requests across the two games. Roots first produce usable coarse games,
then builders refine exclusive modules. Six is a practical starting configuration,
not a benchmark recommendation or measured optimum. More agents can increase
queueing and integration costs; no speedup or hardware saturation is promised.

## Setup and runs

Use Node 20+ from PATH; there is no NVM dependency. From the repository root:

```bash
npm ci
npm run fetch-three
npx playwright install chromium
npx tsx src/cli.ts models
```

Configure the serving endpoint and select its existing registry id. Paper2 refers
to your chosen NoWAG weights; this profile does not download weights, invent model
paths, change caches or start either inference server. The existing
`qwen38-flash-next-local` registry entry serves `nvfp4`, not Paper2: do not relabel
it as Paper2. Configure a dedicated Paper2 registry id and verify the endpoint
`/v1/models` identity and the recorded served model ids once the instance starts.
Weight paths and deployment remain to be selected there. Start/configure each
engine separately. Set `NOWAG_MODEL_ID` and `STRATA_MODEL_ID` to the registry entries that
actually point at those endpoints, then run each round **sequentially**:

```bash
bash experiments/multi-task/run.sh --model "$NOWAG_MODEL_ID" \
  --engine 'NoWAG Paper2' --out runs/demo-nowag --builders 6 --budget-mins 150

# After the first round ends, switch the server to Strata with its chosen settings.
bash experiments/multi-task/run.sh --model "$STRATA_MODEL_ID" \
  --engine Strata --out runs/demo-strata --builders 6 --budget-mins 150
```

Both tasks within a round start concurrently with identical profile, builder count,
effort and time backstop. Use the same options for the second engine. `--builders`
accepts a positive integer; `--effort` accepts low/medium/high/xhigh (default medium).
Each engine must support its selected effort through its registry configuration.
Record actual weight quantization, cache/CPU/GPU/MTP settings alongside results;
the runner cannot infer fairness from a label. Keep other workload settings equal.

The root makes its short plan and functioning imports before delegation. It checks
rendering with `test_game` and interaction with `play_game`; a black shell does not
qualify. Builders preserve frozen exports, improve already functional code, and
never own overlapping files. The default six responsibilities are geometry,
scenery, player/camera, opponents, game progression, and HUD. Smaller counts merge
responsibilities; larger counts split meaningful owned files. The complete original
TASK remains in force. These are model instructions, not an enforcement guarantee;
real engine runs must establish compliance and game quality.

## Outputs and process contract

`--out` must be a fresh directory. Before launching, the runner writes:

- `manifest.json`: two dashboard entries, hardware label RTX 5090.
- `prompts/`: the exact shared profile with requested builder count substituted.
- `arena-combat.log`, `racing.log`: separate harness process output.
- `outcomes.json`: per-task `running` then `finished`/`failed`, with terminal
  `exitCode`, `signal`, `error` and result path.
- `arena-combat/`, `racing/`: isolated fresh harness output directories, each with
  its own workspace, transcript, live progress and final result.

The runner invokes PATH-resolved `npx --no-install tsx src/cli.ts run --task TASK
--model ID --run-dir DIR --effort TIER --budget-mins N`. The generic `wb run
--run-dir DIR` option creates that exact directory and rejects existing directories;
without it the normal timestamped runs directory behavior is unchanged.

The runner sets `WB_PROMPTS_DIR`, `WB_MAX_SPAWN_DEPTH=1` and a provider timeout equal
to the round's wall backstop, reusing the local-engine fetch timeout preload. It
preserves other provider environment settings. SIGINT/SIGTERM are forwarded only
to its own task process groups, including child processes; exits are 130/143.
Otherwise it waits for both tasks and exits 1 if either process fails, its result is
missing, or the result reports agent/budget/gate errors; success exits 0. Low game
scores remain visible in `result.json` and do not by themselves mean process error.

## Dashboard

While the first round is running:

```bash
node experiments/racing-4w/dashboard.mjs --runs runs/demo-nowag/manifest.json --port 8080
```

For engine switching, create a combined manifest with the four absolute run
directories and unique ids, as shown in the [dashboard contract](../racing-4w/dashboard.md).
Each individual runner uses task names as ids; when combining, prefix them by
engine (for example `nowag-arena` and `strata-arena`), rather than concatenating
the two arrays with duplicate ids.
Future directories can be listed before either round starts. The dashboard keeps
an existing rendered game visible while a changed candidate fails or loads. It
shows a preparing message before the first usable rendering, never a fabricated
progress game. Reported output tokens and estimated live throughput remain separate.

Use actual run results to compare both task times, the time until both finish,
output usage, and playability/coherence scores. Generation timing excludes final
browser scoring. The profile and dashboard can be verified locally with independent
fixtures; actual 5090 concurrency/performance and model prompt compliance require
the instance to be running and are not established by those fixtures.
