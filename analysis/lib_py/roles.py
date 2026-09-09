"""Phase C — historical usage-role share priors (spec §11 M07 / M12, §15).

`ability != usage`. These priors say *how targets / carries are distributed
across depth-chart roles*, learned from team-seasons; the current-roster
engine ranks players into roles from the depth-chart / usage system, then
draws which role gets the ball from these shares. Ratings never enter here.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import polars as pl

from .pbp import load_clean
from .report import ARTIFACTS
from .split import STANDARD

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


@dataclass
class RoleSpec:
    model_id: str
    name: str
    id_col: str                       # receiver_player_id | rusher_player_id
    n_named_roles: int                # roles 1..N kept individually
    tail_label: str                   # e.g. "5_PLUS" or "OTHER" for rank > N
    population: Callable[[pl.DataFrame], pl.Expr]
    extra_cols: list[str]
    contexts: dict[str, dict[str, pl.Expr]]  # dimension -> {level: bool expr}
    shrink_k: float = 60.0            # empirical-Bayes pseudo-count toward league mean
    min_team_season_events: int = 150
    target_definition: str = ""
    eligible_population: str = ""


def _role_label(rank_expr: pl.Expr, spec: RoleSpec) -> pl.Expr:
    return (
        pl.when(rank_expr <= spec.n_named_roles)
        .then(pl.format("ROLE_{}", rank_expr.cast(pl.Int32)))
        .otherwise(pl.lit(f"ROLE_{spec.tail_label}"))
    )


def _all_role_labels(spec: RoleSpec) -> list[str]:
    return [f"ROLE_{i}" for i in range(1, spec.n_named_roles + 1)] + [f"ROLE_{spec.tail_label}"]


def _team_season_role_shares(events: pl.DataFrame, spec: RoleSpec) -> pl.DataFrame:
    """One row per (season, team, role): raw n + share within team-season."""
    per_player = (
        events.group_by(["season", "posteam", spec.id_col])
        .agg(pl.len().alias("n"))
    )
    ranked = per_player.with_columns(
        pl.col("n").rank("ordinal", descending=True).over(["season", "posteam"]).alias("rank")
    ).with_columns(_role_label(pl.col("rank"), spec).alias("role"))
    by_role = (
        ranked.group_by(["season", "posteam", "role"]).agg(pl.col("n").sum().alias("n"))
    )
    totals = by_role.group_by(["season", "posteam"]).agg(pl.col("n").sum().alias("team_n"))
    return (
        by_role.join(totals, on=["season", "posteam"])
        .with_columns((pl.col("n") / pl.col("team_n")).alias("share"))
    )


def _summarise(shares: pl.DataFrame, spec: RoleSpec, dimension: str, level: str) -> list[dict]:
    """League role-share summary (mean/sd/quantiles across team-seasons), shrunk."""
    labels = _all_role_labels(spec)
    # league mean share per role (pooled events, not mean-of-ratios) for the shrink target
    pooled = (
        shares.group_by("role").agg(pl.col("n").sum().alias("n"))
    )
    grand = pooled["n"].sum()
    league_share = {r["role"]: r["n"] / grand for r in pooled.to_dicts()}

    rows = []
    ts_count = shares.select(["season", "posteam"]).unique().height
    for role in labels:
        sub = shares.filter(pl.col("role") == role)
        vals = sub["share"].to_numpy()
        ns = sub["team_n"].to_numpy()
        # empirical-Bayes shrink each team-season share toward the league share
        ls = league_share.get(role, 0.0)
        raw_n = sub["n"].to_numpy()
        shrunk = (raw_n + spec.shrink_k * ls) / (ns + spec.shrink_k) if len(ns) else np.array([])
        rows.append({
            "dimension": dimension, "level": level, "role": role,
            "league_share": float(ls),
            "mean_share": float(vals.mean()) if len(vals) else 0.0,
            "shrunk_mean_share": float(shrunk.mean()) if len(shrunk) else float(ls),
            "sd_share": float(vals.std()) if len(vals) > 1 else 0.0,
            "p10_share": float(np.percentile(vals, 10)) if len(vals) else 0.0,
            "p90_share": float(np.percentile(vals, 90)) if len(vals) else 0.0,
            "team_seasons": int(sub.select(["season", "posteam"]).unique().height),
            "total_team_seasons": ts_count,
        })
    return rows


def build_role_shares(spec: RoleSpec) -> dict:
    cols = sorted({
        spec.id_col, "posteam", "season", "down", "ydstogo", "yardline_100",
        "goal_to_go", "half_seconds_remaining", "game_seconds_remaining",
        "score_differential", *spec.extra_cols,
    })
    df = load_clean(STANDARD.production, base="core", columns=cols)
    df = df.filter(spec.population(df) & pl.col(spec.id_col).is_not_null() & (pl.col(spec.id_col) != ""))

    out_rows: list[dict] = []
    # overall
    overall = _team_season_role_shares(df, spec)
    overall = overall.filter(pl.col("team_n") >= spec.min_team_season_events)
    out_rows += _summarise(overall, spec, "overall", "all")
    # per context dimension / level
    for dim, levels in spec.contexts.items():
        for level, expr in levels.items():
            sub = df.filter(expr)
            if sub.height < 500:
                continue
            ts = _team_season_role_shares(sub, spec)
            ts = ts.filter(pl.col("team_n") >= 20)  # looser for sliced contexts
            out_rows += _summarise(ts, spec, dim, level)

    tidy = pl.DataFrame(out_rows)
    out = ARTIFACTS / "distributions"
    out.mkdir(parents=True, exist_ok=True)
    stem = "target_role_shares" if spec.id_col.startswith("receiver") else "carry_role_shares"
    tidy.write_parquet(out / f"{stem}.parquet")

    # per-team-season concentration diagnostic (Herfindahl of role shares, overall)
    hhi = (
        overall.group_by(["season", "posteam"])
        .agg((pl.col("share") ** 2).sum().alias("hhi"))
    )
    return {
        "tidy": tidy, "stem": stem,
        "team_seasons": overall.select(["season", "posteam"]).unique().height,
        "events": df.height,
        "hhi_mean": float(hhi["hhi"].mean()),
        "labels": _all_role_labels(spec),
    }


def role_report(spec: RoleSpec, res: dict) -> Path:
    from .report import ModelReport

    tidy: pl.DataFrame = res["tidy"]
    labels = res["labels"]

    def share_row(dim: str, level: str) -> str:
        sub = {r["role"]: r for r in tidy.filter(
            (pl.col("dimension") == dim) & (pl.col("level") == level)).to_dicts()}
        cells = " / ".join(f"{sub[l]['shrunk_mean_share']:.3f}" if l in sub else "—" for l in labels)
        return f"| {dim}={level} | {cells} |"

    overall = tidy.filter((pl.col("dimension") == "overall") & (pl.col("level") == "all")).to_dicts()
    context_dims = [d for d in tidy["dimension"].unique().to_list() if d != "overall"]

    body_lines = [
        "| context | " + " / ".join(labels) + " (shrunk mean share) |",
        "| --- | --- |",
        share_row("overall", "all"),
    ]
    for d in sorted(context_dims):
        for lv in sorted(tidy.filter(pl.col("dimension") == d)["level"].unique().to_list()):
            body_lines.append(share_row(d, lv))

    rep = ModelReport(spec.model_id, spec.name)
    rep.set("target definition", spec.target_definition)
    rep.set("eligible population", spec.eligible_population)
    rep.set("row count by season",
            f"{res['events']:,} events across {res['team_seasons']} team-seasons "
            f"({list(STANDARD.production)}).")
    rep.set("missingness",
            f"`{spec.id_col}` must be non-null (that IS the target). Sliced contexts with < 500 "
            "events or team-seasons with too few events are dropped from that slice.")
    rep.set("class distribution / target distribution", "\n".join(body_lines))
    rep.set("predictor list",
            "No fitted predictors — this is an empirical role-share table. Conditioning dimensions: "
            + ", ".join(sorted(set(tidy["dimension"].to_list()))) + ".")
    rep.set("forbidden-variable check",
            "No player ratings, no `overall`, no downstream outcomes. Role rank is by historical "
            "event volume within a team-season only (spec §15 usage≠ability).")
    rep.set("baseline model",
            f"Rank players by {('target' if spec.id_col.startswith('receiver') else 'carry')} volume "
            f"within each team-season → ROLE_1..{spec.n_named_roles}, ROLE_{spec.tail_label}. "
            f"Share per role per team-season, empirical-Bayes shrunk toward the league share "
            f"(pseudo-count k={spec.shrink_k}).")
    rep.set("challenger models", "None — a role-share prior, not a classifier.")
    rep.set("2024 validation metrics",
            "N/A (no fit). Role-share means are pooled over 2023–2025; the sd / p10 / p90 columns in "
            f"`artifacts/distributions/{res['stem']}.parquet` give the team-to-team spread the engine "
            "can sample.")
    rep.set("2025 locked test metrics", "N/A — see distribution parquet for spread.")
    rep.set("calibration plots",
            f"Mean role-share concentration (Herfindahl of the overall shares across team-seasons): "
            f"{res['hhi_mean']:.3f}.")
    rep.set("important conditional diagnostics",
            "Situational rows above show how the lead role's share moves in the red zone / short "
            "yardage / third down / two-minute / late-lead states relative to `overall=all`.")
    rep.set("historical residual variance estimates",
            "The `sd_share` / `p10_share` / `p90_share` columns per role ARE the historical "
            "team-to-team spread; the engine adds a per-team draw from these when assigning roles.")
    rep.set("final chosen model", f"Empirical shrunk role-share table → `artifacts/distributions/{res['stem']}.parquet`.")
    rep.set("production refit metadata",
            f"Built on {list(STANDARD.production)}; {res['team_seasons']} team-seasons, "
            f"{res['events']:,} events. Regenerate by re-running the script.")
    rep.data("stem", res["stem"])
    md, _ = rep.write()
    return md
