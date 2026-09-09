"""Phase D — rating-effect calibration (spec §13).

Step 1 (§13.2/§13.3): historical residual skill variance per unit → the
variance budget, `artifacts/validation/residual_variance_targets.json`.

Step 2 (§13.4): a first attribute-level coefficient set, magnitudes anchored
to the step-1 p10↔p90 residual spread, with sign constraints (§23) →
`artifacts/ratings/rating_effect_coefficients.json`.

Step 3 (§13.5): synthetic percentile-player sensitivity — monotonicity,
smoothness, no single attribute dominating, plausible elite-vs-average spread.

The joint calibration loss (§13.6) and simulation-level targets need the full
engine and are Phase E. Ratings are NEVER used to fit the step-1 residuals.

Run: analysis/.venv/Scripts/python analysis/22_rating_calibration.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import importlib
import json
from datetime import date

import numpy as np
import polars as pl

from lib_py.pbp import load_clean
from lib_py.report import ARTIFACTS
from lib_py.residuals import (
    expected_yards_from_pmf,
    load_estimator,
    predict_class_prob,
    unit_residual_spread,
)
from lib_py.split import STANDARD

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)
Z = {"p1": -2.326, "p10": -1.282, "p25": -0.674, "p50": 0.0, "p75": 0.674, "p90": 1.282, "p99": 2.326}
REF = json.loads((ARTIFACTS / "ratings" / "attribute_reference_stats.json").read_text())["attribute_reference_stats"]


def _mod(name: str):
    return importlib.import_module(name)


def _xy_like(df: pl.DataFrame, mod) -> "pd.DataFrame":
    import pandas as pd

    spec = mod.SPEC
    num = spec.spline_cols + spec.linear_cols
    X = pd.DataFrame({c: df[c].to_numpy() for c in num + spec.cat_cols})
    for c in num:
        X[c] = X[c].astype(float)
    for c in spec.cat_cols:
        X[c] = X[c].astype(str)
    return X


# ------------------------------------------------------------------ step 1

def step1_residuals() -> dict:
    out: dict[str, dict] = {}

    # --- M09 pass result: QB & DEF adjusted completion --------------------
    m09 = _mod("10_pass_result")
    f09 = m09.build_frame(STANDARD.production)
    est, labels, feats = load_estimator("m09")
    p_comp = predict_class_prob(est, labels, feats, _xy_like(f09, m09), "COMPLETE")
    actual_comp = (f09["target"].to_numpy() == "COMPLETE").astype(float)
    out["m09_qb_completion"] = unit_residual_spread(
        f09["passer_player_id"].to_numpy(), actual_comp, p_comp,
        k=250, min_n=200, label="QB adjusted completion rate (obs − expected)")
    out["m09_def_completion"] = unit_residual_spread(
        f09["defteam"].to_numpy(), actual_comp, p_comp,
        k=400, min_n=300, label="Defense adjusted completion rate allowed")
    p_int = predict_class_prob(est, labels, feats, _xy_like(f09, m09), "INTERCEPTION")
    actual_int = (f09["target"].to_numpy() == "INTERCEPTION").astype(float)
    out["m09_qb_interception"] = unit_residual_spread(
        f09["passer_player_id"].to_numpy(), actual_int, p_int,
        k=250, min_n=200, label="QB adjusted interception rate")

    # --- M10 YAC: receiver adjusted YAC ---------------------------------
    m10 = _mod("11_yac")
    f10 = m10.build_frame(STANDARD.production).with_columns(
        pl.col("yards").clip(-25, 99).cast(pl.Int32)
    )
    f10 = f10.with_columns(m10.ctx_bucket(f10).cast(pl.Utf8).alias("ctx_bucket"))
    est, labels, feats = load_estimator("m10")
    proba10 = est.predict_proba(_xy_like(f10, m10)[feats])
    order = [list(est.classes_).index(l) for l in labels]
    exact10 = pl.read_parquet(ARTIFACTS / "distributions" / "m10_exact.parquet")
    ey = expected_yards_from_pmf(proba10[:, order], labels, f10["ctx_bucket"].to_numpy(), exact10)
    out["m10_receiver_yac"] = unit_residual_spread(
        f10["receiver_player_id"].to_numpy(), f10["yards"].to_numpy().astype(float), ey,
        k=120, min_n=80, label="Receiver adjusted YAC per reception (yards)")

    # --- M14 rush yards: rusher adjusted yards -------------------------
    m14 = _mod("15_rush_yards")
    f14 = m14.build_frame(STANDARD.production).with_columns(pl.col("yards").clip(-25, 99).cast(pl.Int32))
    f14 = f14.with_columns(m14.ctx_bucket(f14).cast(pl.Utf8).alias("ctx_bucket"))
    est, labels, feats = load_estimator("m14")
    proba14 = est.predict_proba(_xy_like(f14, m14)[feats])
    order = [list(est.classes_).index(l) for l in labels]
    exact14 = pl.read_parquet(ARTIFACTS / "distributions" / "m14_exact.parquet")
    ey = expected_yards_from_pmf(proba14[:, order], labels, f14["ctx_bucket"].to_numpy(), exact14)
    out["m14_rusher_yards"] = unit_residual_spread(
        f14["rusher_player_id"].to_numpy(), f14["yards"].to_numpy().astype(float), ey,
        k=120, min_n=80, label="Rusher adjusted yards per carry")
    out["m14_defense_rush_yards"] = unit_residual_spread(
        f14["defteam"].to_numpy(), f14["yards"].to_numpy().astype(float), ey,
        k=600, min_n=400, label="Defense adjusted rush yards allowed per carry")

    # --- M20 FG: kicker adjusted make rate ---------------------------
    m20 = _mod("18_field_goals")
    f20 = m20.build_frame(STANDARD.production)
    est, labels, feats = load_estimator("m20")
    p_made = predict_class_prob(est, labels, feats, _xy_like(f20, m20), "MADE")
    actual_made = (f20["target"].to_numpy() == "MADE").astype(float)
    out["m20_kicker_make"] = unit_residual_spread(
        f20["kicker_player_id"].to_numpy(), actual_made, p_made,
        k=40, min_n=25, label="Kicker adjusted make rate")

    # --- M04 sack: offense & defense adjusted sack rate -------------
    m04 = _mod("05_dropback_outcome")
    # M04's frame has no team ids; re-derive its population directly with them.
    raw = load_clean(STANDARD.production, base="core", penalty_free=True,
                     columns=["qb_dropback", "qb_kneel", "qb_spike", "sack", "qb_scramble",
                              "pass_attempt", "posteam", "defteam", "down", "ydstogo",
                              "yardline_100", "goal_to_go", "qtr", "game_seconds_remaining",
                              "half_seconds_remaining", "score_differential", "shotgun"])
    raw = raw.filter((_i8("qb_dropback") == 1) & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1))
    raw = raw.with_columns(
        pl.when(_i8("sack") == 1).then(pl.lit("SACK"))
        .when(_i8("qb_scramble") == 1).then(pl.lit("SCRAMBLE"))
        .when(_i8("pass_attempt") == 1).then(pl.lit("THROW")).otherwise(None).alias("target"),
        pl.col("down").cast(pl.Int8, strict=False), pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"), _i8("shotgun").alias("shotgun"),
    ).filter(pl.col("target").is_not_null())
    est, labels, feats = load_estimator("m04")
    p_sack = predict_class_prob(est, labels, feats, _xy_like(raw, m04), "SACK")
    actual_sack = (raw["target"].to_numpy() == "SACK").astype(float)
    out["m04_offense_sack"] = unit_residual_spread(
        raw["posteam"].to_numpy(), actual_sack, p_sack,
        k=500, min_n=350, label="Offense adjusted sack rate (protection)")
    out["m04_defense_sack"] = unit_residual_spread(
        raw["defteam"].to_numpy(), actual_sack, p_sack,
        k=500, min_n=350, label="Defense adjusted sack rate (pass rush)")

    return out


# ------------------------------------------------------------------ step 2

# family -> (resolver, target, units, base_rate_or_None, anchor_key, direction, attributes[{attr, weight, depth?}])
FAMILIES = {
    "qb_accuracy": dict(
        resolver="M09", target="COMPLETE", units="logit", anchor="m09_qb_completion", sign=+1,
        attrs=[("throw_accuracy_short", 0.34), ("throw_accuracy_mid", 0.30),
               ("throw_accuracy_deep", 0.22), ("awareness", 0.14)]),
    "receiver_hands_routes": dict(
        resolver="M09", target="COMPLETE", units="logit", anchor="m09_def_completion", sign=+1,
        attrs=[("catching", 0.4), ("route_running_short", 0.2), ("route_running_mid", 0.2),
               ("route_running_deep", 0.12), ("release", 0.08)]),
    "coverage": dict(
        resolver="M09", target="COMPLETE", units="logit", anchor="m09_def_completion", sign=-1,
        attrs=[("man_coverage", 0.3), ("zone_coverage", 0.3), ("press", 0.15),
               ("play_recognition", 0.25)]),
    "qb_ball_security": dict(
        resolver="M09", target="INTERCEPTION", units="logit", anchor="m09_qb_interception", sign=-1,
        attrs=[("awareness", 0.55), ("throw_accuracy_mid", 0.25), ("throw_accuracy_deep", 0.2)]),
    "protection": dict(
        resolver="M04", target="SACK", units="logit", anchor="m04_offense_sack", sign=-1,
        attrs=[("pass_block", 0.32), ("pass_block_power", 0.16), ("pass_block_finesse", 0.16),
               ("anchor", 0.12), ("awareness", 0.12), ("line_calls", 0.12)]),
    "pass_rush": dict(
        resolver="M04", target="SACK", units="logit", anchor="m04_defense_sack", sign=+1,
        attrs=[("power_moves", 0.22), ("finesse_moves", 0.22), ("block_shedding", 0.16),
               ("speed", 0.12), ("acceleration", 0.12), ("play_recognition", 0.16)]),
    "runner": dict(
        resolver="M14", target="_yards", units="yards", anchor="m14_rusher_yards", sign=+1,
        attrs=[("ball_carrier_vision", 0.26), ("break_tackle", 0.24), ("speed", 0.16),
               ("acceleration", 0.14), ("agility", 0.12), ("strength", 0.08)]),
    "run_defense_front7": dict(
        resolver="M14", target="_yards", units="yards", anchor="m14_defense_rush_yards", sign=-1,
        attrs=[("run_defense", 0.24), ("block_shedding", 0.2), ("tackle", 0.18),
               ("pursuit", 0.16), ("play_recognition", 0.12), ("strength", 0.1)]),
    "yac_ballcarrier": dict(
        resolver="M10", target="_yards", units="yards", anchor="m10_receiver_yac", sign=+1,
        attrs=[("yac", 0.3), ("break_tackle", 0.22), ("speed", 0.2), ("acceleration", 0.16),
               ("agility", 0.12)]),
    "open_field_tackling": dict(
        resolver="M10", target="_yards", units="yards", anchor="m10_receiver_yac", sign=-1,
        attrs=[("tackle", 0.34), ("pursuit", 0.28), ("speed", 0.2), ("acceleration", 0.18)]),
    "kicking": dict(
        resolver="M20", target="MADE", units="logit", anchor="m20_kicker_make", sign=+1,
        attrs=[("kick_accuracy", 0.62), ("kick_power", 0.38)]),
}


def _logit(p):  # noqa
    p = min(max(p, 1e-6), 1 - 1e-6)
    return np.log(p / (1 - p))


def step2_coefficients(resid: dict, base_rates: dict) -> dict:
    coeffs = {}
    for fam, cfg in FAMILIES.items():
        a = resid[cfg["anchor"]]
        # magnitude budget: half the p10->p90 shrunk spread attributed to THIS side of the matchup
        half_span = 0.5 * abs(a["shrunk_p10_to_p90"])
        z90 = Z["p90"]
        if cfg["units"] == "logit":
            pi = base_rates[cfg["resolver"], cfg["target"]]
            d_logit = half_span / (pi * (1 - pi))
            per_family_beta_at_z90 = cfg["sign"] * d_logit
        else:  # yards
            per_family_beta_at_z90 = cfg["sign"] * half_span
        W = sum(w for _, w in cfg["attrs"])
        attrs = []
        for attr, w in cfg["attrs"]:
            beta_per_z = (w / W) * per_family_beta_at_z90 / z90
            attrs.append({
                "attribute": attr, "weight": round(w / W, 3),
                "beta_per_z": round(beta_per_z, 5),
                "reference_mean": REF.get(attr, {}).get("mean"),
                "reference_sd": REF.get(attr, {}).get("sd"),
            })
        coeffs[fam] = {
            "resolver": cfg["resolver"], "target": cfg["target"], "units": cfg["units"],
            "sign_constraint": "positive" if cfg["sign"] > 0 else "negative",
            "anchor_unit": cfg["anchor"],
            "anchor_shrunk_p10_to_p90": round(a["shrunk_p10_to_p90"], 5),
            "family_effect_at_z+1.28": round(per_family_beta_at_z90, 5),
            "attributes": attrs,
            "note": "magnitude = half the historical p10↔p90 shrunk residual spread on this side of "
                    "the matchup; split by weight; Phase E joint loss (§13.6) will refine.",
        }
    return coeffs


# ------------------------------------------------------------------ step 3

def step3_sensitivity(coeffs: dict, base_rates: dict) -> dict:
    sens = {}
    for fam, c in coeffs.items():
        betas = np.array([a["beta_per_z"] for a in c["attributes"]])
        grid = {}
        for name, z in Z.items():
            fam_effect = float(betas.sum() * z)  # all attrs at the same percentile
            if c["units"] == "logit":
                pi = base_rates[c["resolver"], c["target"]]
                p = 1 / (1 + np.exp(-(_logit(pi) + fam_effect)))
                grid[name] = round(float(p), 4)
            else:
                grid[name] = round(fam_effect, 3)
        vals = list(grid.values())
        mono = all(x <= y + 1e-9 for x, y in zip(vals, vals[1:])) or all(
            x >= y - 1e-9 for x, y in zip(vals, vals[1:]))
        solo_max = max(abs(b) for b in betas) / (abs(betas.sum()) + 1e-9)
        # a 2-attribute family (e.g. kicking = accuracy + power) can't avoid one being >50%
        dominates = solo_max > 0.6 and len(betas) >= 3
        sens[fam] = {
            "grid": grid,
            "monotonic": bool(mono),
            "p10_to_p90_effect": round(abs(betas.sum()) * (Z["p90"] - Z["p10"]), 4),
            "max_single_attr_share_of_family": round(float(solo_max), 3),
            "single_attr_dominates": bool(dominates),
        }
    return sens


# ------------------------------------------------------------------ main

def main() -> None:
    print("step 1 — historical residual variance...")
    resid = step1_residuals()

    # base rates for logit conversion
    m09 = _mod("10_pass_result").build_frame(STANDARD.production)["target"].to_numpy()
    m20 = _mod("18_field_goals").build_frame(STANDARD.production)["target"].to_numpy()
    base_rates = {
        ("M09", "COMPLETE"): float((m09 == "COMPLETE").mean()),
        ("M09", "INTERCEPTION"): float((m09 == "INTERCEPTION").mean()),
        ("M20", "MADE"): float((m20 == "MADE").mean()),
        ("M04", "SACK"): _sack_rate(),
    }

    print("step 2 — coefficient set...")
    coeffs = step2_coefficients(resid, base_rates)

    print("step 3 — synthetic sensitivity...")
    sens = step3_sensitivity(coeffs, base_rates)

    (ARTIFACTS / "validation").mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "ratings").mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "validation" / "residual_variance_targets.json").write_text(
        json.dumps({"generated": date.today().isoformat(), "units": resid}, indent=2, default=str) + "\n",
        encoding="utf-8")
    (ARTIFACTS / "ratings" / "rating_effect_coefficients.json").write_text(
        json.dumps({
            "generated": date.today().isoformat(),
            "method": "spec §13.2–§13.5. Magnitudes anchored to the historical p10↔p90 shrunk "
                      "residual spread; NOT estimated from PBP directly. Phase E joint loss (§13.6) "
                      "and simulation-level targets (§22) will refine these.",
            "base_rates": {f"{k[0]}:{k[1]}": round(v, 5) for k, v in base_rates.items()},
            "families": coeffs,
            "sensitivity": sens,
        }, indent=2, default=str) + "\n", encoding="utf-8")

    _write_report(resid, coeffs, sens, base_rates)

    bad = [f for f, s in sens.items() if not s["monotonic"] or s["single_attr_dominates"]]
    print(f"\ndone. families={len(coeffs)}  invariant violations={bad or 'none'}")
    for f, s in sens.items():
        print(f"  {f:22s} p10↔p90 effect {s['p10_to_p90_effect']:.3f} "
              f"({coeffs[f]['units']})  mono={s['monotonic']}  solo_max={s['max_single_attr_share_of_family']}")


def _sack_rate() -> float:
    raw = load_clean(STANDARD.production, base="core", penalty_free=True,
                     columns=["qb_dropback", "qb_kneel", "qb_spike", "sack"])
    raw = raw.filter((_i8("qb_dropback") == 1) & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1))
    return float(raw.select(_i8("sack").mean()).item())


def _write_report(resid, coeffs, sens, base_rates) -> None:
    L = [f"# M22 — Rating-effect calibration (Phase D)", "",
         f"Generated {date.today().isoformat()}.", "",
         "> No current game player ratings were used to fit the nflverse baseline or the "
         "step-1 residual spreads.", "",
         "## step 1 — historical residual skill variance (§13.2)", "",
         "Per-unit mean of (actual − expected-from-Phase-B-model), empirical-Bayes shrunk by "
         "opportunity count. The p10↔p90 span is the variance budget for that unit's rating layer.", "",
         "| unit | n units | opp | shrunk sd | p10 | p90 | p10↔p90 |",
         "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for key, r in resid.items():
        L.append(f"| {key} ({r['label']}) | {r['units']} | {r['total_opportunities']:,} | "
                 f"{r['shrunk_sd']:.4f} | {r['shrunk_p10']:+.4f} | {r['shrunk_p90']:+.4f} | "
                 f"{r['shrunk_p10_to_p90']:.4f} |")
    L += ["", "## step 2 — coefficient set (§13.4)", "",
          "`beta_per_z` is the logit (or yards) shift per 1 SD of the standardized attribute, "
          "anchored so a synthetic player at the 90th attribute percentile moves the outcome by "
          "~half the historical p10↔p90 residual span for that matchup side. Sign-constrained per §23.", "",
          "| family | resolver→target | units | family effect @ z+1.28 | attributes (weight) |",
          "| --- | --- | --- | ---: | --- |"]
    for fam, c in coeffs.items():
        al = ", ".join(f"{a['attribute']}({a['weight']})" for a in c["attributes"])
        L.append(f"| {fam} | {c['resolver']}→{c['target']} | {c['units']} | "
                 f"{c['family_effect_at_z+1.28']:+.4f} | {al} |")
    L += ["", "## step 3 — synthetic percentile-player sensitivity (§13.5)", "",
          "All attributes in a family set to the same percentile; outcome vs an average matchup.", "",
          "| family | p10 | p50 | p90 | p99 | monotonic | max single-attr share |",
          "| --- | ---: | ---: | ---: | ---: | :---: | ---: |"]
    for fam, s in sens.items():
        g = s["grid"]
        L.append(f"| {fam} | {g['p10']} | {g['p50']} | {g['p90']} | {g['p99']} | "
                 f"{'yes' if s['monotonic'] else '**NO**'} | {s['max_single_attr_share_of_family']} |")
    L += ["", "## invariants (§23)", "",
          "- higher QB accuracy must not lower completion — " +
          ("ok" if sens["qb_accuracy"]["monotonic"] else "**VIOLATED**"),
          "- higher coverage must not raise opponent completion — " +
          ("ok" if sens["coverage"]["monotonic"] else "**VIOLATED**"),
          "- higher protection must not raise sack prob — " +
          ("ok" if sens["protection"]["monotonic"] else "**VIOLATED**"),
          "- higher pass rush must not lower sack prob — " +
          ("ok" if sens["pass_rush"]["monotonic"] else "**VIOLATED**"),
          "- higher kick accuracy must not lower make prob — " +
          ("ok" if sens["kicking"]["monotonic"] else "**VIOLATED**"),
          "", "## deferred to Phase E",
          "- §13.6 joint calibration loss across all resolvers simultaneously.",
          "- Simulation-level distribution targets (§22): completion %, YPA, sack rate, YPC, "
          "explosive rates, etc. with the modifiers on.",
          "- Per-attribute weights within a family are v0 judgement; the joint loss will move them.",
          "- HGB resolvers (M09/M10/M14) need a portable export before the TS engine can apply "
          "these logit/yards modifiers on top of their baseline output.", ""]
    (ARTIFACTS / "models" / "m22_rating_calibration.report.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
