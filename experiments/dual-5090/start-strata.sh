#!/bin/bash
set -euo pipefail
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
export STRATA_ENGINE=/opt/worldbuild/strata-engine/strata
export LD_LIBRARY_PATH=/opt/worldbuild/strata-engine${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
exec taskset -c 32-61,160-189 /opt/worldbuild/strata/bin/strata serve \
  --profile /opt/worldbuild/config/strata.json --max-queue 32 --queue-timeout 600 --offline
