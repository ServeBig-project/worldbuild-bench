# Native NVFP4 deployment

Use `start-br-fp4.sh` with the complete native checkpoint at `/opt/worldbuild/models/base`. The served model is `flash-next-nvfp4`; the previous Paper2 launcher remains a separate record. Runtime source remains `e72d8b32`, with the existing CUDA 13 environment and Transformers 5.15.1 constraint.

## Approved allocation

- GPU 0: one RTX 5090; GPU 1 remains assigned to Strata.
- CPU: cores `0-29,128-157` (30 physical cores and their siblings), 30 MoE CPU threads, nested OpenMP/MKL pools limited to one thread.
- Host RAM: 160 GiB planning allowance per engine from 342 GiB total, leaving 22 GiB for shared services and overhead. This is a soft allowance, not a container-enforced process limit.
- GPU runtime cache: 4 GiB; host prefix cache: 36 GiB. Remaining GPU expert cache uses the existing automatic planner and default memory ratio.
- At most 12 running requests, native 262144-token context limit; INT8 tiered KV, FP8 dense weights, host embeddings. These limits do not promise twelve simultaneous maximum-length contexts.

## Capacity basis

Native checkpoint tensor headers account for 63.282 GiB of routed experts and 47.684 GiB of PLE weights. The previous Paper2 process measured about 90 GiB PSS, including 28.916 GiB of routed experts and an 8 GiB host cache. Substituting native experts and a 36 GiB host cache gives an approximate 152.4 GiB process footprint. The largest three expert shards total 0.989 GiB, leaving approximately 6.6 GiB beneath the soft allowance during parallel loading. This is a planning estimate; actual native startup memory must be observed.

The same model reports 115654664 bytes of active state per request: twelve active states plus one prefix checkpoint each total approximately 2.585 GiB. A 4 GiB runtime allocation leaves approximately 1.4 GiB for other cache metadata, hot KV and graph/block overhead; the runtime determines actual admission capacity.

## Kernel selection

`--moe-backend hybrid --nvfp4-backend triton` follows the user's final choice: CPU and GPU both execute routed experts, retaining native ModelOpt expert rows. GPU expert execution uses the compatible Triton implementation; the FlashInfer packed layout is not requested. This is an explicit hybrid configuration, not automatic backend selection.

Autoregressive generation is retained: speculative MTP is not enabled. No parameter sweep or speed-based candidate selection is part of this deployment.

## Startup validation

The installed native extensions and CUDA 13 environment remain unchanged. The checkpoint's 2560 hidden and 640 intermediate dimensions satisfy the native packing alignment. Public service checks confirmed native NVFP4, hybrid, INT8 tiered KV, 7316 GPU expert slots (18.89 GiB), 36 GiB allocated host cache and 3.83 GiB usable runtime. The first native instance measured 146.74 GiB process-tree PSS. Independently authored normal/tool and two concurrent 16407-token input probes passed.

The original run used fixed fetch cap 1 because its NVFP4 bandwidth profile was absent. The user then authorized stopping that run and running the standard `ft bench bw --gpu 0 --dtype nvfp4 --cpu-threads 30` on the assigned CPU cores. Concurrent CPU expert bandwidth was 62.3 GB/s and PCIe bandwidth was 21.6 GB/s. The restarted service reports `moe_hybrid_fetch_fraction=0.2578953641`, confirming profile consumption. These bandwidth measurements are not end-to-end model speedups. The original results remain under `runs/fp4/`; the independent new round uses `runs/fp4-initialized/`. The automatic-initialization gap remains tracked in [BR issue #56](https://github.com/ServeBig-project/Big-Rabbit/issues/56).
