#!/bin/bash
set -eo pipefail
. /opt/nvm/nvm.sh
cd /opt/worldbuild/benchmark
exec taskset -c 72-73,200-201 node experiments/racing-4w/dashboard.mjs \
  --runs /opt/worldbuild/config/manifest.json --port 8090
