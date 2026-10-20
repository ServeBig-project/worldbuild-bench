# Independent multi-task acceptance

These tests were written from the public dashboard/runner contract without reading production sources, existing tests, or implementation diffs.

Run from this checkout after the production checkout has installed Playwright and its Chromium browser:

```bash
WB_TEST_ROOT=/absolute/path/to/production node --test independent_blackbox/multi-task.test.mjs
```

The suite checks four-run selection and isolation, every recorded descendant, authoritative result usage, frozen completion time and resumed execution, missing future runs, the existing single-run URL, and a playable canvas retained across an erroneous edit then replaced by a healthy WebGL game, including HTML without explicit head tags. Runner checks use a temporary `npx` executable through normal `PATH`; they exercise concurrent task startup, output/manifest paths, interruption, child failure, and successful terminal outcomes without model calls.

The CLI check uses a local fake Moonshot HTTP server to verify the actual `--run-dir` option, result identity, and existing-directory rejection without paid model calls. At the fake request it seeds our own animated WebGL fixture into the public workspace so browser scoring runs; this fixture is not model-generated. It checks that generation-end telemetry is readable before the final scoring result and agrees with that result.

Throughput fixtures verify one shared engine wall clock for input (including cached tokens) and output, reported cache subtotals, overlapping tasks, partial live usage without character estimates, freeze before scoring, engine isolation, and recorded versus unavailable legacy resume timing.

The fixtures prove rendering, telemetry and keyboard interaction. They do not establish real LLM coarse-first compliance, gameplay quality, or performance on the target GPU. The runner stub does not simulate model execution.

`python3 independent_blackbox/deployment_probe.py` runs one deployment API smoke pass against BR port 1919 and Strata port 18080 (override with `--br-url` / `--strata-url`). Use `--engine br` or `--engine strata` to accept one ready service independently; the default is `--engine both`. Run only after the selected services and weights are ready. It checks model IDs, two concurrent streamed requests per engine, reported usage, and usable function calls with medium reasoning. Exit 0 means passed, 1 failed, and 2 means a tool response was truncated and remains inconclusive. Printed elapsed time is diagnostic evidence, not a speed comparison; GPU/CPU binding and KV configuration are separate operator checks.

`python3 independent_blackbox/deployment_probe.py --engine br --long-prompts` separately checks two concurrent neutral long prompts with medium reasoning and at most 128 output tokens each. Both streams must finish and report at least 8192 actual input tokens each, with nonnegative usage. No answer-quality score or timing ranking is applied; run the default short/tool probe separately.

For the native Flash-Next NVFP4 service, add `--br-model flash-next-nvfp4` to both BR commands. This changes the expected model identity and request model together; the default remains `flash-next-paper2`.
