# Local acceptance

Baseline: `harness-v2@0f579a8`. Implementation: `3db436e`.
Independent test author received only public CLI, HTTP, artifact and UI contracts;
it did not read implementation, internal tests or diffs. The coordinator ran the
checks and integrated the test commits.

## Results

- TypeScript build passed for `71c9909`; corrected dashboard phase labels passed
  JavaScript syntax checking.
- Existing suite: 78/78 passed for `71c9909` after downloading the scaffold libraries.
- Independent suite: 4/4 passed for `71c9909` in 36.4 seconds.
- After the two-phase orchestration correction, the existing independent runner
  scenario passed again, covering counts, success, failure and interruption.
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
  identity and refusal to overwrite an existing run.

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

Relative to the baseline: executable production code **+401/-207, net +194**;
behavioral prompts **+20/-0**; combined production **+421/-207, net +214**.
Independent test code **+405/-0**. Documentation, downloaded libraries and
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

The final acceptance/port documentation commit changes no production or test code.
