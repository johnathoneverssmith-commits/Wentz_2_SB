#!/usr/bin/env python3
"""COMP-006 analysis: paired skilled-vs-control effects with cluster-robust uncertainty.

Usage: python3 analyze.py <results_dir> [--arm skilled] [--out report_tables.md] [--json tables.json]

Unit of pairing: (talent, seed, seat team, season index). The treated run and the control run share the same
starting league, schedule, CPU GM line-up and seat teams; after the first decision the random streams diverge,
so a paired difference is "same team, same league, different GM", not "same dice".
Uncertainty: seasons of one team and the four seats of one league are not independent, so the 95% interval is
(a) a percentile bootstrap that resamples whole LEAGUES (seeds) - the headline - and
(b) a t-interval on per-league mean differences. A team-clustered bootstrap is reported beside it as a sanity check.
Only numpy is required.
"""
import argparse, glob, json, os, sys
import numpy as np

ROUND = {"none": 0, "WC": 1, "DIV": 2, "CONF": 3, "SB": 4}
T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
        11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086}

OUTCOMES = {
    # name: (getter(team_row) -> float, group, label)
    "wins": (lambda r: r["w"] + 0.5 * r["t"], "results", "regular-season wins"),
    "playoffs": (lambda r: float(r["playoffs"]), "results", "made playoffs"),
    "po_depth": (lambda r: float(ROUND[r["round"]]), "results", "playoff depth (0 none .. 4 reached SB)"),
    "title": (lambda r: float(r["champion"]), "results", "won the Super Bowl"),
    "unit_start": (lambda r: r["start"]["unitScore"], "strength", "unit score, start of regular season"),
    "top24_start": (lambda r: r["start"]["top24"], "strength", "mean overall of top 24, start of season"),
    "team_ovr_start": (lambda r: r["start"]["overall"], "strength", "team rating, start of season"),
    "qb_start": (lambda r: r["start"]["qb"], "strength", "starting QB overall, start of season"),
    "unit_end": (lambda r: r["end"]["unitScore"], "strength", "unit score, at the playoffs"),
    "cap_space": (lambda r: r["end"]["capTotal"] - r["end"]["capUsed"], "cap", "cap space at the playoffs ($M)"),
    "dead_money": (lambda r: r["end"]["dead"], "cap", "dead money on the cap ($M)"),
    "next_commit_share": (lambda r: r["end"]["nextCommit"] / r["end"]["capTotal"], "cap", "next-year commitments / cap"),
    "age_top24": (lambda r: r["end"]["age"], "cap", "mean age of top 24"),
    "roster_n": (lambda r: float(r["end"]["rosterN"]), "cap", "players on roster at the playoffs"),
}


MAXS = 99   # --max-season: only seat-seasons with season index <= MAXS
DROP = set()  # --drop: "seed" or "seed:talent" matched leagues excluded


def dropped(seed, talent):
    return str(seed) in DROP or f"{seed}:{talent}" in DROP


def load(d):
    runs = {}
    for f in glob.glob(os.path.join(d, "*.json")):
        j = json.load(open(f))
        sp = j["spec"]
        tag = os.path.basename(f)
        if "tag" in sp:
            pass
        runs[(sp["arm"], sp["talent"], sp["seed"], tuple(sp.get("mods") or []))] = j
    return runs


def boot_ci(diffs_by_cluster, B=4000, seed=7):
    """percentile bootstrap over clusters; diffs_by_cluster: list of 1-D arrays."""
    rng = np.random.default_rng(seed)
    k = len(diffs_by_cluster)
    sums = np.array([a.sum() for a in diffs_by_cluster]); ns = np.array([len(a) for a in diffs_by_cluster], float)
    est = sums.sum() / ns.sum()
    idx = rng.integers(0, k, size=(B, k))
    bs = sums[idx].sum(1) / ns[idx].sum(1)
    return est, np.percentile(bs, 2.5), np.percentile(bs, 97.5)


def t_ci(cluster_means):
    m = np.asarray(cluster_means, float); n = len(m)
    if n < 2:
        return float(m.mean()), float("nan"), float("nan")
    se = m.std(ddof=1) / np.sqrt(n); t = T975.get(n - 1, 1.96)
    return float(m.mean()), float(m.mean() - t * se), float(m.mean() + t * se)


def paired(runs, arm, talent, mods=(), base="control"):
    """-> list of dict(seed, team, idx, ctl: row, trt: row) for uncensored seat-seasons."""
    out = []
    seeds = sorted({k[2] for k in runs if k[0] == arm and k[1] == talent and k[3] == tuple(mods)})
    for sd in seeds:
        if dropped(sd, talent):
            continue
        c = runs.get((base, talent, sd, ()))
        t = runs.get((arm, talent, sd, tuple(mods)))
        if not c or not t:
            continue
        seats = t["spec"]["seats"]
        cens = {x["team"]: x["censoredFrom"] for x in t["seats"]}
        # a seat-season is usable only if the same GM still ran the team in BOTH arms
        for x in c["seats"]:
            if x["censoredFrom"] is not None:
                cens[x["team"]] = min(cens.get(x["team"]) or 99, x["censoredFrom"])
        n = min(len(c["rows"]), len(t["rows"]), MAXS)
        for team in seats:
            for i in range(n):
                if cens.get(team) is not None and i + 1 >= cens[team]:
                    continue
                out.append(dict(seed=sd, team=team, idx=i + 1, ctl=c["rows"][i]["teams"][team], trt=t["rows"][i]["teams"][team]))
    return out


def effect(pairs, getter, sel=lambda p: True):
    sub = [p for p in pairs if sel(p)]
    if not sub:
        return None
    by_seed, by_team = {}, {}
    for p in sub:
        d = getter(p["trt"]) - getter(p["ctl"])
        by_seed.setdefault(p["seed"], []).append(d)
        by_team.setdefault((p["seed"], p["team"]), []).append(d)
    seed_arrs = [np.array(v) for v in by_seed.values()]
    est, lo, hi = boot_ci(seed_arrs)
    _, tlo, thi = t_ci([a.mean() for a in seed_arrs])
    _, blo, bhi = boot_ci([np.array(v) for v in by_team.values()])
    ctl = np.mean([getter(p["ctl"]) for p in sub]); trt = np.mean([getter(p["trt"]) for p in sub])
    return dict(n=len(sub), leagues=len(by_seed), ctl=float(ctl), trt=float(trt), diff=float(est), lo=float(lo), hi=float(hi),
                t_lo=float(tlo), t_hi=float(thi), team_lo=float(blo), team_hi=float(bhi))


def fmt(e, d=2):
    if e is None:
        return "n/a"
    return f"{e['diff']:+.{d}f} [{e['lo']:+.{d}f}, {e['hi']:+.{d}f}]"


def title_rates(runs, arm, talent, mods=(), base=None):
    """Titles per UNCENSORED seat-season (the same GM ran the team in both arms), by league, with a league bootstrap.
    base=None -> use only this arm's own censoring (for the arm's rate); base=<arm> -> also require base uncensored."""
    per, allfour = [], [0, 0]
    for sd in sorted({k[2] for k in runs if k[0] == arm and k[1] == talent and k[3] == tuple(mods)}):
        if dropped(sd, talent):
            continue
        t = runs[(arm, talent, sd, tuple(mods))]
        b = runs.get((base, talent, sd, ())) if base else None
        if base and not b:
            continue
        cens = {x["team"]: x["censoredFrom"] for x in t["seats"]}
        if b:
            for x in b["seats"]:
                if x["censoredFrom"] is not None:
                    cens[x["team"]] = min(cens.get(x["team"]) or 99, x["censoredFrom"])
        w = n = 0
        for i, r in enumerate(t["rows"][:MAXS], 1):
            live = [tm for tm in t["spec"]["seats"] if not (cens.get(tm) is not None and i >= cens[tm])]
            n += len(live); w += sum(r["champion"] == tm for tm in live)
            if len(live) == len(t["spec"]["seats"]):
                allfour[0] += r["champion"] in live; allfour[1] += 1
        per.append((w, n))
    if not per or sum(n for _, n in per) == 0:
        return None
    arrs = [np.array([1.0] * w + [0.0] * (n - w)) for w, n in per if n]
    est, lo, hi = boot_ci(arrs)
    return dict(rate=est, lo=lo, hi=hi, titles=sum(w for w, _ in per), seat_seasons=sum(n for _, n in per), leagues=len(per),
                all4_titles=allfour[0], all4_league_seasons=allfour[1])


def title_share(runs, arm, talent, mods=()):
    """Share of all league titles won by the seats, per league-season, with a league-bootstrap interval."""
    per_seed = []
    for sd in sorted({k[2] for k in runs if k[0] == arm and k[1] == talent and k[3] == tuple(mods)}):
        if dropped(sd, talent):
            continue
        t = runs[(arm, talent, sd, tuple(mods))]
        seats = set(t["spec"]["seats"]); won = 0; seasons = 0
        for r in t["rows"][:MAXS]:
            seasons += 1
            won += r["champion"] in seats
        per_seed.append((won, seasons))
    if not per_seed:
        return None
    arrs = [np.array([1.0] * w + [0.0] * (s - w)) for w, s in per_seed]
    est, lo, hi = boot_ci(arrs)
    return est, lo, hi, sum(w for w, _ in per_seed), sum(s for _, s in per_seed)


def streaks(runs, arm, talent, mods=()):
    best, two = 0, 0
    for sd in sorted({k[2] for k in runs if k[0] == arm and k[1] == talent and k[3] == tuple(mods)}):
        t = runs[(arm, talent, sd, tuple(mods))]
        for team in t["spec"]["seats"]:
            run = 0
            for r in t["rows"]:
                run = run + 1 if r["champion"] == team else 0
                best = max(best, run)
                two += run == 2
    return best, two


def spillover(runs, arm, talent, getter, mods=(), base="control"):
    """Change in the CPU (non-seat) teams' strength when seats are skilled: league-level means, paired by seed."""
    diffs = []
    for sd in sorted({k[2] for k in runs if k[0] == arm and k[1] == talent and k[3] == tuple(mods)}):
        c, t = runs.get((base, talent, sd, ())), runs.get((arm, talent, sd, tuple(mods)))
        if not c or not t:
            continue
        seats = set(t["spec"]["seats"]); n = min(len(c["rows"]), len(t["rows"]))
        a = np.mean([getter(c["rows"][i]["teams"][x]) for i in range(n) for x in c["rows"][i]["teams"] if x not in seats])
        b = np.mean([getter(t["rows"][i]["teams"][x]) for i in range(n) for x in t["rows"][i]["teams"] if x not in seats])
        diffs.append(b - a)
    return t_ci(diffs) if diffs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir"); ap.add_argument("--arm", default="skilled"); ap.add_argument("--out"); ap.add_argument("--json")
    ap.add_argument("--base", default="control", help="comparison arm: control (CPU default) or idle (absentee seat)")
    ap.add_argument("--max-season", type=int, default=99, help="primary analysis uses 3: hot-seat firings cannot happen before season 4")
    ap.add_argument("--drop", default="", help="comma list of seed or seed:talent matched leagues to exclude")
    ap.add_argument("--mods", default="", help="comma list: analyse the ablation arm run with exactly these modules")
    a = ap.parse_args()
    global MAXS, DROP
    MAXS = a.max_season; DROP = {x for x in a.drop.split(",") if x}
    runs = load(a.dir)
    mods = tuple(x for x in a.mods.split(",") if x)
    talents = sorted({k[1] for k in runs if k[0] == a.arm})
    lines, js = [], {}
    for talent in talents:
        pairs = paired(runs, a.arm, talent, mods, a.base)
        if not pairs:
            continue
        leagues = sorted({p["seed"] for p in pairs}); maxi = max(p["idx"] for p in pairs)
        lines.append(f"\n### talent {talent}: {a.arm}{'['+a.mods+']' if a.mods else ''} vs {a.base}  ({len(pairs)} seat-seasons, {len(leagues)} leagues, up to {maxi} seasons)\n")
        lines.append("| outcome | " + a.base + " | " + a.arm + " | paired diff [95% league-bootstrap] | t-interval (leagues) | team-cluster bootstrap |")
        lines.append("|---|---:|---:|---:|---:|---:|")
        js[str(talent)] = {}
        for name, (g, grp, label) in OUTCOMES.items():
            e = effect(pairs, g)
            if e is None:
                continue
            js[str(talent)][name] = e
            d = 3 if name in ("playoffs", "title", "next_commit_share") else 2
            lines.append(f"| {label} | {e['ctl']:.{d}f} | {e['trt']:.{d}f} | {fmt(e, d)} | [{e['t_lo']:+.{d}f}, {e['t_hi']:+.{d}f}] | [{e['team_lo']:+.{d}f}, {e['team_hi']:+.{d}f}] |")
        # by season bin
        bins = [("season 1", 1, 1), ("seasons 2-3", 2, 3), ("seasons 4-6", 4, 6), ("seasons 7-10", 7, 10)]
        lines.append(f"\nWins and strength by tenure (paired diff [95% league-bootstrap]):\n")
        lines.append("| seasons | n | wins | playoffs | title | unit score (start) | cap space ($M) |")
        lines.append("|---|---:|---:|---:|---:|---:|---:|")
        js[str(talent)]["by_bin"] = {}
        for label, lo, hi in bins:
            sel = lambda p, lo=lo, hi=hi: lo <= p["idx"] <= hi
            es = {k: effect(pairs, OUTCOMES[k][0], sel) for k in ("wins", "playoffs", "title", "unit_start", "cap_space")}
            if es["wins"] is None:
                continue
            js[str(talent)]["by_bin"][label] = es
            lines.append(f"| {label} | {es['wins']['n']} | {fmt(es['wins'])} | {fmt(es['playoffs'], 3)} | {fmt(es['title'], 3)} | {fmt(es['unit_start'])} | {fmt(es['cap_space'], 1)} |")
        ts = title_share(runs, a.arm, talent, mods); cs = title_share(runs, a.base, talent)
        if ts:
            st = streaks(runs, a.arm, talent, mods)
            lines.append(f"\n[counts seasons after a GM was fired if any] Title share of the {len(runs[(a.arm, talent, leagues[0], mods)]['spec']['seats'])} seats: **{ts[0]*100:.1f}%** "
                         f"[{ts[1]*100:.1f}, {ts[2]*100:.1f}] ({ts[3]} titles in {ts[4]} league-seasons); {a.base} seats: "
                         f"{(cs[0]*100 if cs else float('nan')):.1f}% ({cs[3] if cs else 0}/{cs[4] if cs else 0}). "
                         f"Longest seat title streak: {st[0]}; back-to-back-title occurrences: {st[1]}.")
            js[str(talent)]["title_share"] = dict(est=ts[0], lo=ts[1], hi=ts[2], titles=ts[3], league_seasons=ts[4],
                                                 control=(cs[0] if cs else None), longest_streak=st[0], back_to_back=st[1])
        tr = title_rates(runs, a.arm, talent, mods, a.base); tb = title_rates(runs, a.base, talent, (), a.arm) if False else None
        trb = title_rates(runs, a.base, talent, (), None)
        if tr:
            lines.append(f"Titles per usable seat-season (same GM in both arms): {a.arm} {tr['titles']}/{tr['seat_seasons']} = {tr['rate']*100:.1f}% [{tr['lo']*100:.1f}, {tr['hi']*100:.1f}] over {tr['leagues']} leagues; "
                         f"league-seasons with all four seats still theirs: {tr['all4_titles']} seat titles in {tr['all4_league_seasons']} league-seasons (parity 12.5%).")
            js[str(talent)]["title_rate_usable"] = tr
        sp = spillover(runs, a.arm, talent, OUTCOMES["unit_start"][0], mods, a.base)
        if sp:
            lines.append(f"CPU (non-seat) teams' mean start-of-season unit score, treated minus control: {sp[0]:+.2f} [{sp[1]:+.2f}, {sp[2]:+.2f}] (t over leagues).")
            js[str(talent)]["cpu_spillover_unit"] = dict(diff=sp[0], lo=sp[1], hi=sp[2])
    txt = "\n".join(lines)
    print(txt)
    if a.out:
        open(a.out, "w").write(txt + "\n")
    if a.json:
        json.dump(js, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
