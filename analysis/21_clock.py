"""Model 24 — Clock runoff (spec §11 M24).

Empirical time-to-next-snap distributions, conditioned on the current play's
outcome, tempo, and late-game state — NOT one global "seconds per play"
distribution. The engine layers these on top of deterministic NFL
clock-stop/start rules. Discontinuities at quarter/half/possession-change/
score are excluded from the fit (audited counts in the report).

Output: artifacts/distributions/clock_runoff.parquet (per-bucket seconds PMF
+ summary), artifacts/models/m24.report.md.

Run: analysis/.venv/Scripts/python analysis/21_clock.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import json
from datetime import date

import numpy as np
import polars as pl

from lib_py.pbp import load_raw, admin_exclusion_mask, production_baseline_mask
from lib_py.report import ARTIFACTS
from lib_py.split import STANDARD

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)

COLS = [
    "game_id", "play_id", "order_sequence", "game_seconds_remaining", "qtr", "drive",
    "posteam", "play_type", "sack", "qb_scramble", "qb_kneel", "qb_spike", "rush_attempt",
    "pass_attempt", "complete_pass", "interception", "touchdown", "no_huddle",
    "out_of_bounds", "timeout", "kickoff_attempt", "field_goal_attempt", "punt_attempt",
    "extra_point_attempt", "season_type", "season", "play_deleted", "aborted_play",
]


def _prep(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_raw(seasons, columns=COLS).filter(admin_exclusion_mask() & production_baseline_mask())
    order = "order_sequence" if df["order_sequence"].null_count() < df.height * 0.02 else "play_id"
    df = df.sort(["game_id", order])

    nxt = pl.col("game_seconds_remaining").shift(-1).over("game_id")
    same_qtr = pl.col("qtr").shift(-1).over("game_id") == pl.col("qtr")
    same_drive = pl.col("drive").shift(-1).over("game_id") == pl.col("drive")
    next_is_st = (
        (_i8("kickoff_attempt").shift(-1).over("game_id") == 1)
        | (_i8("extra_point_attempt").shift(-1).over("game_id") == 1)
    )
    elapsed = (pl.col("game_seconds_remaining") - nxt)

    df = df.with_columns(elapsed.alias("elapsed"), same_qtr.alias("_sq"),
                         same_drive.alias("_sd"), next_is_st.alias("_st"))

    # current play must be a real scrimmage snap
    scrimmage = (
        (_i8("rush_attempt") == 1) | (_i8("pass_attempt") == 1) | (_i8("sack") == 1)
    ) & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1)

    kept = df.filter(
        scrimmage & pl.col("elapsed").is_not_null() & pl.col("_sq") & pl.col("_sd") & ~pl.col("_st")
        & (pl.col("elapsed") > 0) & (pl.col("elapsed") <= 60) & (_i8("touchdown") != 1)
    )
    dropped = df.filter(scrimmage).height - kept.height

    bucket = (
        pl.when(_i8("sack") == 1).then(pl.lit("sack"))
        .when(_i8("qb_scramble") == 1).then(pl.lit("scramble"))
        .when((_i8("pass_attempt") == 1) & (_i8("complete_pass") != 1) & (_i8("interception") != 1))
        .then(pl.lit("pass_incomplete"))
        .when((_i8("complete_pass") == 1) & (_i8("out_of_bounds") == 1)).then(pl.lit("pass_complete_oob"))
        .when(_i8("complete_pass") == 1).then(pl.lit("pass_complete_inbounds"))
        .when((_i8("rush_attempt") == 1) & (_i8("out_of_bounds") == 1)).then(pl.lit("run_oob"))
        .otherwise(pl.lit("run_inbounds"))
    )
    kept = kept.with_columns(
        bucket.alias("outcome_bucket"),
        _i8("no_huddle").alias("no_huddle"),
        pl.when(pl.col("game_seconds_remaining") <= 300).then(pl.lit("final_5min"))
        .when(pl.col("game_seconds_remaining") <= 600).then(pl.lit("final_10min"))
        .otherwise(pl.lit("normal")).alias("clock_state"),
        pl.col("elapsed").round().cast(pl.Int32).alias("elapsed_s"),
    )
    kept._dropped = dropped  # type: ignore[attr-defined]
    return kept


def main() -> None:
    train = _prep(STANDARD.locked_train)
    test = _prep(STANDARD.locked_test)

    keys = ["outcome_bucket", "no_huddle", "clock_state"]
    summary = (
        train.group_by(keys)
        .agg(
            pl.len().alias("n"),
            pl.col("elapsed").mean().alias("mean_s"),
            pl.col("elapsed").std().alias("sd_s"),
            pl.col("elapsed").quantile(0.1).alias("p10"),
            pl.col("elapsed").quantile(0.5).alias("p50"),
            pl.col("elapsed").quantile(0.9).alias("p90"),
        )
        .sort(keys)
    )
    pmf = (
        train.group_by([*keys, "elapsed_s"]).agg(pl.len().alias("n"))
        .sort([*keys, "elapsed_s"])
    )
    out = ARTIFACTS / "distributions"
    out.mkdir(parents=True, exist_ok=True)
    pmf.write_parquet(out / "clock_runoff.parquet")
    summary.write_parquet(out / "clock_runoff_summary.parquet")

    # holdout: predict elapsed as the bucket mean, compare on 2025
    means = {tuple(r[k] for k in keys): r["mean_s"] for r in summary.to_dicts()}
    global_mean = float(train["elapsed"].mean())
    te = test.to_dicts()
    err = []
    for r in te:
        pred = means.get(tuple(r[k] for k in keys), global_mean)
        err.append(r["elapsed"] - pred)
    err = np.array(err)
    obs_mean = float(test["elapsed"].mean())

    per_bucket = (
        test.group_by("outcome_bucket")
        .agg(pl.len().alias("n"), pl.col("elapsed").mean().alias("obs_mean_2025"))
        .join(
            train.group_by("outcome_bucket").agg(pl.col("elapsed").mean().alias("train_mean")),
            on="outcome_bucket", how="left",
        )
        .sort("outcome_bucket")
    )

    metrics = {
        "generated": date.today().isoformat(),
        "order_key": "order_sequence",
        "train_rows": train.height,
        "test_rows": test.height,
        "dropped_discontinuities_train": int(getattr(train, "_dropped", 0)),
        "holdout_2025": {
            "obs_mean_elapsed_s": obs_mean,
            "pred_mae_s": float(np.abs(err).mean()),
            "pred_bias_s": float(err.mean()),
            "within_5s_frac": float((np.abs(err) <= 5).mean()),
        },
        "per_bucket_2025": per_bucket.to_dicts(),
    }
    (ARTIFACTS / "validation" / "holdout_2025_metrics.json")
    _merge(ARTIFACTS / "validation" / "holdout_2025_metrics.json", "M24", metrics)

    md = f"""# M24 — Clock runoff

Generated {date.today().isoformat()}.

> No current game player ratings were used to fit the nflverse baseline.

## method

Time to the next scrimmage snap, `elapsed = game_seconds_remaining[i] - game_seconds_remaining[i+1]`,
sorted within each game by `order_sequence`. Kept only same-quarter, same-drive,
non-touchdown scrimmage snaps whose next play is not a kickoff/XP, with
`0 < elapsed <= 60`. {metrics['dropped_discontinuities_train']:,} discontinuity rows dropped
from the locked-train fit (quarter/drive/score/ST boundaries).

Empirical `elapsed` PMF + summary conditioned on
**outcome_bucket × no_huddle × clock_state**, at
`artifacts/distributions/clock_runoff.parquet` (+ `_summary`). The engine
applies deterministic NFL clock stop/start rules and draws the residual
play/huddle/snap-tempo time from these (spec §11 M24).

Buckets: sack, scramble, pass_incomplete, pass_complete_oob,
pass_complete_inbounds, run_oob, run_inbounds. clock_state:
normal / final_10min / final_5min.

## holdout (2025)

| metric | value |
| --- | ---: |
| observed mean elapsed | {obs_mean:.2f} s |
| bucket-mean prediction MAE | {metrics['holdout_2025']['pred_mae_s']:.2f} s |
| prediction bias | {metrics['holdout_2025']['pred_bias_s']:+.2f} s |
| within 5 s | {metrics['holdout_2025']['within_5s_frac']:.3f} |

### per outcome bucket

| bucket | n (2025) | obs mean 2025 | train mean |
| --- | ---: | ---: | ---: |
""" + "\n".join(
        f"| {r['outcome_bucket']} | {r['n']:,} | {r['obs_mean_2025']:.2f} | {r['train_mean']:.2f} |"
        for r in per_bucket.to_dicts()
    ) + """

## notes

- A mean-only predictor is a diagnostic; the engine samples the full PMF.
- Stoppages (incompletions, OOB, two-minute warning, timeouts) are handled by
  the deterministic rule layer; this model supplies the *running-clock* and
  huddle time between snaps.
- Timeout and spike/kneel plays are excluded (handled administratively, §6.3).
"""
    (ARTIFACTS / "models" / "m24.report.md").write_text(md, encoding="utf-8")
    print(f"M24 Clock runoff: train {train.height:,} / test {test.height:,}  "
          f"MAE {metrics['holdout_2025']['pred_mae_s']:.2f}s  bias {metrics['holdout_2025']['pred_bias_s']:+.2f}s")


def _merge(path, key, payload):
    existing = json.loads(path.read_text()) if path.exists() else {}
    existing[key] = payload
    path.write_text(json.dumps(existing, indent=2, default=str) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
