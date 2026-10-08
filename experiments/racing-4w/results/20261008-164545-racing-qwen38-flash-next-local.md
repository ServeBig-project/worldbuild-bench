# Run 20261008-164545: stopped by hand at 91 min (harness too crude for slow local decoding)

The third attempt. It used the original harness plus two fixes: the client timeout fix (2b7ed75) and an output cap of
32768 (5597bc4). Setup: racing task, 4 builders, local FreeToken on one RTX 4090, 150-min budget, reasoning effort
medium. Wesley stopped it at 18:16:35, judging it failed, and asked for a harness upgrade before the next run.
No result.json exists.

| agent | output tokens | code that landed |
|---|---|---|
| root | 25.8K | PRD, contracts, the shell (index.html, main.js) and 6 stubs |
| builder 1 (track) | 35.9K | none: `track.js` stayed a stub |
| builder 2 (player + camera) | 18.3K | `camera.js` (2.3K); `player.js` without `createPlayer` (see below) |
| builder 3 (AI) | 21.4K | `ai.js` (17.3K), complete: built in two parts with `append: true` |
| builder 4 (race + HUD) | 22.5K | `race.js` (7.2K); `hud.js` stayed a stub |

What went wrong:
- **Long thinking, small actions.** Single turns of 8-22K tokens, all thinking, often ended in a single read,
  `update_tasks` or `ls`. The thinking was carried into later prompts, which the model's template preserves by
  default; builder 1's prompt grew from 12.7K to 49.9K tokens in two turns.
- **Only 2 of 4 builders ran at once.** FreeToken showed 2 running and 2 queued while KV use was ~20-50%. The
  inferred cause: the engine reserves room for each request's 32768-token output cap when it admits it. Total decode
  stayed ~25 tok/s, about the same as at 4-way.
- **Lost work.** Builder 2 wrote `player.js` in two parts but sent the second part without `append: true`, which
  replaced the first part, `createPlayer` included. The preview was black from 17:28 on: the module import failed.
- **Validation that cannot fail.** `node --check` on these `.js` ES modules exits 0 even on syntax errors (Node 22),
  so the builders' self-checks could not catch anything. Builders were barred from playtests, so a missing export
  surfaced only at root integration.

Fixed in harness-v2 (798f10e, 12ee25b):
- streamed calls, with live queued / thinking / writing state on the dashboard;
- a note when a reply is discarded;
- `write_file` refuses to overwrite the agent's own file without `overwrite: true`;
- a `check_modules` tool (ES-module syntax plus cross-module imports/exports) that builders run after each change.

Logs: `runs/20261008-164545-racing-qwen38-flash-next-local/{console.log,freetoken.log,transcript.jsonl}`.
