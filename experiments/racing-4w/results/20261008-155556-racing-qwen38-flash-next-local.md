# Run 20261008-155556: stopped by hand at 46 min (output cap too small for the model's thinking)

The second attempt, after the client-timeout fix (2b7ed75). The setup was otherwise the same: racing task, 4 parallel
builders, local FreeToken on one RTX 4090, and a 150-min budget. Wesley stopped it at 16:41:50, before any builder had
written code. No result.json exists, because the harness never got to score.

| time | event |
|---|---|
| 15:55:56 | run start; the root plans alone (~27 tok/s) |
| 16:05:25 | the root's stubs are written |
| 16:11:4x | the root spawns 4 builders (root total 22.7K output tokens) |
| ~16:13 | each builder starts writing its module in one long call |
| 16:31:22-16:31:52 | all 4 calls stop at the 8192-token output cap. Every token was thinking: no text, no tool call |
| 16:31-16:41 | the harness retries each empty reply unchanged ("1/4"); it gives up an agent after 4 in a row |
| 16:41:50 | stopped by hand |

**What worked.** Calls ran past 300 s and 10 min without transport errors, so the timeout fix holds.

**Cause.** `models.json` capped this model at `max_output_tokens: 8192`, a value carried over from the SWE-bench
recording. The harness's own convention is 32768, or the model's limit if lower, and 16384 when the row omits it.
With thinking on, writing a whole module needed more than 8192 tokens.

A reply cut off with neither text nor a tool call counts as empty. The harness re-sends the same request without
adding anything to the history, so the model never sees a hint to write in pieces, and every retry costs another
full turn. At 4-way decoding (~7.6 tok/s per request), each lost turn cost about 18 min.

**Throughput.** Decode ran at 27.0 tok/s with 1 request in flight and 30.5 tok/s in total with 4 in flight
(7.6 tok/s each). Batching gains little under expert offload.

**Next.** Raise the output cap to 32768 (the benchmark's ceiling) and rerun from scratch with a fresh 150-min
budget (Wesley).

Logs: `runs/20261008-155556-racing-qwen38-flash-next-local/{console.log,freetoken.log,transcript.jsonl}`.
