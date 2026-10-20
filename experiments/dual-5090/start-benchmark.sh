#!/bin/bash
set -eo pipefail
. /opt/nvm/nvm.sh
case "$1" in
  paper2) model=flash-next-paper2; label="BR Paper2"; cpus=64-67,192-195 ;;
  fp4|fp4-initialized) model=flash-next-nvfp4; label="BR NVFP4"; cpus=64-67,192-195 ;;
  fp4-flashinfer) model=flash-next-nvfp4; label="BR NVFP4 FlashInfer"; cpus=64-67,192-195 ;;
  nowag-8eb07829) model=flash-next-paper2; label="BR NoWAG 8eb07829"; cpus=68-71,196-199 ;;
  strata) model=flash-next-strata-iq2; label="Strata IQ2_XS"; cpus=68-71,196-199 ;;
  *) echo "usage: $0 paper2|fp4|fp4-initialized|fp4-flashinfer|nowag-8eb07829|strata" >&2; exit 2 ;;
esac
export WORLDBUILD_LOCAL_API_KEY=local CUDA_VISIBLE_DEVICES="" LIBGL_ALWAYS_SOFTWARE=1
cd /opt/worldbuild/benchmark
exec taskset -c "$cpus" bash experiments/multi-task/run.sh \
  --model "$model" --engine "$label" --out "/opt/worldbuild/runs/$1" \
  --builders 6 --effort medium --budget-mins 150
