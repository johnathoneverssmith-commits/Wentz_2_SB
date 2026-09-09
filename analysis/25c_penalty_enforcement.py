"""Model 25c — Penalty type buckets, yardage & enforcement (spec MODEL 25 V1.5).

25a/25b give P(penalty fires). This gives, *conditional on a fire*:

  - which enforcement bucket   (P(bucket | hazard_class [, play_family]))
  - penalising side            (offense vs defense share)
  - yardage                    (fixed constant, or the DPI spot-foul PMF)
  - automatic first down       (p_auto_first per bucket)

Empirical distributions, not a fitted model (spec says "penalty_type
distribution", and there is no discipline rating in V1.5). 40+ raw
`penalty_type` strings are folded into 9 engine buckets. RAW stream, REG,
2023–25 (same mask as 25a/25b).

Outputs:
  artifacts/distributions/penalty_enforcement.parquet   (tidy: one row per bucket)
  artifacts/distributions/penalty_dpi_yards.parquet     (DPI yardage PMF by fp band)
  artifacts/models/m25c.report.md

Run: analysis/.venv/Scripts/python analysis/25c_penalty_enforcement.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.report import ARTIFACTS

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)

DEADBALL_TYPES = [
    "False Start", "Delay of Game", "Defensive Delay of Game",
    "Encroachment", "Neutral Zone Infraction", "Defensive Offside",
    "Illegal Shift", "Illegal Motion", "Illegal Formation",
    "Defensive Too Many Men on Field", "Offensive Too Many Men on Field",
    "Illegal Substitution",
]

# raw penalty_type -> engine bucket
BUCKET = {
    # dead-ball
    "False Start": "false_start", "Offensive Offside": "false_start",
    "Illegal Formation": "offensive_procedure", "Illegal Motion": "offensive_procedure",
    "Illegal Shift": "offensive_procedure", "Illegal Substitution": "offensive_procedure",
    "Offensive Too Many Men on Field": "offensive_procedure",
    "Delay of Game": "delay_of_game",
    "Encroachment": "defensive_presnap", "Neutral Zone Infraction": "defensive_presnap",
    "Defensive Offside": "defensive_presnap", "Defensive Too Many Men on Field": "defensive_presnap",
    "Defensive Delay of Game": "defensive_presnap",
    # live-ball
    "Offensive Holding": "offensive_holding", "Chop Block": "offensive_holding",
    "Illegal Block Above the Waist": "offensive_holding", "Illegal Blindside Block": "offensive_holding",
    "Low Block": "offensive_holding", "Clipping": "offensive_holding", "Illegal Crackback": "offensive_holding",
    "Offensive Pass Interference": "offensive_pass_foul", "Illegal Touch Pass": "offensive_pass_foul",
    "Illegal Forward Pass": "offensive_pass_foul",
    "Defensive Pass Interference": "defensive_pass_interference",
    "Defensive Holding": "defensive_holding_contact", "Illegal Contact": "defensive_holding_contact",
    "Illegal Use of Hands": "defensive_holding_contact",
    "Roughing the Passer": "roughing_personal", "Roughing the Kicker": "roughing_personal",
    "Unnecessary Roughness": "roughing_personal", "Face Mask": "roughing_personal",
    "Horse Collar Tackle": "roughing_personal", "Unsportsmanlike Conduct": "roughing_personal",
    "Taunting": "roughing_personal", "Leverage": "roughing_personal", "Leaping": "roughing_personal",
    "Hands to the Face": "roughing_personal", "Disqualification": "roughing_personal",
    "Intentional Grounding": "intentional_grounding",  # loss of down, spot at foul
}
DEFAULT_BUCKET = "other"
SPOT_FOUL = {"defensive_pass_interference"}


def _load() -> pl.DataFrame:
    raw = pl.concat(
        [pl.read_parquet(ARTIFACTS.parent / "data" / f"play_by_play_{y}.parquet")
         for y in (2023, 2024, 2025)],
        how="vertical_relaxed",
    )
    raw = raw.filter(
        (_i8("play_deleted") != 1) & (_i8("aborted_play") != 1)
        & (pl.col("season_type") == "REG")
        & pl.col("posteam").is_not_null() & (pl.col("posteam") != "")
        & pl.col("down").is_not_null() & pl.col("yardline_100").is_not_null()
        & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1)
        & (_i8("penalty") == 1) & pl.col("penalty_type").is_not_null()
    )
    fam = (
        pl.when(pl.col("play_type") == "punt").then(pl.lit("punt"))
        .when(pl.col("play_type") == "field_goal").then(pl.lit("field_goal"))
        .when((_i8("pass") == 1) | (_i8("qb_dropback") == 1)).then(pl.lit("dropback"))
        .when(_i8("rush") == 1).then(pl.lit("designed_run"))
        .otherwise(pl.lit("other"))
    )
    return raw.with_columns(
        pl.col("penalty_type").replace_strict(BUCKET, default=DEFAULT_BUCKET).alias("bucket"),
        pl.col("penalty_type").is_in(DEADBALL_TYPES).alias("is_deadball"),
        (pl.col("penalty_team") == pl.col("posteam")).alias("off_pen"),
        fam.alias("play_family"),
        pl.when(pl.col("yardline_100") <= 20).then(pl.lit("opp_rz"))
        .when(pl.col("yardline_100") <= 50).then(pl.lit("opp_mid"))
        .otherwise(pl.lit("own_half")).alias("fp_band"),
    )


def main() -> None:
    df = _load()
    dist = ARTIFACTS / "distributions"
    dist.mkdir(exist_ok=True)

    rows = []
    for hz, sub in (("deadball", df.filter("is_deadball")),
                    ("liveball", df.filter(pl.col("is_deadball").not_()))):
        fams = ["ALL"] if hz == "deadball" else ["dropback", "designed_run", "punt", "field_goal"]
        for fam in fams:
            g = sub if fam == "ALL" else sub.filter(pl.col("play_family") == fam)
            if g.height < 30:
                continue
            tot = g.height
            for b, bg in g.group_by("bucket"):
                b = b[0]
                rows.append({
                    "hazard_class": hz, "play_family": fam, "bucket": b,
                    "share": bg.height / tot,
                    "off_share": float(bg.select(pl.col("off_pen").mean()).item()),
                    "mean_yards": float(bg.select(pl.col("penalty_yards").mean()).item()),
                    "sd_yards": float(bg.select(pl.col("penalty_yards").std()).item() or 0.0),
                    "p_auto_first": float(bg.select(_i8("first_down_penalty").mean()).item()),
                    "is_spot_foul": b in SPOT_FOUL,
                    "n": bg.height,
                })
    enf = pl.DataFrame(rows).sort(["hazard_class", "play_family", "share"], descending=[False, False, True])
    enf.write_parquet(dist / "penalty_enforcement.parquet")

    # DPI spot-foul yardage PMF by field-position band (Laplace-smoothed)
    dpi = df.filter(pl.col("bucket") == "defensive_pass_interference")
    pmf_rows = []
    for band, bg in dpi.group_by("fp_band"):
        band = band[0]
        vc = bg.group_by("penalty_yards").len().sort("penalty_yards")
        ys = vc["penalty_yards"].to_list()
        ns = [c + 1.0 for c in vc["len"].to_list()]  # Laplace
        s = sum(ns)
        for y, c in zip(ys, ns):
            pmf_rows.append({"fp_band": band, "yards": int(y), "prob": c / s, "n": bg.height})
    pl.DataFrame(pmf_rows).write_parquet(dist / "penalty_dpi_yards.parquet")

    # report
    ng = 816  # REG games 2023-25
    md = ["# M25c — Penalty type buckets, yardage & enforcement (V1.5)", "",
          f"Generated from {df.height:,} accepted penalties, REG 2023–25 "
          f"({df.height / ng:.1f} / game, both teams). Empirical distributions; "
          "no discipline rating (spec MODEL 25).", "",
          "## enforcement table (`penalty_enforcement.parquet`)", "",
          "| hazard | play_family | bucket | share | off_share | mean_yд | p_auto_1st | spot | n |",
          "| --- | --- | --- | ---: | ---: | ---: | ---: | :---: | ---: |"]
    for r in enf.to_dicts():
        md.append(f"| {r['hazard_class']} | {r['play_family']} | {r['bucket']} | "
                  f"{r['share']:.3f} | {r['off_share']:.2f} | {r['mean_yards']:.1f} | "
                  f"{r['p_auto_first']:.2f} | {'✓' if r['is_spot_foul'] else ''} | {r['n']} |")
    md += ["", "## DPI spot-foul yardage (`penalty_dpi_yards.parquet`)", "",
           "| fp_band | mean enforced yд | n |", "| --- | ---: | ---: |"]
    for band in ["own_half", "opp_mid", "opp_rz"]:
        bg = dpi.filter(pl.col("fp_band") == band)
        if bg.height:
            md.append(f"| {band} | {bg.select(pl.col('penalty_yards').mean()).item():.1f} | {bg.height} |")
    md += ["", "Engine: DPI enforced to the spot, capped at the 1-yard line; all "
           "other buckets use `mean_yards` rounded to the standard 5/10/15. "
           "`p_auto_first` overrides the down logic; `off_share` picks the "
           "penalised team; accept/decline is deterministic (better outcome)."]
    (ARTIFACTS / "models" / "m25c.report.md").write_text("\n".join(md), encoding="utf-8")

    print(f"M25c: {df.height:,} penalties -> {enf.height} bucket rows, "
          f"{len(pmf_rows)} DPI PMF rows")
    print(enf.filter(pl.col("hazard_class") == "liveball").select(
        "play_family", "bucket", "share", "mean_yards", "p_auto_first").head(12))


if __name__ == "__main__":
    main()
