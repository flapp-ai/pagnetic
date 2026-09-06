# Pagnetic v2 statistical calibration — development evidence

Date: 2026-09-05. Scope: independent S04 numerical and synthetic statistical checks, not a real-store A/A result, production readiness approval, revenue promise or PMF evidence.

## Reproducible evidence

Machine output: `docs/audit-2026-09-05/statistical-calibration.json`. The run records source SHA-256 values before execution and verifies that all measured source files remain unchanged afterward. It passed on pinned Node 24.19.0, SciPy 1.17.1 and NumPy 2.4.2. Python is isolated in a development virtual environment; no production Python dependency was added.

```sh
python3 -m venv /tmp/pagnetic-statistical-reference-env-20260905
/tmp/pagnetic-statistical-reference-env-20260905/bin/pip install -r scripts/requirements-statistical-reference.txt
/tmp/pagnetic-statistical-reference-env-20260905/bin/python3 scripts/statistical-reference.py --node /Users/erenyigit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --output docs/audit-2026-09-05/statistical-calibration.json
```

Use a fresh task-owned environment if that temporary path belongs to another task. This script processes synthetic data only. Do not pass customer rows to this public evidence artifact.

## Independent estimator check

The bridge calls the actual TypeScript `analyzeV2Experiment` for every null experiment. An independent SciPy Welch calculation uses separately computed sufficient statistics, with full visitor-vector cross-checks in each regime. The reference uses `equal_var=False` and checks the difference interval and degrees of freedom, not merely whether both implementations emit the same label. See [SciPy's independent-sample test contract](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html).

- Forty-five Student-t quantile cases: degrees of freedom 1 through 10,000,000; probabilities .005, .025, .5, .975 and .995. Maximum absolute quantile error was approximately 5.34e-10 against a 1e-6 tolerance.
- Twelve null regimes, 2,000 experiments each: conversion 1%, 3%, 10%; lognormal AOV sigma .5 or 1.5; single purchase or repeated purchase sessions. Each experiment has 2,000 assigned visitors per arm, including zero-order visitors.
- Repeated purchases are aggregated within visitor before inference. Sessions are not resampled as independent shoppers.
- Across 24,000 null experiments, two-sided false-positive rates ranged from 2.30% to 5.25%; corresponding coverage ranged from 94.75% to 97.70%. Heavy tails were often conservative, not nominally exact. Maximum interval discrepancy was under 3e-9 minor units.
- Every regime reports its exact 95% binomial Monte Carlo interval. The harness rejects clear nominal-alpha inflation (lower interval bound above 5%) and rejects an upper uncertainty bound above 7.5%. These are development regression criteria, not a license to change the registered experiment alpha. No live data or outcomes were used to choose a gate.

These finite tests do not establish universal validity for arbitrary tail shapes, tiny cohorts, missingness or distribution shift. Such extrapolation needs new evidence; do not advertise the entire input space as calibrated.

## Power and qualification

Qualification v2.2 retains the greater analytic/bootstrap target but no longer accepts a simulated point estimate of .800 as sufficient. It requires a Wilson lower bound of at least the requested power, with a one-sided Bonferroni adjustment for at most seven candidate sizes, and at least 2,000 replicates. The source snapshot records this lower bound, method and version. [NIST documents the Wilson construction](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). The bound quantifies simulation uncertainty conditional on the observed baseline; it is not a bound on future business performance or baseline sampling error.

An independent fixed-size multinomial visitor bootstrap checks the production Poisson-weight approximation using six synthetic 10,000-visitor baselines and 2,000 experiments per regime. A 20% mean effect is injected by scaling treatment purchaser revenue. Zero visitors form a retained multinomial category. The independent test uses Welch, not the production planner's normal approximation.

| Conversion | AOV sigma | Planned visitors per arm | Independent detection power | Exact 95% interval |
|---|---:|---:|---:|---:|
| 1% | .5 | 76,923 | 88.70% | 87.23–90.06% |
| 1% | 1.5 | 270,399 | 88.80% | 87.34–90.15% |
| 3% | .5 | 25,504 | 88.25% | 86.76–89.63% |
| 3% | 1.5 | 124,888 | 88.95% | 87.49–90.29% |
| 10% | .5 | 7,155 | 88.55% | 87.07–89.91% |
| 10% | 1.5 | 47,790 | 89.95% | 88.55–91.23% |

All six independent lower confidence bounds exceed 80%. Negative-effect checks are also recorded. The same visitor draws are reused for the negative counterfactual, so these are not an additional set of independent experiments. Four of the six baselines remain PREVIEW_ONLY because their eligible traffic cannot deliver the target within 42 enrollment days. Passing a mathematical power calculation must not override that feasibility limit.

Important UX distinction: at a true effect exactly equal to the registered worthwhile threshold, the product's stricter POSITIVE label occurred approximately 48–51% of the time because it also requires the point estimate to exceed that threshold. Detection power is not the probability of receiving a POSITIVE label, and neither is a promise that a proposed treatment will produce the injected effect. Preserve the PRD result rule and explain this distinction; do not weaken the threshold to improve a headline.

## Adversarial corrections and unfinished integration

`tests/statistical-adversarial.test.ts` covers invalid probability/degree inputs, nonfinite thresholds and dates, unsupported currency, malformed arm/order counts, one zero-variance arm, no arms, missing financial reconciliation, invalid health, interrupted tests and simulation-uncertainty guards. The combined S04/adversarial focused run passes 11 tests. Full lint passed. A concurrent full typecheck caught Sol's in-progress S05 schema/type/test changes; an integrated green checkpoint must be obtained after those settle.

Subsequent checks: typecheck, full no-cache lint and the 11-test focused suite pass. Actual PostgreSQL lifecycle concurrency reproduced and fixed a stale cohort cutoff; the current database rehearsal includes the concurrent visitor. The final statistical rerun passed with unchanged current source hashes.

Subsequent v2.3 checkpoint: qualification now enforces mature-outcome coverage dates, distinct first-eligible daily cohort totals and observed checkout-visitor rate. The per-arm information floor contributes to A/A and A/B forecasts without reducing statistical targets. The entire reference harness was rerun successfully with these sources included in its hash manifest. See `33-v2-capture-health-and-qualification.md` for the conditional planning assumptions, infeasibility behavior and remaining production data-source assembly. This supersedes the earlier forecast-gap note, not its historical test record.

Still required: authoritative production baseline assembly; production job/merchant-plan integration; intended-store end-to-end checks; and explicit policy for distribution regimes beyond this evidence. Immutable financial as-of/report handling and health-denominator fault injection now have separate local evidence in documents32/33. This document does not close S04/S10 or the launch goal by itself.
