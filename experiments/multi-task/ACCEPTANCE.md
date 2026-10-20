# Local acceptance

Baseline: `harness-v2@0f579a8`. Implementation: `4f1f7bc`.
Independent test author received only public CLI, HTTP, artifact and UI contracts;
it did not read implementation, internal tests or diffs. The coordinator ran the
checks and integrated the test commits.

## Results

- TypeScript build and JavaScript syntax checks passed.
- Existing suite: 78/78 passed after downloading the scaffold libraries.
- Independent suite: 5/5 passed in 40.8 seconds.
- Independent review of the runner's generated public prompt files passed:
  root defines interfaces/entry glue, parallel builders deliver coarse modules,
  root integrates and verifies the rough game, then fresh builders refine it.
  This verifies the instructions, not real-model compliance.
- Browser checks covered task/engine isolation, more than four builders, seven
  active requests, accurate final usage, frozen completion, resumed progress,
  retained interactive previews through broken edits, WebGL recovery and valid
  HTML without an explicit head.
- Runner checks covered concurrent task launch, configurable/default builder
  counts, successful completion, child failure and interruption cleanup.
- The real CLI used a local fake model endpoint to verify exact output directory
  identity, refusal to overwrite an existing run, and generation-end telemetry
  emitted before final scoring completed.
- Throughput checks used overlapping tasks with a common 20-second interval:
  3000 input tokens / 20 = 150 input tok/s, 400 output tokens / 20 = 20 output
  tok/s, and 700 reported cached tokens shown separately. Per-task contributions
  add to these totals. In-flight characters never contribute tokens.
- Other throughput cases covered scoring-free freezing, provisional active/failed
  usage, waiting engines, engine isolation, resumed wall time including downtime,
  labeled rounded historical timing and unavailable historical resume timing.

The first browser fixture drew only once; the independent author corrected it to
render continuously, as required by the public preview contract. No production
change was made to accommodate that fixture. No real model benchmark or remote
instance was started. Early playable output, speed gains, Paper2 quality and 5090
capacity remain unmeasured.

## Reproduce

After the setup in [README.md](README.md), run from the repository root:

```bash
npm run build
npm test
WB_TEST_ROOT="$PWD" node --test independent_blackbox/multi-task.test.mjs
```

## Change size

Relative to the baseline: executable production code **+454/-212, net +242**;
behavioral prompts **+20/-0**; combined production **+474/-212, net +262**.
Independent test code **+586/-0**. Documentation, downloaded libraries and
generated build output are excluded.

| Commit | Production + / - / net | Test + / - / net |
|---|---:|---:|
| `70a5f5d` dashboard | 298 / 202 / 96 | 0 / 0 / 0 |
| `e81d772` runner and prompts | 109 / 4 / 105 | 0 / 0 / 0 |
| `a8b0edd` documentation | 0 / 0 / 0 | 0 / 0 / 0 |
| `71c9909` supported output/resume paths | 23 / 11 / 12 | 0 / 0 / 0 |
| `a01cabe` independent acceptance | 0 / 0 / 0 | 302 / 0 / 302 |
| `3c29596` animated fixtures | 0 / 0 / 0 | 8 / 4 / 4 |
| `98c27d5` successful completion | 0 / 0 / 0 | 23 / 0 / 23 |
| `a84cd6e` resume and HTML cases | 0 / 0 / 0 | 26 / 3 / 23 |
| `93f1190` real CLI with local provider | 0 / 0 / 0 | 53 / 0 / 53 |
| `3db436e` parallel coarse build and early integration | 14 / 13 / 1 | 0 / 0 / 0 |
| `4f1f7bc` shared-wall input/output throughput | 69 / 21 / 48 | 0 / 0 / 0 |
| `9d69b8b` independent throughput acceptance | 0 / 0 / 0 | 184 / 3 / 181 |

The final acceptance/port documentation commit changes no production or test code.
