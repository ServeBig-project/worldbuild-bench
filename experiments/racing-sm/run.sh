#!/bin/bash
# Racing round, 1 root + 4 builders, harness-v2, no wall-clock cap (natural completion).
# WB_TASK picks the brief and its prompts:
#   racing (default): the upstream racing task (tasks/racing/TASK.md, unchanged since the fork point 3489a09)
#     with the racing-4w prompts written for it;
#   racing-santa-monica: the Santa Monica brief with the racing-sm prompts.
# WB_MODEL picks the engine: qwen38-flash-next-strata (Strata, :8080) or qwen38-flash-next-local
# (FreeToken, :1919). Everything else is identical between the two.
cd "$(dirname "$0")/../.."
WB_TASK="${WB_TASK:-racing}"
case "$WB_TASK" in
  racing) prompts=experiments/racing-4w/prompts ;;
  racing-santa-monica) prompts=experiments/racing-sm/prompts ;;
  *) echo "unknown WB_TASK=$WB_TASK (racing | racing-santa-monica)" >&2; exit 2 ;;
esac
export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 22 >/dev/null
export WB_PROMPTS_DIR="$PWD/$prompts" WB_MAX_SPAWN_DEPTH=1
export WORLDBUILD_FREETOKEN_BASE_URL=http://127.0.0.1:1919/v1 WORLDBUILD_STRATA_BASE_URL=http://127.0.0.1:8080/v1
# slow local decoding: lift Node's 300 s fetch default (preload); a single call may take up to 150 min
export NODE_OPTIONS="--import $PWD/experiments/racing-4w/no-fetch-timeout.mjs" WB_PROVIDER_TIMEOUT_MINS=150
exec npx tsx src/cli.ts run --task "$WB_TASK" --model "${WB_MODEL:?set WB_MODEL}" --effort medium \
  --max-turns 2000 --budget-mins 100000 --budget-usd 1000
