# Run 20261008-151439: failed after 28 min (client timeout)

Racing task with 4 parallel builders on local FreeToken (`freetoken:555efd8`, Qwen3.8-Flash-Next NVFP4, one RTX 4090).
The run ended at 15:42:49 with a runner error, before any builder had written code. 29 turns in total: the root
produced 22.2K output tokens; each builder produced 0.2-0.4K before it failed.

The gates still scored the root's stub shell (a red box on a flat plane) at 100/100 Playability and 100/100 World
Coherence. Gate scores alone cannot accept a run.

| time | event |
|---|---|
| 15:14:39 | run start; the root plans alone (single stream, ~20 tok/s) |
| 15:24:31 | the stub shell passes test_game (PRD, contracts.md, index.html, main.js, 6 stubs) |
| 15:31:05 | the root spawns 4 builders (turn 13: 6.2K output tokens in 4 min 39 s) |
| 15:32:01-15:32:48 | each builder sends its first long call (thinking plus a whole file) |
| 15:37:02-15:37:48 | all 4 calls fail with `fetch failed`, each 300 s after it was sent |
| 15:42:49 | the root's next call fails the same way; it was queued behind the 4 abandoned requests. The run ends |

**Cause.** The harness's providers make non-streaming calls, so no response headers arrive until the whole generation
is done. Node's built-in fetch (undici) aborts a request after 300 s without headers. FreeToken decoding 4 requests
gives each one ~7 tok/s (about 30 tok/s in total), so 300 s covers only ~2.2K tokens. The harness does not retry
transport failures. FreeToken did not notice the disconnects and kept generating the 4 abandoned requests, which
held all 4 running slots.

**Fix** (2b7ed75):
- run.sh preloads `no-fetch-timeout.mjs`, which turns off undici's headers and body timeouts.
- run.sh sets `WB_PROVIDER_TIMEOUT_MINS=150`, so a single call is bounded only by the 150-min run budget.
- FreeToken was restarted to drop the abandoned requests.

Logs: `runs/20261008-151439-racing-qwen38-flash-next-local/{console.log,freetoken.log,transcript.jsonl,result.json}`.
