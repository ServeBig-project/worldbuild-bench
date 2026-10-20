# WorldBuild on the dual RTX 5090 instance

## Current run

The user requested NoWAG Paper2 on GPU1 at the exact BR commit
`8eb078290cc306636af2b0f06926b3b80137fbc2` ([PR #57](https://github.com/ServeBig-project/Big-Rabbit/pull/57)).
Its production code matches `ba9ed8e6`; the comparison baseline was `e72d8b32`.
The source is installed from that commit under `/opt/worldbuild/bigrabbit-8eb07829`.
The launcher is `start-br-nowag.sh`; results use `runs/nowag-8eb07829/`.

- GPU1; CPU affinity `32-61,160-189`, 30 physical cores and their SMT siblings.
- Retain one half of the machine's CPU/RAM allocation. The 160 GiB host allowance
  is a planning budget, not a cgroup-enforced limit.
- 30 GiB host prefix cache, model weights additional; 4 GiB shared GPU runtime,
  automatic expert cache, INT8 tiered KV, FP8 dense, host embeddings.
- `--moe-backend auto` selects from measured CPU/PCIe bandwidth. GPU1 already has
  a NoWAG profile measured with this same CPU affinity; a valid profile is reused.
  Missing usable profiles are measured automatically by PR #43.
- AR, native 262144 context, at most 12 admitted requests. Two simultaneous tasks:
  arena-combat and racing, each with six builders per phase, medium reasoning,
  32768 output-token cap per response and a 150-minute task backstop.
- BR harness affinity `68-71,196-199`; dashboard `72-73,200-201`.

Both cards are attached to NUMA node 0. CPU numbering is specific to this host.
The container has a 342 GiB RAM limit and 122.88 logical CPU equivalents.
Processes, environments, GPUs, CPU affinities, ports and result directories are
separate; memory bandwidth, PCIe, disk and container resource limits remain shared.

## Frozen dependencies

- Benchmark `54d2a4f`, with parallel builder phases, early integration and shared-wall
  input/output throughput; cached input is reported separately.
- BR venv `/opt/worldbuild/venvs/br`, CUDA 13.0, Torch 2.11.0+cu130,
  Transformers 5.15.1 and tokenizers 0.22.2; see [br-constraints.txt](br-constraints.txt).
  CUDA development headers include `libcurand-dev-13-0` for sampling compilation.
- Paper2 experts at `/opt/worldbuild/models/paper2`; base checkpoint at
  `/opt/worldbuild/models/base`, RadixArk revision `7b719225242aacd3dbd3f9407468c2ee9a9d2594`.
- Strata official v0.2.1, control 0.1.46.1, engine 0.1.46; IQ2_XS with INT8 KV,
  automatic expert cache/prefill, four slots, `spec=4`, batch-MTP and 32K resident KV.
  Both Strata tasks finished with exit code 0; its inference service remains stopped.

## Preserved runs

| Directory | State |
|---|---|
| `runs/paper2/` | Original BR baseline, stopped at the user's request |
| `runs/fp4/` | First native FP4 hybrid run, stopped before bandwidth initialization |
| `runs/fp4-initialized/` | Initialized native FP4 hybrid run, stopped for FlashInfer trial |
| `runs/fp4-flashinfer/deployment/` | FlashInfer startup failure logs/configuration; no benchmark result |
| `runs/strata/` | Both completed tasks and previews |

The initialized hybrid run passed independent short/tool and concurrent 16407-token
input probes. Its GPU fetch fraction was 0.2578953641. Explicit hybrid intentionally
does not measure at startup under PR #43; issue #56 was withdrawn after correcting
that deployment misunderstanding.

FlashInfer compilation succeeded after exposing installed CUDA wheel headers through
`CPATH`, and b12x weight conversion succeeded. Warmup failed with an fc2 tile mismatch
for N/K=2560/640, matching [upstream #335](https://github.com/FlashML-org/FreeToken/issues/335).
No third-party kernel patch or FlashInfer throughput claim was made.

## Operate

Place launchers under `/opt/worldbuild/`, configuration under `/opt/worldbuild/config/`,
and register `supervisor.conf`. Merge `model-entries.json` into the benchmark registry.
Only the dashboard starts automatically. Start BR, verify the served model, GPU1,
INT8 KV, backend/fetch fraction and NoWAG kernel preparation, then run the existing
independently authored probes:

```bash
supervisorctl start worldbuild-br
python3 /opt/worldbuild/deployment_probe.py --engine br --br-model flash-next-paper2
python3 /opt/worldbuild/deployment_probe.py --engine br --br-model flash-next-paper2 --long-prompts
supervisorctl start worldbuild-bench-br
```

Use fresh output directories for each configuration; preserve previous rounds.
Logs are under `/opt/worldbuild/logs/`. Dashboard port 8090 is available through
`ssh -p 39548 root@192.243.116.145 -L 8080:localhost:8090`.
