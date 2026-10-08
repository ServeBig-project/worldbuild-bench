#!/bin/bash
# Standard FreeToken image, the same pinned-c2133 flags as the replay runs; GPU 2 only; default max-running-requests (4).
set -e
GPU=GPU-847e9c75-56a9-1090-4f4f-7d70a71792dd
used=$(nvidia-smi -i $GPU --query-gpu=memory.used --format=csv,noheader,nounits)
[ "$used" -lt 1024 ] || { echo "GPU 2 busy (${used} MiB used); not starting"; exit 1; }
docker rm -f wb-freetoken >/dev/null 2>&1 || true
docker run -d --name wb-freetoken --gpus device=$GPU --ulimit memlock=-1 --cpuset-cpus 0-15 --cpuset-mems 0 \
  --shm-size 16g -p 127.0.0.1:1919:1919 \
  -v /data1/yuchen/models/Qwen3.8-Flash-Next-NVFP4:/models/nvfp4:ro -v $HOME/strata-bench/ftcache:/root/.cache \
  freetoken:555efd8 serve --model /models/nvfp4 --host 0.0.0.0 --port 1919 \
  --max-seq-len-override 131072 --kv-reserve-tokens 131072 --text-model-only --ple-backend pinned --moe-cache-size 2133
for i in $(seq 1 90); do
  curl -sf -m 60 http://127.0.0.1:1919/v1/chat/completions -H 'Content-Type: application/json' \
    -d '{"model":"nvfp4","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' >/dev/null && { echo "FreeToken ready after $((i*10))s"; exit 0; }
  [ "$(docker inspect -f '{{.State.Running}}' wb-freetoken)" = true ] || { echo "container exited"; docker logs --tail 20 wb-freetoken; exit 1; }
  sleep 10
done
echo "not ready after 15 min"; exit 1
