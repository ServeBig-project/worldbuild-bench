# FreeToken Santa Monica round, 2026-10-09: three attempts, none finished

Goal: run the same Santa Monica brief on FreeToken, after Strata run 20261009-000436, with the final harness (c270984:
calibrated max_tokens clamp, compaction 80K to 40K with dropping of the oldest turns, repetition note) and a timelapse.
Wesley stopped the FreeToken round at 12:20 ("那算了"): the CPU cores could not be kept free.

| run | engine config | cores | what happened |
|---|---|---|---|
| 20261009-070716 | standard image, `--moe-cache-auto --kv-reserve-tokens 229376` (1,238 expert slots, KV 229K), offload, batch 4 | 8-15,24-31 | Too slow: 4 running gave 17.1 tok/s aggregate vs 23.8 for 1 running, because the small expert cache thrashed. Admission still capped at 3 running (each request reserves prompt + 32,768). First builder file at t+136. Aborted at t+152 (t150 tag cb884b6: root shell, boot error from cars.js). |
| 20261009-102537 | `--moe-strategy hybrid --moe-cache-size 2133 --moe-cpu-threads 8`, PLE disk, KV 126K, no `ft bench bw` profile (PCIe fetch cap 1) | 8-15,24-31 | At 11:06 nengneng started a freetoken-dev process pinned to the same cores (~7.7 cores). Single-stream decode fell to ~3 tok/s for 10 min. Aborted at t+55. |
| 20261009-112128 | same hybrid, container moved live to 0-7,16-23 | 0-7,16-23 | Idle cores gave 29-37 tok/s. Shell and stubs at t+19 (vs t+41 before), builders spawned at t+30 (2 running, 33.7 tok/s aggregate). At 12:03 nengneng's next job landed on 0-7,16-23; decode fell to 5-6 tok/s. Paused at t+43. |

After the pause the container was moved back to 8-15,24-31, and nengneng's next job (12:15) landed there as well
(smoke: 10-16 tok/s). The run was not restarted.

## Measurements worth keeping
- Expert-bank load today was 35-38 MB/s, giving 39-45 min startups, against 540-620 MB/s on 10/08.
  - Not the page cache: evicting 151 GB of our own cached GGUFs changed nothing.
  - `--expert-load serial` was slower still.
- Sizes:
  - KV is 25,383 B/token.
  - An expert slot is 2,764,800 B (about 109 KV tokens).
  - `--moe-cache-auto` keeps at least 1,024 slots for prefill overlap.
- Hybrid single-stream decode was 27-37 tok/s on idle cores, and drops 5-10x when another process shares the cores.
  Hybrid computes expert misses on the container's CPUs.
- The `gen throughput` field in FreeToken's decode log should be read as a median over recent lines. Intervals that
  include prefill pull the mean down.

## Lessons
- Do not trade expert slots for KV under batching on this model. The c2133 split with batch 4 measured 30.5 tok/s
  aggregate in run 4; 1,238 slots measured 17.1.
- On a shared host, agree a fixed CPU split before a long run. Hybrid is especially sensitive.
- An aborted run's timelapse keeps recording when a new run starts, because `runAlive` matches any racing run.
  Kill it explicitly.
