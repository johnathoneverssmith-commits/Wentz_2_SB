"""Yardage-distribution resolver (spec §8 "multistage categorical + empirical
exact-yard distribution within category").

A YardageSpec supplies discrete outcome bins + a coarse context bucket. This:
  1. fits the category multinomial via lib_py.pipeline.run_resolver
  2. builds an empirical exact-yard PMF per (category x context bucket) from the
     locked-train seasons, Laplace-smoothed, with a category-global fallback
  3. evaluates the full mixture sampler on the 2025 locked test — held-out
     mean neg-log-likelihood, PIT (quantile) coverage, mean/variance match,
     and the tail (explosive) frequency — and folds those into the §20 report
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import polars as pl

from .pipeline import ResolverSpec, run_resolver
from .report import ARTIFACTS

Bin = tuple[str, float | None, float | None]  # (label, lo_incl, hi_incl); None = open


@dataclass
class YardageSpec:
    model_id: str
    name: str
    bins: list[Bin]
    source_cols: list[str]
    spline_cols: list[str]
    linear_cols: list[str]
    cat_cols: list[str]
    target_definition: str
    eligible_population: str
    context_bucket: Callable[[pl.DataFrame], pl.Expr]
    explosive_threshold: int
    residual_variance_note: str = (
        "N/A for the baseline. Phase D calibrates ball-carrier / blocker / defender rating "
        "families against the historical rusher/receiver residual spread, shifting category "
        "probabilities before the exact-yard draw (spec §12, §13)."
    )
    yard_min: int = -25
    yard_max: int = 99
    c_grid: tuple[float, ...] = (0.3, 1.0, 3.0)


def category_expr(bins: list[Bin]) -> pl.Expr:
    y = pl.col("yards")
    expr = pl
    branches = None
    for label, lo, hi in bins:
        cond = pl.lit(True)
        if lo is not None:
            cond = cond & (y >= lo)
        if hi is not None:
            cond = cond & (y <= hi)
        branches = pl.when(cond).then(pl.lit(label)) if branches is None else branches.when(cond).then(pl.lit(label))
    return branches.otherwise(pl.lit(bins[-1][0]))


def _pmf_table(df: pl.DataFrame) -> dict:
    """{(category, bucket): {yard: prob}} Laplace-smoothed, + {category: global pmf}."""
    counts = (
        df.group_by(["target", "ctx_bucket", "yards"]).agg(pl.len().alias("n"))
        .to_dicts()
    )
    by_cb: dict[tuple[str, str], dict[int, float]] = {}
    glob: dict[str, dict[int, float]] = {}
    for r in counts:
        by_cb.setdefault((r["target"], r["ctx_bucket"]), {})[int(r["yards"])] = float(r["n"])
        g = glob.setdefault(r["target"], {})
        g[int(r["yards"])] = g.get(int(r["yards"]), 0.0) + float(r["n"])

    def normalise(d: dict[int, float], support: list[int]) -> dict[int, float]:
        tot = sum(d.get(y, 0.0) + 1.0 for y in support)  # +1 Laplace over the observed support
        return {y: (d.get(y, 0.0) + 1.0) / tot for y in support}

    glob_norm = {c: normalise(d, sorted(d)) for c, d in glob.items()}
    out: dict = {"global": glob_norm, "by_cb": {}}
    MIN_N = 40
    for (cat, bucket), d in by_cb.items():
        support = sorted(glob[cat])  # use the category-wide yard support
        if sum(d.values()) < MIN_N:
            out["by_cb"][(cat, bucket)] = glob_norm[cat]
        else:
            out["by_cb"][(cat, bucket)] = normalise(d, support)
    return out


def _pmf_for(pmf: dict, cat: str, bucket: str) -> dict[int, float]:
    return pmf["by_cb"].get((cat, bucket), pmf["global"][cat])


def run_yardage_resolver(spec: YardageSpec, build_frame: Callable[[tuple[int, ...]], pl.DataFrame]):
    labels = [b[0] for b in spec.bins]

    def bf_cat(seasons: tuple[int, ...]) -> pl.DataFrame:
        df = build_frame(seasons).with_columns(
            pl.col("yards").clip(spec.yard_min, spec.yard_max).cast(pl.Int32).alias("yards")
        )
        return df.with_columns(
            category_expr(spec.bins).alias("target"),
            spec.context_bucket(df).cast(pl.Utf8).alias("ctx_bucket"),
        )

    def on_models(ctx: dict) -> dict[str, str]:
        from .split import STANDARD

        train = bf_cat(STANDARD.locked_train)
        pmf = _pmf_table(train)

        lt = bf_cat(STANDARD.locked_test)
        proba = ctx["locked_proba"]  # columns aligned to `labels`
        y_obs = lt["yards"].to_numpy().astype(int)
        buckets = lt["ctx_bucket"].to_numpy()
        li = {c: i for i, c in enumerate(labels)}

        # observed category of each row (which bin the true yards fall in)
        y_cat = lt["target"].to_numpy()

        nll, pit, e_mean, e_m2, e_tail = [], [], [], [], []
        base_glob = _global_pmf(train)
        base_nll = []
        for i in range(lt.height):
            b = buckets[i]
            # mixture pmf over the observed value
            p_y = 0.0
            m1 = m2 = tail = 0.0
            for c in labels:
                pc = float(proba[i, li[c]])
                d = _pmf_for(pmf, c, b)
                p_y += pc * d.get(int(y_obs[i]), 0.0)
                for yv, pv in d.items():
                    w = pc * pv
                    m1 += w * yv
                    m2 += w * yv * yv
                    if yv >= spec.explosive_threshold:
                        tail += w
            p_y = max(p_y, 1e-9)
            nll.append(-np.log(p_y))
            e_mean.append(m1)
            e_m2.append(m2)
            e_tail.append(tail)
            # PIT: F(y_obs) under the mixture
            cdf = 0.0
            for c in labels:
                pc = float(proba[i, li[c]])
                d = _pmf_for(pmf, c, b)
                cdf += pc * sum(pv for yv, pv in d.items() if yv <= y_obs[i])
            pit.append(cdf)
            base_nll.append(-np.log(max(base_glob.get(int(y_obs[i]), 0.0), 1e-9)))

        nll = np.array(nll); pit = np.array(pit)
        e_mean = np.array(e_mean); e_m2 = np.array(e_m2); e_tail = np.array(e_tail)
        model_mean = float(e_mean.mean())
        model_var = float((e_m2 - e_mean**2).mean())
        obs_mean = float(y_obs.mean()); obs_var = float(y_obs.var())
        obs_tail = float((y_obs >= spec.explosive_threshold).mean())

        # persist exact table
        out = ARTIFACTS / "distributions"
        out.mkdir(parents=True, exist_ok=True)
        rows = []
        for (cat, bucket), d in pmf["by_cb"].items():
            for yv, pv in d.items():
                rows.append({"category": cat, "ctx_bucket": bucket, "yards": yv, "prob": pv})
        pl.DataFrame(rows).sort(["category", "ctx_bucket", "yards"]).write_parquet(out / f"{ctx['stem']}_exact.parquet")

        metrics = {
            "holdout_2025_mean_neg_log_lik": float(nll.mean()),
            "baseline_global_pmf_neg_log_lik": float(np.array(base_nll).mean()),
            "pit_mean": float(pit.mean()),
            "pit_frac_below_0.1": float((pit < 0.1).mean()),
            "pit_frac_above_0.9": float((pit > 0.9).mean()),
            "obs_mean": obs_mean, "model_mean": model_mean,
            "obs_var": obs_var, "model_var": model_var,
            f"obs_rate_yards_ge_{spec.explosive_threshold}": obs_tail,
            f"model_rate_yards_ge_{spec.explosive_threshold}": float(e_tail.mean()),
        }
        from .pipeline import _merge_json
        _merge_json(ARTIFACTS / "validation" / "holdout_2025_metrics.json",
                    f"{spec.model_id}_distribution", metrics)

        md = [
            "The category model above is combined with an empirical exact-yard PMF per "
            f"(category × context bucket), built from {list(STANDARD.locked_train)} and "
            f"Laplace-smoothed (category-global fallback when a bucket has < 40 obs). Stored at "
            f"`artifacts/distributions/{ctx['stem']}_exact.parquet`.",
            "",
            "**Full-sampler distributional fit on 2025 (held-out):**",
            "",
            "| metric | value |",
            "| --- | ---: |",
            f"| mean neg-log-likelihood / play | {metrics['holdout_2025_mean_neg_log_lik']:.4f} |",
            f"| — vs global-PMF baseline | {metrics['baseline_global_pmf_neg_log_lik']:.4f} |",
            f"| PIT mean (want ≈ 0.50) | {metrics['pit_mean']:.3f} |",
            f"| PIT frac < 0.1 (want ≈ 0.10) | {metrics['pit_frac_below_0.1']:.3f} |",
            f"| PIT frac > 0.9 (want ≈ 0.10) | {metrics['pit_frac_above_0.9']:.3f} |",
            f"| mean yards obs / model | {obs_mean:.2f} / {model_mean:.2f} |",
            f"| variance obs / model | {obs_var:.1f} / {model_var:.1f} |",
            f"| P(yards ≥ {spec.explosive_threshold}) obs / model | {obs_tail:.3f} / {metrics[f'model_rate_yards_ge_{spec.explosive_threshold}']:.3f} |",
        ]
        return {"calibration plots": "\n".join(md)}

    rspec = ResolverSpec(
        model_id=spec.model_id, name=spec.name, labels=labels,
        source_cols=spec.source_cols, spline_cols=spec.spline_cols,
        linear_cols=spec.linear_cols, cat_cols=spec.cat_cols,
        target_definition=spec.target_definition, eligible_population=spec.eligible_population,
        residual_variance_note=spec.residual_variance_note, c_grid=spec.c_grid,
    )
    return run_resolver(rspec, bf_cat, on_models=on_models)


def _global_pmf(df: pl.DataFrame) -> dict[int, float]:
    c = df.group_by("yards").agg(pl.len().alias("n")).to_dicts()
    tot = sum(r["n"] for r in c)
    return {int(r["yards"]): r["n"] / tot for r in c}
