"""Phase E — §13.6 joint-calibration harness for the rating layer.

The step-2 βᵢ (22_rating_calibration.py) are anchored so each channel's
*per-play* p10↔p90 spread matches the historical residual budget — the §23
`designed_magnitude` check confirms all 11 families land at 0.99–1.0×. §13.6
adds the *simulation-level* targets those per-play anchors don't constrain:
turning the (centred, §12) layer on should hold league points ≈flat and *widen*
score-margin variance (good teams beat bad teams by more). This script measures
those emergent effects deterministically and, if a real bias shows, provides
the loss ingredients to tune βᵢ against it.

`diagnose(n)`  — decompose the paired ON-vs-OFF points delta by channel
                 (mask each `*_shift` fn in turn). Tells us whether any single
                 channel drives a points bias.
`converge(sizes)` — the headline: paired ON-vs-OFF layer impact at growing n,
                 with a proper *paired* SE on the points delta, so "−0.7
                 pts/team-game" can be called real or small-sample noise.
`curvature_probe(n)` — for each logit channel, the outcome-space mean the
                 real-matchup shift distribution produces vs the base rate
                 (a Jensen check). Diagnostic only — NOT applied.

Findings (wide-window βᵢ, 2026-09-09): the layer is emergently sound. Margin sd
*widens* (12.3 vs 11.5 at n=320) — the §12 direction. Points delta converges to
≈ −0.8 ± 0.4 pts/team-game (z≈1.9, ~−4%): small, borderline, and diffuse —
`diagnose` shows no single channel carries it and it is not a logit-curvature
artifact. Too weak an effect to tune βᵢ against without overfitting, so no
coefficient change is applied. Revisit if A1 season sims show a compounding
wins/points bias. The material scoring gap stays the §22 −12% (rating-layer
*off* — a drive-model problem, out of §13.6 scope).

NOTE: run §23 / this script with a fixed PYTHONHASHSEED — 24_..._validation's
`league()` seeds games from a string hash; unpinned it drifts run-to-run.

Run:
    analysis/.venv/Scripts/python analysis/26_joint_calibration.py converge
    analysis/.venv/Scripts/python analysis/26_joint_calibration.py diagnose [n_pairs]
    analysis/.venv/Scripts/python analysis/26_joint_calibration.py probe [n_matchups]
    analysis/.venv/Scripts/python analysis/26_joint_calibration.py all
"""

from __future__ import annotations

import lib_py  # thread-env; MUST precede numpy

import json
import sys
from datetime import date

import numpy as np

from engine.roster import roster, team_list
from engine.sim import Game
from lib_py.report import ARTIFACTS

# league base outcome rates for the logit channels (empirical, 2023–25; the
# same numbers 24_rating_layer_validation._FAM_BASE / sim.py calib use).
BASE_RATE = {
    "M09_COMPLETE": 0.647,
    "M09_INTERCEPTION": 0.023,
    "M04_SACK": 0.066,
    "M20_MADE": 0.852,
}

# the ratings.py fn that produces each channel's raw (pre-curvature) log-odds shift
CHANNELS = ["M09_COMPLETE", "M09_INTERCEPTION", "M04_SACK", "M20_MADE"]

_SHIFT_FNS = ["completion_logit_shift", "interception_logit_shift", "sack_logit_shift",
              "rush_yards_shift", "yac_yards_shift", "fg_logit_shift"]


def _sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def _logit(p):
    return float(np.log(p / (1.0 - p)))


# --------------------------------------------------------------- diagnosis

def _paired_impact(n_pairs: int, active: str | None, seed_base: int = 20_000) -> dict:
    """Paired ON (only `active` shift fn live, rest forced to 0) vs OFF, over
    random real matchups on common seeds. `active=None` -> every channel live
    (reproduces §23 layer_impact); `active="__none__"` -> all channels masked
    (sanity: should give points_delta ≈ 0)."""
    import engine.ratings as R

    orig = {name: getattr(R, name) for name in _SHIFT_FNS}
    keep = set() if active in (None,) else ({active} if active != "__none__" else set())
    try:
        for name in _SHIFT_FNS:
            if active is None or name in keep:
                continue
            setattr(R, name, (lambda *a, **k: 0.0))
        R._offsets.cache_clear()

        teams = team_list()
        rng = np.random.default_rng(11)
        pairs = [(teams[i], teams[j]) for i in range(len(teams)) for j in range(len(teams)) if i != j]
        rng.shuffle(pairs)
        pairs = pairs[:n_pairs]
        on_pts, off_pts, on_marg, off_marg, pair_dp = [], [], [], [], []
        for idx, (h, a) in enumerate(pairs):
            seed = seed_base + idx
            gon = Game(rng=np.random.default_rng(seed), rosters=[roster(h), roster(a)]).run()
            goff = Game(rng=np.random.default_rng(seed), rosters=None).run()
            on_pts += list(gon.score); off_pts += list(goff.score)
            on_marg.append(gon.score[0] - gon.score[1]); off_marg.append(goff.score[0] - goff.score[1])
            pair_dp.append((gon.score[0] + gon.score[1] - goff.score[0] - goff.score[1]) / 2.0)
        on_pts, off_pts = np.array(on_pts), np.array(off_pts)
        pair_dp = np.array(pair_dp)
        return {
            "points_on": float(on_pts.mean()), "points_off": float(off_pts.mean()),
            "points_delta": float(on_pts.mean() - off_pts.mean()),
            "points_delta_paired_se": float(pair_dp.std(ddof=1) / np.sqrt(pair_dp.size)),
            "margin_sd_on": float(np.std(on_marg)), "margin_sd_off": float(np.std(off_marg)),
        }
    finally:
        for name, fn in orig.items():
            setattr(R, name, fn)
        R._offsets.cache_clear()


def converge(sizes=(100, 200, 320)) -> dict:
    """The headline §13.6 measurement: full ON-vs-OFF layer impact at growing n
    with a proper *paired* SE on the points delta, so a small bias can be called
    real or small-sample noise. Deterministic (fixed seeds, no `hash()`)."""
    print("converge: full rating layer ON vs OFF, paired, growing n\n")
    out = {}
    for n in sizes:
        r = _paired_impact(n, active=None)
        se = r["points_delta_paired_se"]
        out[n] = r
        print(f"  n={n:4d}  Δpts {r['points_delta']:+6.3f} ± {se:.3f}  "
              f"(z={r['points_delta']/se:+.2f})   "
              f"margin sd on/off {r['margin_sd_on']:5.2f}/{r['margin_sd_off']:5.2f} "
              f"(Δ{r['margin_sd_on']-r['margin_sd_off']:+.2f})")
    return out


def diagnose(n_pairs: int = 60) -> dict:
    print(f"diagnose: paired ON-vs-OFF points delta by channel, {n_pairs} pairs\n")
    rows = {}
    for active in ["__none__", "completion_logit_shift", "interception_logit_shift",
                   "sack_logit_shift", "rush_yards_shift", "yac_yards_shift",
                   "fg_logit_shift", None]:
        label = {"__none__": "(all masked)", None: "(all live)"}.get(active, active)
        r = _paired_impact(n_pairs, active)
        rows[label] = r
        print(f"  {label:26s}  Δpts {r['points_delta']:+6.3f}   "
              f"margin sd on/off {r['margin_sd_on']:5.2f}/{r['margin_sd_off']:5.2f}")
    return rows


# --------------------------------------------------------------- curvature probe

def _sample_raw_shifts(n_matchups: int) -> dict:
    """Collect the raw per-play log-odds shift each logit channel produces over a
    representative slice of real matchups + game states. Uses the actual engine
    lineup selection (nickel on 3rd-and-long, etc.)."""
    import engine.ratings as R

    R._offsets.cache_clear()
    teams = team_list()
    rng = np.random.default_rng(101)
    pairs = [(teams[i], teams[j]) for i in range(len(teams)) for j in range(len(teams)) if i != j]
    rng.shuffle(pairs)
    pairs = pairs[:n_matchups]
    acc = {c: [] for c in CHANNELS}
    for h, a in pairs:
        o = roster(h).offense()
        for nickel in (False, True):  # ~ base vs 3rd-and-long personnel
            d = roster(a).defense(nickel=nickel)
            catchers = [o["WR1"], o["WR2"], o["WR3"], o["TE1"]]
            dbs = [d["CB1"], d["CB2"], d["S1"], d["S2"]] + ([d["CB3"]] if "CB3" in d else [])
            ol = [o["LT"], o["LG"], o["C"], o["RG"], o["RT"]]
            rush = [d["EDGE1"], d["EDGE2"], d["DT1"], d["DT2"]]
            acc["M09_COMPLETE"].append(R.completion_logit_shift(catchers, dbs, o["QB1"]))
            acc["M09_INTERCEPTION"].append(R.interception_logit_shift(o["QB1"]))
            acc["M04_SACK"].append(R.sack_logit_shift(ol, rush))
        acc["M20_MADE"].append(R.fg_logit_shift(roster(h).kicker()))
    return {c: np.asarray(v, float) for c, v in acc.items()}


def curvature_probe(n_matchups: int = 400) -> dict:
    """Jensen check (diagnostic only): for each logit channel, the outcome-space
    mean the real-matchup shift distribution produces vs the base rate. A large
    gap would say log-odds centring (§12) leaves an outcome-mean drift; `k` is
    the constant that would null it. `diagnose()` shows the residual points cost
    is diffuse, not single-channel curvature, so this is NOT applied."""
    raw = _sample_raw_shifts(n_matchups)
    out = {}
    for c in CHANNELS:
        p0 = BASE_RATE[c]
        l0 = _logit(p0)
        s = raw[c]
        lo, hi = -0.5, 0.5  # mean σ(l0 + s − k) is monotone decreasing in k
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            if _sig(l0 + s - mid).mean() > p0:
                lo = mid
            else:
                hi = mid
        k = 0.5 * (lo + hi)
        pre = float(_sig(l0 + s).mean())
        out[c] = {
            "base_rate": p0, "raw_shift_mean": float(s.mean()), "raw_shift_sd": float(s.std()),
            "outcome_mean_pre": pre, "outcome_mean_gap_pp": round((pre - p0) * 100, 3),
            "curvature_logit_offset_would_be": float(k), "n": int(s.size),
        }
        print(f"  {c:18s}  p0={p0:.3f}  rawμ={s.mean():+.4f}  "
              f"outcome μ={pre:.4f} (gap {(pre - p0) * 100:+.2f}pp)  k*={k:+.4f}")
    return out


def _write_probe(conv: dict, diag: dict | None, curv: dict | None) -> None:
    payload = {
        "generated": date.today().isoformat(),
        "note": "§13.6 harness output. Deterministic (fixed seeds). No coefficient change "
                "is applied — see 26_joint_calibration.py docstring.",
        "converge": {str(k): v for k, v in conv.items()},
    }
    if diag is not None:
        payload["diagnose_by_channel"] = diag
    if curv is not None:
        payload["curvature_probe"] = curv
    p = ARTIFACTS / "validation" / "joint_calibration_probe.json"
    p.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"\nwrote {p.relative_to(ARTIFACTS.parent)}")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    conv = diag = curv = None
    if cmd in ("converge", "all"):
        conv = converge()
    if cmd in ("diagnose", "all"):
        n = int(sys.argv[2]) if len(sys.argv) > 2 and cmd == "diagnose" else 60
        print()
        diag = diagnose(n)
    if cmd in ("probe", "all"):
        n = int(sys.argv[2]) if len(sys.argv) > 2 and cmd == "probe" else 400
        print("\ncurvature probe (diagnostic, not applied):\n")
        curv = curvature_probe(n)
    if cmd == "all":
        _write_probe(conv, diag, curv)


if __name__ == "__main__":
    main()
