# BR and Strata on two RTX 5090s

This deployment uses separate processes, environments, GPU assignments, CPU
affinities, ports and output directories inside the existing container. Memory
bandwidth, PCIe, disk and the container's total CPU/RAM limits remain shared;
this is not two separately limited containers.

## Frozen software and model inputs

- Benchmark: `54d2a4f`, including two parallel builder phases and shared-wall rates.
- BR: `ServeBig-project/Big-Rabbit@36908c15`, installed separately under
  `/opt/worldbuild/venvs/br` with CUDA 13.0 and Torch 2.11.0+cu130.
  Apply [br-constraints.txt](br-constraints.txt) when installing BR dependencies:
  Transformers 5.15.1 and tokenizers 0.22.2 preserve its existing raw-config path.
  Transformers 5.20.2 rewrites full-attention layers to `indexed_attention`, which
  this pinned BR parser does not recognize.
- Strata: official `v0.2.1`, control `0.1.46.1`, CUDA 13 engine `0.1.46`;
  its bundled Python/libraries are independent of BR.
- BR weights: existing Paper2 expert sidecar plus RadixArk Flash-Next base
  revision `7b719225242aacd3dbd3f9407468c2ee9a9d2594`.
  Only non-target-expert base shards are required alongside the sidecar.
  This base directory is not a standalone NVFP4 deployment.
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
| BR benchmark | software rendering | `64-67,192-195` | `runs/paper2/` |
| Strata benchmark | software rendering | `68-71,196-199` | `runs/strata/` |
| Dashboard | none | `72-73,200-201` | localhost:8090 |

The user requested documented performance settings, not a tuning sweep:

- BR: FP8 dense, INT8 KV, host embeddings, automatic MoE/cache/attention/batching,
  2 GiB shared runtime, tiered KV with 8 GiB host cache, AR without MTP,
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

## Operate

Place the JSON files under `/opt/worldbuild/config/`, shell launchers directly
under `/opt/worldbuild/`, and register `supervisor.conf`. Merge the two entries
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
passes, start that engine's benchmark without waiting for the other engine:

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
