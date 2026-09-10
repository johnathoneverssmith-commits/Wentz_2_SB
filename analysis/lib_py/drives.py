"""Shared drive-level summary (V1.6 points-gap work).

ONE definition of the drive table, called by both the empirical extractor
(`29_drive_baseline.py`) and the engine's §22 validation
(`23_full_sim_validation.py`). The prior points-gap diagnostics were derailed by
definition mismatches between the two sides (3rd-down conversion, RZ TD rate,
"never crossed midfield") — this module exists so that can't happen again.

A *record* is a dict: ``{"start_yl": float, "result": <canonical key>}`` plus
optional ``"plays"`` and ``"crossed_mid"``. `start_yl` is `yardline_100` at the
first snap of the drive (100 = the offense's own goal line, 0 = the opponent's).
"""

from __future__ import annotations

import numpy as np

# canonical drive-result keys → points credited to the drive's offense.
# Flat values (TD = 7, not 6/7/8) so the two sides are byte-comparable.
PTS_BY_RESULT: dict[str, float] = {
    "touchdown": 7.0,
    "field_goal": 3.0,
    "punt": 0.0,
    "downs": 0.0,          # turnover on downs
    "turnover": 0.0,       # interception or lost fumble (no return TD)
    "missed_fg": 0.0,
    "end_of_half": 0.0,
    "opp_touchdown": -7.0,  # turnover returned for a TD
    "safety": -2.0,
}

# nflverse `fixed_drive_result` → canonical
NFLVERSE_RESULT: dict[str, str] = {
    "Touchdown": "touchdown",
    "Field goal": "field_goal",
    "Punt": "punt",
    "Turnover": "turnover",
    "Turnover on downs": "downs",
    "Missed field goal": "missed_fg",
    "End of half": "end_of_half",
    "Opp touchdown": "opp_touchdown",
    "Safety": "safety",
}

# engine `Game.drives_log` result → canonical (INT / fumble collapse to turnover,
# matching nflverse's single "Turnover" bucket)
ENGINE_RESULT: dict[str, str] = {
    "touchdown": "touchdown",
    "field_goal": "field_goal",
    "punt": "punt",
    "interception": "turnover",
    "fumble": "turnover",
    "downs": "downs",
    "missed_fg": "missed_fg",
    "end_of_half": "end_of_half",
    "opp_touchdown": "opp_touchdown",
    "safety": "safety",
}

# (lo, hi) inclusive yardline_100 bands, own-goal-line distance
FP_BANDS: list[tuple[int, int]] = [
    (0, 9), (10, 19), (20, 29), (30, 39), (40, 49),
    (50, 59), (60, 69), (70, 79), (80, 89), (90, 99),
]

OUTCOME_ORDER = ["touchdown", "field_goal", "punt", "turnover", "downs",
                 "missed_fg", "end_of_half", "opp_touchdown", "safety"]


def _band_index(yl: float) -> int:
    return min(int(yl) // 10, len(FP_BANDS) - 1)


def drive_table(records: list[dict], *, min_plays: int = 1) -> dict:
    """Summarise a list of drive records into the comparison table.

    `min_plays` drops drives with fewer than N snaps — use 1 to keep everything,
    or 1 on the engine side to drop the 0-play phantom drives an OT score can
    leave behind (empirical has none).
    """
    recs = [r for r in records if r.get("plays", 1) >= min_plays]
    n = len(recs)
    if n == 0:
        return {"n": 0}

    start = np.array([r["start_yl"] for r in recs], float)
    canon = [r["result"] for r in recs]
    pts = np.array([PTS_BY_RESULT.get(c, 0.0) for c in canon], float)
    bands = np.array([_band_index(y) for y in start])

    mix = {k: round(float(np.mean([c == k for c in canon])), 4) for k in OUTCOME_ORDER}

    crossed = [r["crossed_mid"] for r in recs if "crossed_mid" in r]
    never_crossed = round(1.0 - float(np.mean(crossed)), 4) if crossed else None

    plays_arr = np.array([r["plays"] for r in recs if "plays" in r], float)
    fd_arr = np.array([r["first_downs"] for r in recs if "first_downs" in r], float)
    plays_per_drive = round(float(plays_arr.mean()), 3) if plays_arr.size else None
    fd_per_drive = round(float(fd_arr.mean()), 3) if fd_arr.size else None
    # 3-and-out: a punt/downs/turnover drive that gained no first down
    three_and_out = None
    if fd_arr.size:
        empty = np.array([r["first_downs"] == 0 and r["result"] in
                          ("punt", "downs", "turnover", "missed_fg")
                          for r in recs if "first_downs" in r])
        three_and_out = round(float(empty.mean()), 4)

    fp_rows = []
    for bi, (lo, hi) in enumerate(FP_BANDS):
        m = bands == bi
        cnt = int(m.sum())
        if not cnt:
            fp_rows.append({"band": f"{lo}-{hi}", "n": 0, "share": 0.0,
                            "ppd": None, "td_rate": None})
            continue
        idx = np.where(m)[0]
        td = float(np.mean([canon[i] == "touchdown" for i in idx]))
        fds = [recs[i]["first_downs"] for i in idx if "first_downs" in recs[i]]
        fp_rows.append({
            "band": f"{lo}-{hi}",
            "n": cnt,
            "share": round(cnt / n, 4),
            "ppd": round(float(pts[m].mean()), 4),
            "td_rate": round(td, 4),
            "plays": round(float(np.mean([recs[i].get("plays", np.nan) for i in idx])), 3),
            "fd_per_drive": round(float(np.mean(fds)), 3) if fds else None,
        })

    return {
        "n": n,
        "points_per_drive": round(float(pts.mean()), 4),
        "never_crossed_mid": never_crossed,
        "plays_per_drive": plays_per_drive,
        "first_downs_per_drive": fd_per_drive,
        "three_and_out_rate": three_and_out,
        "start_yl": {
            "mean": round(float(start.mean()), 2),
            "p10": round(float(np.percentile(start, 10)), 1),
            "p25": round(float(np.percentile(start, 25)), 1),
            "median": round(float(np.median(start)), 1),
            "p75": round(float(np.percentile(start, 75)), 1),
            "p90": round(float(np.percentile(start, 90)), 1),
        },
        "outcome_mix": mix,
        "fp_bands": fp_rows,
    }


def records_from_nflverse(drives_df) -> list[dict]:
    """`drives_df` has columns start_yl, result (raw nflverse string), plays,
    crossed_mid. Returns canonical records, dropping unmapped results."""
    out = []
    for row in drives_df.iter_rows(named=True):
        c = NFLVERSE_RESULT.get(row["result"])
        if c is None:
            continue
        rec = {"start_yl": float(row["start_yl"]), "result": c}
        if row.get("plays") is not None:
            rec["plays"] = int(row["plays"])
        if row.get("crossed_mid") is not None:
            rec["crossed_mid"] = bool(row["crossed_mid"])
        if row.get("first_downs") is not None:
            rec["first_downs"] = int(row["first_downs"])
        out.append(rec)
    return out


def records_from_engine(drives_log: list[dict]) -> list[dict]:
    """`Game.drives_log` entries → canonical records."""
    out = []
    for d in drives_log:
        c = ENGINE_RESULT.get(d["result"], d["result"])
        rec = {"start_yl": float(d["start_yl"]), "result": c,
               "plays": int(d["plays"]), "crossed_mid": bool(d["crossed_mid"])}
        if "first_downs" in d:
            rec["first_downs"] = int(d["first_downs"])
        out.append(rec)
    return out
