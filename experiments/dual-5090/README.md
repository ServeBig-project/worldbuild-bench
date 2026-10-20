# BR and Strata on two RTX 5090s

This deployment uses separate processes, environments, GPU assignments, CPU
affinities, ports and output directories inside the existing container. Memory
bandwidth, PCIe, disk and the container's total CPU/RAM limits remain shared;
this is not two separately limited containers.

## Frozen software and model inputs

- Benchmark: `54d2a4f`, including two parallel builder phases and shared-wall rates.
- BR: `ServeBig-project/Big-Rabbit@e72d8b32`, based on `36908c15` with fixes in
  [PR #49](https://github.com/ServeBig-project/Big-Rabbit/pull/49) and
  [PR #50](https://github.com/ServeBig-project/Big-Rabbit/pull/50), installed under
  `/opt/worldbuild/venvs/br` with CUDA 13.0 and Torch 2.11.0+cu130.
  Apply [br-constraints.txt](br-constraints.txt) when installing BR dependencies:
  Transformers 5.15.1 and tokenizers 0.22.2 preserve its existing raw-config path.
  Transformers 5.20.2 rewrites full-attention layers to `indexed_attention`, which
  this pinned BR parser does not recognize.
  The CUDA 13 development installation must include `libcurand-dev-13-0`
  (10.4.0.35-1 here), needed when FlashInfer first compiles its sampling module.
- Strata: official `v0.2.1`, control `0.1.46.1`, CUDA 13 engine `0.1.46`;
  its bundled Python/libraries are independent of BR.
- BR weights: the complete RadixArk Flash-Next NVFP4 checkpoint at revision
  `7b719225242aacd3dbd3f9407468c2ee9a9d2594`, including all 192 expert shards.
  The current launcher is `start-br-fp4.sh`; Paper2's launcher and stopped run
  remain available as historical records.
- Strata weights: existing ISTA-DASLab Flash-Next GSQ-RCO IQ2_XS shards,
  revision `ed59f92082b1e93c0e96d60a8b11aab089b52f09`, with the matching prepared
  native pack/tokenizer and MTP data.

## Resource assignments

These CPU numbers match the inspected dual-socket EPYC topology. Both cards are
attached to NUMA node 0; each engine gets 30 different physical cores and their
SMT siblings. They must be revised for a different host.

| Component | GPU | CPU affinity | API/output |
|---|---|---|---|
| BR | 0 | `0-29,128-157` | localhost:1919 |
| Strata | 1 | `32-61,160-189` | localhost:18080 |
| BR benchmark | software rendering | `64-67,192-195` | `runs/fp4-initialized/` |
| Strata benchmark | software rendering | `68-71,196-199` | `runs/strata/` |
| Dashboard | none | `72-73,200-201` | localhost:8090 |

The user requested documented performance settings, not a tuning sweep:

- BR: native NVFP4 experts, FP8 dense, INT8 KV, host embeddings, explicit hybrid
  CPU/GPU execution with Triton kernels, automatic cache/attention/batching,
  4 GiB shared runtime, tiered KV with 36 GiB host cache, AR without MTP,
  at most 12 admitted requests subject to actual resource availability.
- Strata: INT8 KV, automatic expert cache/prefill/CPU worker selection,
  32K resident KV window, 4 concurrent slots, MTP with `spec=4` and `batch-mtp`.
  Additional builder requests queue normally.
- Both use native 262144 context and the same benchmark medium reasoning,
  32768 per-response output cap, six builders per task per phase and
  150-minute task backstop.

Strata choices follow its [batching](https://github.com/Niko1221/Strata/blob/v0.2.1/docs/BATCHING.md)
and [configuration](https://github.com/Niko1221/Strata/blob/v0.2.1/docs/DETAILS.md)
documentation. No measured optimum is claimed.

The host-memory plan allows 160 GiB per engine and leaves approximately 22 GiB
for shared overhead. These are planning allowances, not enforced container limits.
The native BR capacity calculation is in [br-fp4-resources.md](br-fp4-resources.md).

The Paper2 run was stopped at the user's request; its results and deployment
snapshot remain under `runs/paper2/`. Its NoWAG optimization-coverage issue
[BR #55](https://github.com/ServeBig-project/Big-Rabbit/issues/55) concerns that
archived configuration. Native NVFP4 passed normal streaming, tool calls and two
concurrent requests with 16407 input tokens each; both tasks have started. Strata
finished both tasks successfully and its inference service was stopped at the user's request.

The first native run is preserved under `runs/fp4/`. After the user authorized a
restart, standard initialization with `ft bench bw --gpu 0 --dtype nvfp4 --cpu-threads 30`
measured concurrent CPU expert bandwidth of 62.3 GB/s and PCIe bandwidth of
21.6 GB/s on BR's assigned cores. The restarted service reports a hybrid GPU
fetch fraction of `0.2578953641`; the fresh round writes to `runs/fp4-initialized/`.
This is one standard initialization, not a parameter sweep or a measured model
speedup. The missing automatic initialization for explicit hybrid remains tracked
in [BR #56](https://github.com/ServeBig-project/Big-Rabbit/issues/56).

## Operate

Place the JSON files under `/opt/worldbuild/config/`, shell launchers directly
under `/opt/worldbuild/`, and register `supervisor.conf`. Merge the entries
from `model-entries.json` into the benchmark's registry. Only the dashboard
starts automatically; inference and benchmark groups require an explicit start.

Finish each engine's own weight transfer before starting it. For segmented
downloads, file size alone does not establish completion: the downloader must
have finished that file and removed its active transfer state.

```bash
supervisorctl start worldbuild-br
supervisorctl start worldbuild-strata
```

Each engine can start as soon as its inputs are ready. Check the serving model,
effective INT8 KV, actual GPU process placement and CPU thread affinity. Run
the independently authored deployment probe against the ready engine. After it
passes, start that engine's benchmark without waiting for the other engine.
For BR, run `python3 /opt/worldbuild/deployment_probe.py --engine br --br-model flash-next-nvfp4`,
then the same command with `--long-prompts`. Start the accepted benchmark:

```bash
supervisorctl start worldbuild-bench-br
supervisorctl start worldbuild-bench-strata
```

Results directories must be fresh. Do not overwrite a prior run to retry it;
use the benchmark's resume command when appropriate.
Logs live under `/opt/worldbuild/logs/`. The combined dashboard manifest can
display the first engine while the second is still waiting. Use an SSH forward
such as `-L 8080:localhost:8090`; port 8080 on the inspected instance belongs
to Jupyter.
