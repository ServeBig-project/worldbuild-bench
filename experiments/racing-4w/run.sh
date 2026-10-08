#!/bin/bash
# The demo run: racing TASK, 4 parallel builders (root spawns once; builders cannot spawn), local FreeToken.
cd "$(dirname "$0")/../.."
export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 22 >/dev/null
export WB_PROMPTS_DIR="$PWD/experiments/racing-4w/prompts" WB_MAX_SPAWN_DEPTH=1
export WORLDBUILD_FREETOKEN_BASE_URL=http://127.0.0.1:1919/v1
# one 4090 decoding 4 requests gives each ~7 tok/s, so a single call can run far past Node's 300 s fetch default
# and the harness's 10-min per-call cap: lift the first (preload), let the second follow the 150-min run budget
export NODE_OPTIONS="--import $PWD/experiments/racing-4w/no-fetch-timeout.mjs" WB_PROVIDER_TIMEOUT_MINS=150
# 150-min wall-clock budget (decided 2026-10-08): at the cap the harness gives one tools-off wrap-up turn, then scores the gates
exec npx tsx src/cli.ts run --task racing --model qwen38-flash-next-local --effort medium \
  --max-turns 400 --budget-mins 150 --budget-usd 1000
