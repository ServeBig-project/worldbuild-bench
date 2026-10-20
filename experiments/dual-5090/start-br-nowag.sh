#!/usr/bin/env bash
set -euo pipefail
export CUDA_HOME=/usr/local/cuda-13.0
export CUDA_VISIBLE_DEVICES=1
export PATH="/opt/worldbuild/venvs/br/bin:$CUDA_HOME/bin:$PATH"
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 MAX_JOBS=16
export TORCH_CUDA_ARCH_LIST=12.0
cd /opt/worldbuild/bigrabbit-8eb07829
exec taskset -c 32-61,160-189 /opt/worldbuild/venvs/br/bin/ft serve \
  --host 127.0.0.1 --port 1919 --gpu 1 \
  --model /opt/worldbuild/models/base \
  --nowag-expert-path /opt/worldbuild/models/paper2 \
  --served-model-name flash-next-paper2 \
  --max-seq-len-override 262144 --max-running-requests 12 \
  --moe-cpu-threads 30 --moe-backend auto --moe-cache-auto \
  --dense-quant fp8 --embedding-placement host \
  --kv-dtype int8 --kv-placement tiered \
  --runtime-cache-gib 4 --prefix-cache-host-gib 30 \
  --enable-cache-report
