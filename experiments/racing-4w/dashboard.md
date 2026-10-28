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

The optional manifest `realtime` map selects an engine's existing statistics API:
`"BR NVFP4": {"format":"br", "url":"http://127.0.0.1:1920/v1/stats"}`
or `"Strata IQ2_XS": {"format":"strata", "url":"http://127.0.0.1:18080/metrics"}`.
State adds `realtime: {outputTps, windowSeconds}`. This is the engine-wide live
output rate including in-progress replies, separate from completed-response
whole-round averages. BR reports a five-second window; Strata's hardware sampler
reports its two-second total across requests. These are engine-native windows,
not identical measurement windows. Unconfigured/unreachable sources, non-OK
responses or missing rates return `realtime: null`; the UI shows unavailable,
never an invented zero or a stale prior rate. The read-only request times out
after 1.5 seconds and does not send generation requests or restart engines.

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
- `live` has `running`, `queue`. `aggregate` adds their totals, `activeRequests`
  (running + queue), `inputTokens`, `outputTokens`, `elapsedMs`, `completed`.
  Chart samples have `t`, `running`, `queue`, retained while that engine is
  polled (at most one per 5 seconds).
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
- Token totals use response usage, superseded by cumulative `generation_end`
  usage and then final result usage. Generation-ended runs ignore leftover live
  requests, including while browser scoring is still running.

## Whole-round throughput

Both input and output rates use **one shared wall interval for the selected
engine**: earliest generation start to latest generation end, or the current time
for tasks still generating. Queueing, tools and pauses between resume segments are
included; browser scoring is excluded. Waiting tasks contribute no time or tokens
until they start. If a task has finished and the other is still waiting, the known
interval freezes until work resumes, while the rate remains provisional.

Aggregate rates are total reported input/output tokens divided by this interval in
seconds. Each task uses the same denominator, so its displayed contribution adds
to the engine total. Input includes cache hits; it is not an engine-only prefill
rate. In-flight text does not count until response usage arrives.

Public fields on each run and aggregate:

- `cachedInputTokens`: reported cache-hit subtotal (number). Missing reports
  contribute zero; zero does **not** establish that physical cache hits were zero.
  Enable BigRabbit `--enable-cache-report` in the future deployment to obtain useful
  reported hit counts. The dashboard does not change server configuration.
- `inputTps`, `outputTps`: rates, or null when no usable interval is known.
- `throughputElapsedMs`: shared interval, or null when unavailable. This differs
  from the existing rounded/cumulative `elapsedMs` which excludes resume downtime.
- `throughputProvisional`: true while any task is waiting/generating or failed, or
  transcript errors/budget exhaustion indicate that usage may be incomplete.
  Failed runs can freeze the known interval while retaining this qualification.
- `throughputTimeSource`: `recorded`, `legacy-rounded` or `unavailable`.
- `throughputUnavailableReason`: explanatory string when unavailable or when the
  interval is zero; otherwise null.
- Runs additionally expose `generationStartedAt`, `generationFinishedAt`: nullable
  Unix milliseconds describing their own endpoints. Rates still share the round
  interval. Once all tasks finish generation, successful round rates freeze before
  scoring completes.

New runs emit `start` with `createdAt` and `resume` also includes original
`createdAt`. A runner `generation_end` event records its exact ISO `ts`, original
`createdAt`, `resumeCount`, cumulative `inputTokens`, `outputTokens`,
`cachedInputTokens`, and `usagePartial` before scoring. The final result persists
`generation_finished_at` alongside `created_at`. Resume clears the previous
generation end; later cumulative usage and end timestamps supersede that segment.

An unresumed historical result lacking an exact end may use `created_at +
wall_clock_s`, explicitly labeled `legacy-rounded`. Resumed history lacking a
recorded actual end cannot reconstruct calendar duration from cumulative seconds:
its rates are null with a reason. Current runner error timestamps can establish a
known failed endpoint. Copying archives or re-gating cannot change these intervals.

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

## Median live decode throughput

The MEDIAN card is the median of each engine's observed live total output rate,
not a median across requests or an isolated kernel timing. The server samples
all engines every5seconds, independent of tabs, browser presence or API polling.
Only finite positive rates during an active generation round count; zero-rate
windows, missing telemetry and failures are excluded. Source windows remain
BR5seconds and Strata2seconds. Concurrent prefill can still affect these rates.

`/api/state.decodeMedian` provides `outputTps` (null before any samples), `samples`,
`firstSampleAt`, `lastSampleAt` (epoch milliseconds or null),
`samplingIntervalSeconds:5` and `sourceWindowSeconds:5|2|null`. Even sample counts
use the mean of the two middle values. The UI shows sample count and start time.
Existing history is not reconstructed: collection begins when this version starts.

Samples persist in `<absolute manifest path>.decode-median.json`; without a
manifest, the file is `runs/dashboard.decode-median.json` under the repository.
Restarting the dashboard preserves the same round's samples. A fresh round with
new task start times resets that engine's history; restart the dashboard when
replacing run directories, as for the existing transcript reader. Sampling stops
when all of an engine's generation tasks end, retaining its observed median.

## Frozen rounds

A manifest may map engine labels to immutable API snapshots through `frozen`.
Snapshot paths resolve beside the manifest. Frozen responses retain recorded
counts, timings and `decodeMedian`, expose `frozenAt` in epoch milliseconds, and
set `realtime` to null. The current engine selector remains available. Frozen
engines are never sampled; their run entries point at archived workspace folders
for previews. Missing snapshots return503 rather than invented results.
The UI labels a user-stopped round as frozen partial results, not a final score.
