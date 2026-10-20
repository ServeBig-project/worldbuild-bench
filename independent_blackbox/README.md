# Independent multi-task acceptance

These tests were written from the public dashboard/runner contract without reading production sources, existing tests, or implementation diffs.

Run from this checkout after the production checkout has installed Playwright and its Chromium browser:

```bash
WB_TEST_ROOT=/absolute/path/to/production node --test independent_blackbox/multi-task.test.mjs
```

The suite checks four-run selection and isolation, every recorded descendant, authoritative result usage, frozen completion time and resumed execution, missing future runs, the existing single-run URL, and a playable canvas retained across an erroneous edit then replaced by a healthy WebGL game, including HTML without explicit head tags. Runner checks use a temporary `npx` executable through normal `PATH`; they exercise concurrent task startup, output/manifest paths, interruption, child failure, and successful terminal outcomes without model calls.

The fixtures prove rendering, telemetry and keyboard interaction. They do not establish real LLM coarse-first compliance, gameplay quality, or performance on the target GPU. The runner stub does not simulate model execution.
