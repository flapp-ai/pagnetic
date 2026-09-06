"""Development-only SciPy reference and fixed-seed visitor-level calibration.

Run with a separate virtualenv (requirements-statistical-reference.txt), never the
production runtime. Synthetic paid outcomes are sparse lists; all other assigned
visitors have zero revenue. SciPy operates on independently computed sufficient
statistics and checks complete vectors in the first trial of every regime.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np
import scipy
from scipy import stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--experiments", type=int, default=2000)
    args = parser.parse_args()
    if args.experiments < 2000:
        parser.error("At least 2,000 experiments per regime are required")
    root = Path(__file__).resolve().parent.parent
    process = subprocess.Popen(
        [args.node, "--import", "tsx", "scripts/lib/statistical-reference-worker.ts"],
        cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    )

    def call(payload):
        process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        process.stdin.flush()
        result = json.loads(process.stdout.readline())
        if isinstance(result, dict) and "error" in result:
            raise RuntimeError(result["error"])
        return result

    def binomial(count):
        interval = stats.binomtest(count, args.experiments).proportion_ci()
        return {"count": count, "rate": count / args.experiments,
                "exact95Interval": [float(interval.low), float(interval.high)]}

    report = {"generatedAt": datetime.now(timezone.utc).isoformat(),
              "scope": "synthetic development calibration; not store validation or launch approval",
              "reference": {"scipy": scipy.__version__, "numpy": np.__version__,
                            "method": "ttest_ind_from_stats(equal_var=False), full-vector cross-checks, t.ppf"},
              "experimentsPerRegime": args.experiments, "seed": 20260905, "regimes": [], "powerRegimes": []}
    source_names = ["app/services/experiment-analysis-v2.ts", "app/services/qualification-v2.ts",
                    "app/services/qualification-health-forecast.ts", "app/services/experiment-health-v2.ts",
                    "scripts/lib/statistical-reference-worker.ts", "scripts/statistical-reference.py",
                    "scripts/requirements-statistical-reference.txt"]
    source_hashes = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in source_names}
    try:
        grid = [{"p": p, "df": df} for df in [1, 2, 5, 10, 30, 100, 1000, 100000, 10000000]
                for p in [.005, .025, .5, .975, .995]]
        actual = call({"quantiles": grid})
        max_error = max(abs(item["value"] - float(stats.t.ppf(case["p"], case["df"])))
                        for case, item in zip(grid, actual))
        report["quantileGrid"] = {"cases": len(grid), "maximumAbsoluteError": max_error,
                                  "tolerance": 1e-6, "passed": max_error < 1e-6}
        for regime_index, (conversion, sigma, repeats) in enumerate(
                (p, s, r) for p in [.01, .03, .1] for s in [.5, 1.5] for r in [False, True]):
            rng = np.random.default_rng(20260905 + regime_index)
            n = 2000
            two_sided = positive = covered = insufficient = 0
            max_interval_error = max_df_relative_error = 0.0
            for offset in range(0, args.experiments, 50):
                trials, references = [], []
                for _ in range(min(50, args.experiments - offset)):
                    samples = []
                    for _arm in range(2):
                        buyers = rng.binomial(n, conversion)
                        amounts = np.maximum(1, np.rint(rng.lognormal(math.log(10000) - sigma**2/2, sigma, buyers))).astype(np.int64)
                        if repeats:
                            # Same buyer may buy again in later sessions: aggregate BEFORE inference.
                            amounts *= 1 + rng.binomial(2, .3, buyers)
                        samples.append(amounts)
                    means = [float(np.sum(a)) / n for a in samples]
                    variances = [(float(np.dot(a.astype(float), a.astype(float))) - n*m*m)/(n-1)
                                 for a, m in zip(samples, means)]
                    ref = stats.ttest_ind_from_stats(means[1], math.sqrt(variances[1]), n,
                                                    means[0], math.sqrt(variances[0]), n, equal_var=False)
                    terms = [v/n for v in variances]
                    df = sum(terms)**2 / sum(t*t/(n-1) for t in terms)
                    half = float(stats.t.ppf(.975, df)) * math.sqrt(sum(terms))
                    effect = means[1] - means[0]
                    references.append((effect-half, effect+half, df))
                    if offset == 0 and not trials:
                        full = [np.pad(a, (0, n-len(a))) for a in samples]
                        full_test = stats.ttest_ind(full[1], full[0], equal_var=False)
                        full_ci = full_test.confidence_interval()
                        assert abs(full_ci.low - (effect-half)) < 1e-8
                        assert abs(float(full_test.pvalue) - float(ref.pvalue)) < 1e-10
                    trials.append({"n": n, "control": samples[0].tolist(),
                                   "treatment": samples[1].tolist(), "mde": .2})
                results = call({"trials": trials})
                for result, reference in zip(results, references):
                    lower, upper, df = reference
                    max_interval_error = max(max_interval_error, abs(result["lower"] - lower), abs(result["upper"] - upper))
                    max_df_relative_error = max(max_df_relative_error, abs(result["df"] - df)/df)
                    two_sided += int(result["lower"] > 0 or result["upper"] < 0)
                    covered += int(result["lower"] <= 0 <= result["upper"])
                    positive += int(result["state"] == "POSITIVE")
                    insufficient += int(result["state"] == "INSUFFICIENT_EVIDENCE")
            false_positive = binomial(two_sided)
            # Predeclared conservative calibration rule: upper 95% bound <= 7.5%.
            # Nominal 5% is reported separately; this is not an equivalence claim.
            entry = {"conversion": conversion, "lognormalSigma": sigma,
                     "repeatedPurchaseSessions": repeats, "visitorsPerArm": n,
                     "twoSidedFalsePositive": false_positive, "coverage": binomial(covered),
                     "positiveProductDecision": binomial(positive), "insufficient": insufficient,
                     "maxIntervalErrorMinor": max_interval_error, "maxDfRelativeError": max_df_relative_error,
                     "referencePassed": max_interval_error < 1e-6 and max_df_relative_error < 1e-10,
                     "calibrationPassed": false_positive["exact95Interval"][0] <= .05 and false_positive["exact95Interval"][1] <= .075}
            report["regimes"].append(entry)
            print(f"regime {regime_index+1}/12: p={conversion} sigma={sigma} repeats={repeats} FPR={two_sided/args.experiments:.4f} referenceError={max_interval_error:.3g}", file=sys.stderr, flush=True)
        for index, (conversion, sigma) in enumerate((p, s) for p in [.01, .03, .1] for s in [.5, 1.5]):
            rng = np.random.default_rng(20261000 + index)
            size = 10000
            buyers = int(size * conversion)
            baseline = np.maximum(1, np.rint(rng.lognormal(math.log(10000)-sigma*sigma/2, sigma, buyers)))
            plan = call({"qualification": {"values": np.pad(baseline, (0, size-buyers)).tolist()}})
            n = plan["targetVisitors"] // 2 if plan["targetVisitors"] else None
            if n is None or "BOOTSTRAP_POWER_BELOW_TARGET" in plan["reasons"] or "BOOTSTRAP_TARGET_EXCEEDS_SUPPORTED_BOUND" in plan["reasons"]:
                report["powerRegimes"].append({"conversion": conversion, "sigma": sigma, "plan": plan,
                                               "classification": "INFEASIBLE", "passed": True})
                continue
            detected = product_positive = negative_detected = 0
            probabilities = [1/size] * buyers + [1-buyers/size]
            for offset in range(0, args.experiments, 100):
                count = min(100, args.experiments-offset)
                # Exact fixed-size visitor resampling, unlike the production
                # Poisson approximation. Zero visitors are a multinomial category.
                weights = [rng.multinomial(n, probabilities, size=count)[:, :-1] for _ in range(2)]
                means = [w @ baseline / n for w in weights]
                variances = [(w @ (baseline**2) - n*m*m)/(n-1) for w, m in zip(weights, means)]
                for effect in [.2, -.2]:
                    treatment_mean = means[1] * (1+effect)
                    treatment_variance = variances[1] * (1+effect)**2
                    terms = [variances[0]/n, treatment_variance/n]
                    df = (terms[0]+terms[1])**2 / ((terms[0]**2+terms[1]**2)/(n-1))
                    half = stats.t.ppf(.975, df) * np.sqrt(terms[0]+terms[1])
                    difference = treatment_mean-means[0]
                    if effect > 0:
                        detected += int(np.sum(difference-half > 0))
                        product_positive += int(np.sum((difference-half > 0) & (difference/means[0] >= .2)))
                    else:
                        negative_detected += int(np.sum(difference+half < 0))
            interval = binomial(detected)
            entry = {"conversion": conversion, "sigma": sigma, "visitorsPerArm": n,
                     "baselineSize": size, "relativeEffect": .2,
                     "productionSimulatedPower": plan["simulatedPower"],
                     "productionPowerLowerBound": plan["simulatedPowerLowerBound"],
                     "independentFixedVisitorPower": interval,
                     "positiveProductDecision": binomial(product_positive),
                     "negativeEffectDetection": binomial(negative_detected),
                     "qualificationStatus": plan["status"], "qualificationReasons": plan["reasons"],
                     "passed": interval["exact95Interval"][0] >= .8}
            report["powerRegimes"].append(entry)
            print(f"power {index+1}/6: p={conversion} sigma={sigma} n={n} power={detected/args.experiments:.4f}, positive label={product_positive/args.experiments:.4f}", file=sys.stderr, flush=True)
        report["sourceHashes"] = source_hashes
        report["sourceUnchangedDuringRun"] = all(
            hashlib.sha256((root/name).read_bytes()).hexdigest() == value for name, value in source_hashes.items())
        report["passed"] = report["quantileGrid"]["passed"] and all(
            r["referencePassed"] and r["calibrationPassed"] for r in report["regimes"]) and all(
            r["passed"] for r in report["powerRegimes"]) and report["sourceUnchangedDuringRun"]
        Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
        return 0 if report["passed"] else 1
    finally:
        process.stdin.close()
        process.wait(timeout=30)


if __name__ == "__main__":
    sys.exit(main())
