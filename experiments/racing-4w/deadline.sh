#!/bin/bash
# Hard wall-clock cutoff for a run that was launched without one (the 2026-10-08 demo run used --budget-mins 100000
# before the 150-min budget was decided). At <run start> + <mins>, if the run is still going, stop its process group
# and score the workspace with the harness's own gates (`wb gate`, the same scoring finalizeRun does).
# Log: <run-dir>/deadline.log.  usage: deadline.sh <run-dir> <pgid> <mins>
cd "$(dirname "$0")/../.."
run_dir=$(realpath "$1"); pgid=$2; mins=$3
id=$(basename "$run_dir")   # 20261008-151439-racing-...: the run's start time
start=$(date -d "${id:0:8} ${id:9:2}:${id:11:2}:${id:13:2}" +%s) || exit 1
deadline=$((start + mins * 60))
log="$run_dir/deadline.log"
say() { echo "$(date +%T) $*" >> "$log"; }

say "armed: pgid $pgid, deadline $(date -d @$deadline +%T) ($mins min after the run start)"
now=$(date +%s)
[ "$deadline" -gt "$now" ] && sleep $((deadline - now))
if ! pgrep -g "$pgid" -f "cli.ts run --task racing" >/dev/null; then
  say "run already ended before the deadline; nothing to do"; exit 0
fi
say "deadline reached: stopping process group $pgid"
kill -TERM -- "-$pgid"; sleep 10; kill -KILL -- "-$pgid" 2>/dev/null
export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 22 >/dev/null
say "scoring the workspace (wb gate)"
npx tsx src/cli.ts gate "$run_dir" >> "$log" 2>&1
say "done"
