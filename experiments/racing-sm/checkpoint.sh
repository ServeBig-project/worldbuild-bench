#!/bin/bash
# Save a playable checkpoint of a racing run: a runnable folder and tarball under ~/worldbuild-demo/deliverables,
# a tag on that run's latest game snapshot, and a headless check (page errors, 5 s of throttle) with a screenshot.
# usage: checkpoint.sh <run-dir> <label>     (local only: nothing is pushed)
set -e
cd "$(dirname "$0")/../.."
run=$(realpath "$1"); label=$2; id=$(basename "$run" | cut -c1-15)
name="run-$id-$label"; demo=$HOME/worldbuild-demo; d=$demo/deliverables/$name
mkdir -p "$d"
rsync -a --exclude skills --exclude TASK.md --exclude '.*' --exclude node_modules "$run/workspace/" "$d/"
cp experiments/racing-sm/THREE_LICENSE "$d/lib/three/LICENSE"
cp experiments/racing-sm/NOTICE.md "$d/NOTICE.md"
(cd "$demo/deliverables" && tar czf "$name.tar.gz" "$name")
commit=$(git -C "$demo" log --format=%h -1 --grep "$(basename "$run")")
[ -n "$commit" ] && git -C "$demo" tag -f "$name" "$commit" >/dev/null
port=$((8100 + RANDOM % 800))
python3 -m http.server $port --bind 127.0.0.1 --directory "$d" >/dev/null 2>&1 & srv=$!
sleep 1
export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 22 >/dev/null
node experiments/racing-sm/probe.mjs "http://127.0.0.1:$port/index.html" "$demo/deliverables/$name.png" \
  | tee "$demo/deliverables/$name.probe.json"
kill $srv
echo "checkpoint $name: $d ($(du -sh "$demo/deliverables/$name.tar.gz" | cut -f1) tarball), tag ${commit:-none}"
