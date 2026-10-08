#!/bin/bash
# The demo run: racing TASK, 4 parallel builders (root spawns once; builders cannot spawn), local FreeToken.
cd "$(dirname "$0")/../.."
export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 22 >/dev/null
export WB_PROMPTS_DIR="$PWD/experiments/racing-4w/prompts" WB_MAX_SPAWN_DEPTH=1
export WORLDBUILD_FREETOKEN_BASE_URL=http://127.0.0.1:1919/v1
# wall-clock backstop effectively off (the demo runs to natural completion); the turn cap is the safeguard
exec npx tsx src/cli.ts run --task racing --model qwen38-flash-next-local --effort medium \
  --max-turns 400 --budget-mins 100000 --budget-usd 1000
