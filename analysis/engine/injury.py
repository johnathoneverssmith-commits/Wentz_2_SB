"""In-game injuries (franchise flavour, opt-in) — Python mirror of
``src/engine/injury.ts``.

When enabled the game loop rolls a small per-scrimmage-play hazard; on a hit
this picks a plausibly-involved player, a body part weighted by position, an
injury type + severity → a projected return window, and a mechanism from the
play. Produces a structured event plus a broadcast sentence. Deterministic in
the game RNG; off in every validation / parity path.
"""

from __future__ import annotations

INJURY_PER_PLAY = 0.0085

_BODY_TYPES: dict[str, list[dict]] = {
    "ankle": [
        {"type": "ankle sprain", "sev": "minor", "wk": (0, 1), "w": 34},
        {"type": "high-ankle sprain", "sev": "moderate", "wk": (3, 6), "w": 12},
        {"type": "ankle fracture", "sev": "significant", "wk": (6, 10), "w": 4},
    ],
    "knee": [
        {"type": "knee sprain", "sev": "minor", "wk": (1, 2), "w": 24},
        {"type": "MCL sprain", "sev": "moderate", "wk": (3, 6), "w": 12},
        {"type": "meniscus tear", "sev": "significant", "wk": (4, 8), "w": 6},
        {"type": "PCL sprain", "sev": "moderate", "wk": (4, 8), "w": 3},
        {"type": "ACL tear", "sev": "season", "wk": (40, 52), "w": 2},
    ],
    "hamstring": [
        {"type": "hamstring strain", "sev": "minor", "wk": (1, 2), "w": 30},
        {"type": "grade-2 hamstring strain", "sev": "moderate", "wk": (3, 5), "w": 10},
    ],
    "groin": [
        {"type": "groin strain", "sev": "minor", "wk": (1, 3), "w": 26},
        {"type": "adductor tear", "sev": "moderate", "wk": (4, 7), "w": 5},
    ],
    "shoulder": [
        {"type": "AC joint sprain", "sev": "minor", "wk": (1, 3), "w": 24},
        {"type": "shoulder subluxation", "sev": "moderate", "wk": (2, 5), "w": 8},
        {"type": "labrum tear", "sev": "significant", "wk": (5, 10), "w": 4},
    ],
    "concussion": [{"type": "concussion", "sev": "moderate", "wk": (1, 3), "w": 40}],
    "hand": [
        {"type": "hand sprain", "sev": "minor", "wk": (0, 1), "w": 26},
        {"type": "hand fracture", "sev": "moderate", "wk": (3, 6), "w": 8},
    ],
    "ribs": [
        {"type": "rib contusion", "sev": "minor", "wk": (1, 2), "w": 28},
        {"type": "rib fracture", "sev": "moderate", "wk": (2, 5), "w": 8},
    ],
    "foot": [
        {"type": "foot sprain", "sev": "minor", "wk": (1, 3), "w": 22},
        {"type": "turf toe", "sev": "moderate", "wk": (2, 6), "w": 6},
        {"type": "Lisfranc injury", "sev": "significant", "wk": (8, 14), "w": 2},
        {"type": "foot fracture", "sev": "significant", "wk": (6, 10), "w": 3},
    ],
    "back": [
        {"type": "back spasms", "sev": "minor", "wk": (0, 1), "w": 26},
        {"type": "back strain", "sev": "moderate", "wk": (2, 4), "w": 8},
    ],
    "calf": [{"type": "calf strain", "sev": "minor", "wk": (1, 3), "w": 20}],
    "quad": [{"type": "quad contusion", "sev": "minor", "wk": (0, 2), "w": 20}],
    "biceps": [
        {"type": "biceps strain", "sev": "minor", "wk": (1, 3), "w": 14},
        {"type": "biceps tear", "sev": "severe", "wk": (16, 26), "w": 1},
    ],
    "elbow": [{"type": "elbow hyperextension", "sev": "minor", "wk": (1, 3), "w": 14}],
}

_POS_GROUP = {
    "QB": "QB", "RB": "SKILL", "FB": "SKILL", "WR": "SKILL", "TE": "SKILL",
    "OT": "OL", "OG": "OL", "C": "OL", "EDGE": "DL", "DT": "DL",
    "ILB": "LB", "OLB": "LB", "LB": "LB", "CB": "DB", "S": "DB",
    "K": "SPEC", "P": "SPEC", "LS": "SPEC",
}
_GROUP_BODY = {
    "QB": [("shoulder", 22), ("hand", 20), ("knee", 16), ("ankle", 14), ("ribs", 12), ("concussion", 10), ("back", 6)],
    "SKILL": [("hamstring", 22), ("ankle", 20), ("knee", 18), ("foot", 10), ("shoulder", 10), ("concussion", 8), ("groin", 8), ("ribs", 4)],
    "OL": [("knee", 22), ("ankle", 20), ("back", 14), ("shoulder", 12), ("foot", 12), ("biceps", 8), ("elbow", 6), ("concussion", 6)],
    "DL": [("knee", 20), ("ankle", 18), ("shoulder", 14), ("foot", 12), ("hand", 10), ("biceps", 10), ("elbow", 8), ("concussion", 8)],
    "LB": [("knee", 20), ("ankle", 18), ("hamstring", 16), ("shoulder", 14), ("concussion", 12), ("foot", 10), ("ribs", 10)],
    "DB": [("hamstring", 24), ("ankle", 18), ("knee", 16), ("shoulder", 12), ("concussion", 12), ("groin", 10), ("foot", 8)],
    "SPEC": [("groin", 30), ("quad", 24), ("back", 24), ("knee", 12), ("calf", 10)],
}

_LOWER = {"ankle", "knee", "hamstring", "foot", "calf", "quad", "groin"}
_MECH = {
    "lower": {
        "contact": ["rolled under a defender's knee", "got bent awkwardly at the bottom of the pile",
                    "was rolled up on from behind", "got caught under a tackler and twisted",
                    "gave out as he was driven into the turf", "took the brunt of a low hit"],
        "noncontact": ["buckled changing direction with no one around", "gave out on the cut",
                       "locked up as he planted", "went out from under him untouched",
                       "tightened up and forced him off the field"],
    },
    "upper": {
        "contact": ["took the force of a hard landing", "got bent back on contact",
                    "absorbed a direct shot", "was wrenched in a pile-up", "jammed into the turf"],
        "noncontact": ["flared up in visible discomfort", "stiffened up on the sideline",
                       "aggravated on a routine play"],
    },
}
_HEAD_CONTACT = ["took a helmet-to-helmet hit", "was slow to get up after a collision",
                 "had his head snap back on a hit", "absorbed a blindside shot"]
_HEAD_NONCONTACT = ["reported concussion symptoms to the training staff"]
_ROUTE = {
    "BEHIND_LOS": ["screen", "checkdown", "swing route"],
    "SHORT": ["slant", "out route", "hitch", "drag"],
    "INTERMEDIATE": ["dig", "post", "comeback", "curl"],
    "DEEP": ["go route", "deep post", "seam"],
}


def _pick(rng, rows: list[tuple[float, object]]):
    total = sum(w for w, _ in rows)
    r = rng.random() * total
    for w, item in rows:
        r -= w
        if r <= 0:
            return item
    return rows[-1][1]


def _article(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


def _play_phrase(ctx: dict, on_offense: bool, slot: str) -> str:
    yд = max(0, round(ctx["gained"]))
    is_run = ctx["call"] == "run" or ctx["outcome"] in ("run", "scramble")
    on_line = slot in ("LT", "LG", "C", "RG", "RT")
    if on_offense:
        if on_line:
            return "blocking on a run" if is_run else "in pass protection"
        if slot == "QB1":
            if ctx["outcome"] == "sack":
                return "being sacked"
            if ctx["outcome"] == "interception":
                return "throwing a pass that was picked off"
            return "scrambling out of the pocket" if is_run else "in the pocket"
        if is_run:
            d = "run to the outside" if yд >= 8 else "run up the middle"
            return f"on a {d}" if yд <= 0 else f"on a {yд}-yard {d}"
        if ctx["outcome"] == "incomplete":
            return "reaching for an incompletion"
        if ctx["outcome"] == "interception":
            return "on a pass that was intercepted"
        route = _ROUTE.get(ctx["depth"], ["route"])[0]
        return f"catching a {route}" if yд <= 0 else f"completing a {yд}-yard {route}"
    dl = slot.startswith(("EDGE", "DT"))
    lb = slot.startswith("ILB")
    if is_run:
        return ("taking on a block against the run" if dl else
                "filling a gap against the run" if lb else "coming up to make a tackle")
    if ctx["outcome"] == "sack" or dl:
        return "rushing the passer"
    if lb:
        return "dropping into coverage"
    return "defending a deep ball" if ctx["depth"] == "DEEP" else "breaking on a throw"


def make_injury(rng, ctx: dict) -> dict | None:
    """`ctx` keys: offense_team, defense_team, quarter, clock, call, outcome,
    gained, depth, offense[{slot,player}], defense[{slot,player}]."""
    on_offense = rng.random() < 0.52
    pool = ctx["offense"] if on_offense else ctx["defense"]
    cands = [c for c in pool if c["player"]]
    if not cands:
        return None

    def slot_w(slot: str) -> float:
        if on_offense:
            if slot in ("LT", "LG", "C", "RG", "RT"):
                return 3.0
            if slot == "RB1":
                return 4.0 if ctx["call"] == "run" else 1.4
            if slot.startswith(("WR", "TE")):
                return 1.0 if ctx["call"] == "run" else 2.4
            if slot == "QB1":
                return 3.0 if ctx["outcome"] == "sack" else 0.8
            return 1.0
        if slot.startswith(("EDGE", "DT")):
            return 2.6 if ctx["call"] == "run" else 2.2
        if slot.startswith("ILB"):
            return 2.4
        if slot.startswith(("CB", "S")):
            return 1.4 if ctx["call"] == "run" else 2.4
        return 1.0

    chosen = _pick(rng, [(slot_w(c["slot"]), c) for c in cands])
    p = chosen["player"]
    group = _POS_GROUP.get(p["position"], "SKILL")
    body = _pick(rng, [(w, bp) for bp, w in _GROUP_BODY.get(group, _GROUP_BODY["SKILL"])])
    trow = _pick(rng, [(t["w"], t) for t in _BODY_TYPES.get(body, _BODY_TYPES["knee"])])

    region = "head" if body == "concussion" else "lower" if body in _LOWER else "upper"
    base = 0.85 if (ctx["call"] == "run" or ctx["outcome"] == "sack") else 0.85 if region == "head" else 0.6
    contact = rng.random() < base
    if region == "head":
        opts = _HEAD_CONTACT if contact else _HEAD_NONCONTACT
    else:
        opts = _MECH[region]["contact"] if contact else _MECH[region]["noncontact"]
    mechanism = _pick(rng, [(1.0, m) for m in opts])
    on_play = _play_phrase(ctx, on_offense, chosen["slot"])

    lo, hi = trow["wk"]
    if region == "head":
        feared = "He is in the concussion protocol"
    elif trow["sev"] == "minor":
        feared = f"Believed to be a minor {trow['type']}"
    elif trow["sev"] == "season":
        feared = "Feared to be a torn ACL — likely done for the year"
    else:
        feared = f"Exact injury unknown, but feared to be {_article(trow['type'])} {trow['type']}"
    if trow["sev"] == "season":
        proj = "Expected to miss the rest of the season"
    elif hi <= 1:
        proj = "Considered day-to-day"
    else:
        proj = f"Projected {1 if lo <= 1 else lo}–{hi} weeks"

    if region == "head":
        narrative = f"{p['name']} {mechanism} while {on_play} and went to the medical tent. {feared}. {proj}."
    else:
        narrative = f"{p['name']}'s {body} {mechanism} while {on_play}. {feared}. {proj}."

    return {
        "team": ctx["offense_team"] if on_offense else ctx["defense_team"],
        "player_id": p["id"],
        "player": p["name"],
        "position": p["position"],
        "slot": chosen["slot"],
        "quarter": ctx["quarter"],
        "clock": ctx["clock"],
        "body_part": body,
        "suspected_type": trow["type"],
        "severity": trow["sev"],
        "projected_weeks": (18 if lo > 20 else lo, 18 if hi > 20 else hi),
        "mechanism": mechanism,
        "on_play": on_play,
        "narrative": narrative,
    }
