"""Artifact loaders — every classifier resolver as portable JSON
(`analysis/27_export_portable.py`), plus empirical PMF tables. All cached, no
joblib / sklearn at runtime."""

from __future__ import annotations

import functools
import json

import numpy as np

from lib_py.hgb_portable import predict_proba_portable
from lib_py.linear_portable import predict_proba_linear
from lib_py.report import ARTIFACTS

_MODELS = ARTIFACTS / "models"
_DIST = ARTIFACTS / "distributions"
_PORTABLE = _MODELS / "portable"

# resolvers whose portable JSON is a `linear-portable-1` (spline+logistic);
# everything else in artifacts/models/portable is `hgb-portable-1`.
_LINEAR_IDS = frozenset({"M04", "M08", "M11", "M13", "M15", "M20", "M21", "M25a", "M25b"})


@functools.lru_cache(maxsize=None)
def resolver(mid: str):
    m = json.loads((_PORTABLE / f"{mid}.json").read_text())
    return {
        "portable": m,
        "linear": mid in _LINEAR_IDS,
        "labels": m["labels"],
        "features": m["feature_names"],   # original context-key order (for _bucket)
        "classes": m["classes"],
    }


_pp_cache: dict = {}


def _bucket(ctx: dict, feats: list[str]) -> tuple:
    key = []
    for f in feats:
        v = ctx.get(f)
        if f in ("ydstogo", "air_yards"):
            key.append(round(float(v) / 2) * 2 if v is not None else None)
        elif f in ("yardline_100", "kick_distance"):
            key.append(round(float(v) / 3) * 3 if v is not None else None)
        elif f in ("game_seconds_remaining", "half_seconds_remaining"):
            key.append(round(float(v) / 120) * 120 if v is not None else None)
        elif f in ("score_differential", "env_temp", "env_wind"):
            key.append(round(float(v) / 4) * 4 if v is not None else None)
        else:
            key.append(v)
    return tuple(key)


def predict_proba(mid: str, ctx: dict, logit_shift: dict[str, float] | None = None) -> dict[str, float]:
    r = resolver(mid)
    ck = (mid, _bucket(ctx, r["features"]))
    base = _pp_cache.get(ck)
    if base is None:
        ev = predict_proba_linear if r["linear"] else predict_proba_portable
        pp = ev(r["portable"], ctx)
        base = {lab: float(pp[lab]) for lab in r["labels"]}
        _pp_cache[ck] = base
    if not logit_shift:
        return base
    return _apply_shift(base, logit_shift)


def _apply_shift(probs: dict[str, float], shift: dict[str, float]) -> dict[str, float]:
    """Add per-class shifts in logit space and re-softmax (spec §12)."""
    labels = list(probs)
    lg = {l: np.log(max(probs[l], 1e-9)) + float(shift.get(l, 0.0)) for l in labels}
    mx = max(lg.values())
    ex = {l: np.exp(lg[l] - mx) for l in labels}
    s = sum(ex.values())
    return {l: ex[l] / s for l in labels}


def sample_class(mid: str, ctx: dict, rng: np.random.Generator,
                 logit_shift: dict[str, float] | None = None) -> str:
    probs = predict_proba(mid, ctx, logit_shift)
    labels = list(probs)
    return str(rng.choice(labels, p=_norm([probs[l] for l in labels])))


def _norm(x):
    a = np.asarray(x, float)
    a = np.clip(a, 1e-9, None)
    return a / a.sum()


# ---- empirical PMF / lookup tables (portable JSON, analysis/28_export_distributions.py) --
# Each leaf is {"v": [int, ...], "cum": [float, ...]}; sampling is one searchsorted.

_PDIST = _DIST / "portable"


@functools.lru_cache(maxsize=None)
def _table(name: str) -> dict:
    return json.loads((_PDIST / f"{name}.json").read_text())


def _draw(leaf: dict, r: float) -> int:
    return int(leaf["v"][np.searchsorted(leaf["cum"], r)])


def sample_exact_yards(stem: str, category: str, bucket: str, rng: np.random.Generator) -> int:
    t = _table(f"{stem}_exact")
    leaf = t["by_cb"].get(category, {}).get(bucket) or t["glob"][category]
    return _draw(leaf, rng.random())


def sample_air_yards(cat: str, down: int, yardline_100: float, rng: np.random.Generator) -> int:
    fp = "opp_rz" if yardline_100 <= 20 else "opp_mid" if yardline_100 <= 50 else "own_half"
    t = _table("air_yards")
    leaf = t["by"].get(cat, {}).get(str(int(down)), {}).get(fp) or t["glob"][cat]
    return _draw(leaf, rng.random())


def sample_runoff(bucket: str, no_huddle: int, clock_state: str, rng: np.random.Generator) -> int:
    by = _table("clock_runoff")["by"]
    leaf = by.get(bucket, {}).get(str(int(no_huddle)), {}).get(clock_state) \
        or by.get(bucket, {}).get("0", {}).get("normal")
    return _draw(leaf, rng.random()) if leaf else 35


def sample_punt_distance(yardline_100: float, rng: np.random.Generator) -> int:
    d = _table("punt")["dist"]
    fp = int(yardline_100 // 10 * 10)
    key = str(fp) if str(fp) in d else min(d, key=lambda k: abs(int(k) - fp))
    return _draw(d[key], rng.random())


def sample_punt_return(rng: np.random.Generator) -> int:
    return _draw(_table("punt")["ret"], rng.random())


# ---- penalty enforcement (Model 25c) ----------------------------------

def sample_penalty_bucket(hazard: str, play_family: str, rng: np.random.Generator) -> dict:
    """Return the M25c enforcement row (share/off_share/mean_yards/p_auto_first/…)
    for a fired penalty of this hazard class + play family."""
    by = _table("penalty")["by"]
    fam_tbl = by.get(hazard, {}).get(play_family) \
        or by[hazard]["ALL" if hazard == "deadball" else "dropback"]
    i = int(np.searchsorted(fam_tbl["cum"], rng.random()))
    return fam_tbl["meta"][fam_tbl["buckets"][i]]


def sample_dpi_yards(fp_band: str, rng: np.random.Generator) -> int:
    dpi = _table("penalty")["dpi"]
    return _draw(dpi.get(fp_band) or next(iter(dpi.values())), rng.random())
