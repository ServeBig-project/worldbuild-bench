# Parallel game dashboard

Start with `node experiments/racing-4w/dashboard.mjs --runs manifest.json --port 8090`.
The server listens on localhost. Forward that port to view it remotely.

```json
{
  "hardware": "RTX 5090",
  "runs": [
    {"id":"nowag-arena","engine":"NoWAG Paper2","task":"arena-combat","dir":"/runs/nowag/arena-combat"},
    {"id":"nowag-racing","engine":"NoWAG Paper2","task":"racing","dir":"/runs/nowag/racing"},
    {"id":"strata-arena","engine":"Strata","task":"arena-combat","dir":"/runs/strata/arena-combat"},
    {"id":"strata-racing","engine":"Strata","task":"racing","dir":"/runs/strata/racing"}
  ]
}
```

Each id is unique and contains only letters, digits, underscores or hyphens.
Relative directories resolve beside the manifest. Missing/future directories show
waiting. The manifest is read at startup; restart after editing it. Labels do not
configure or measure hardware. No GPU metrics are inferred from request activity.

`--run DIR --engine LABEL --hardware LABEL` still shows one run; omitting DIR or
using `--run latest` chooses the latest transcript-bearing directory under `runs/`,
regardless of task. `/game/index.html` remains available in single-run mode.

## Public HTTP interface

- `GET /api/state?engine=LABEL` selects an engine; omitted selects the first.
  Unknown engines return HTTP 404.
- `GET /game/ID/index.html` and relative resources serve only that run's workspace.
  Unknown ids/files return HTTP 404.
- State includes `now` (Unix milliseconds), `hardware`, `engines` (labels),
  selected `engine`, `runs`, `aggregate`, and `batch.series`.
- Each run includes manifest fields, `status` (`waiting`, `running`, `finished`,
  `failed`), human-readable `phase`, `t0`, `finishedAt` (nullable milliseconds),
  `elapsedMs`, `inputTokens`, `outputTokens`, `root`, all `builders` (any depth),
  recent `feed`, `live`, and `game` (`version`, `recent`, `url`).
- The phase label uses neutral `parallel module work` while builders are active;
  transcript activity alone does not distinguish coarse work from refinement.
- Agents include `agent`, `depth`, `turns`, `inp`, `out`, `status`, `done`, `tool`,
  and in-flight `live` data when available. Feed entries have `ts`, `agent`,
  `kind`, `text`. Recent source entries have `file`, `mtime`.
- `live` has `running`, `queue`, `estimatedTps`. `aggregate` adds their totals,
  `activeRequests` (running + queue), exact `inputTokens`, `outputTokens`,
  `elapsedMs`, `completed`. Chart samples have `t`, `running`, `queue`,
  `estimatedTps`, retained while that engine is polled (at most one per 5 seconds).
- A completed result uses `created_at` as `t0`, with `finishedAt = t0 +
  wall_clock_s * 1000`. Final per-task elapsed is frozen to `wall_clock_s`.
  Aggregate elapsed spans earliest start to latest end once every task is terminal;
  active tasks contribute their current runtime; waiting tasks contribute nothing. This measures
  the harness's generation duration; final browser scoring is excluded by the
  harness. A root final response alone is the scoring phase, not completion.
- `result.json` agent errors, budget exhaustion or gate errors mark failure.
  A runner error without result uses its event time as terminal time; resume clears
  the error. A resume event with newer `resumeCount` than `result.resumed.count`
  invalidates that old result until the resumed segment finishes. Active resumed
  elapsed is `resume.priorWallS` (or prior result wall time) plus the current
  segment. Aggregate elapsed is max(start + runtime) minus earliest start: resumed
  runtime excludes pause downtime, so it is not calendar completion span for
  paused runs. Uninterrupted comparisons use the ordinary elapsed span.
  Completion does not imply the game scored well; inspect its result.
- Token totals use response usage, superseded by final result usage. Streaming
  `estimatedTps` uses characters / 4 / elapsed generation seconds; it is never
  added to exact totals. Terminal runs ignore leftover live requests.

## Preview behavior

The old iframe stays interactive while a candidate loads. A candidate replaces it
only after at least three rendered canvas samples over one second, complete
`window.__bench` methods, readable state and finite player position, without
runtime, rejected-promise or resource errors. Loading HTML alone is insufficient.
Errors or a 20-second timeout preserve the old iframe; Retry preview retries the
current source. Before the first ready game, the panel honestly says preparing.

Readiness verifies observable rendering and telemetry, **not semantic playability**.
Agents still use `test_game` and `play_game` to verify movement, objectives and
restart. Keeping a running old iframe preserves its already-loaded game; a game
that lazily fetches changing resources may still encounter an error. This is a
local demo observer, not a snapshot/versioning system.
