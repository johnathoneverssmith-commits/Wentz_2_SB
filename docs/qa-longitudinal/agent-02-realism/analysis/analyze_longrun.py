"""Agent 02 analysis of accelerated long runs (jsonl from harness/agent02_longrun.test.ts). Writes data/summary_<tag>.json."""
import json, sys, collections, math
import numpy as np

TOT = ["points", "totalYards", "passYards", "rushYards", "plays", "thirdDownMade", "thirdDownAtt", "topSeconds", "penalties", "penaltyYards", "turnovers", "passAtt", "passComp", "sacksAllowed", "qbHits", "intThrown", "fumblesLost", "krTd", "prTd", "kickPoints"]
IX = {k: i for i, k in enumerate(TOT)}

def load(path):
    cfg, seasons, snaps = None, [], []
    for l in open(path):
        o = json.loads(l)
        if o["kind"] == "config": cfg = o
        elif o["kind"] == "season": seasons.append(o)
        elif o["kind"] == "players": snaps.append(o)
    return cfg, seasons, snaps

def slope(y):
    x = np.arange(len(y)); y = np.asarray(y, float)
    if len(y) < 4: return (float("nan"),) * 2
    b, a = np.polyfit(x, y, 1); res = y - (a + b * x); se = math.sqrt((res ** 2).sum() / (len(y) - 2) / ((x - x.mean()) ** 2).sum())
    return float(b), float(se)

def league_rows(S):
    """per-season dict of REG team-game means"""
    out = []
    for s in S:
        reg = [g for g in s["games"] if g[0] == "REG" and g[8] is not None]
        T = np.array([g[8] for g in reg] + [g[9] for g in reg], float)
        H = np.array([g[8] for g in reg], float); A = np.array([g[9] for g in reg], float)
        sc = np.array([[g[4], g[5]] for g in reg], float)
        row = {"season": s["season"], "n_games": len(reg)}
        for k in TOT: row[k] = float(np.nanmean(T[:, IX[k]]))
        row["points_sd"] = float(T[:, 0].std())
        row["margin_sd"] = float((sc[:, 0] - sc[:, 1]).std())
        row["home_win_pct"] = float(((sc[:, 0] > sc[:, 1]) + 0.5 * (sc[:, 0] == sc[:, 1])).mean())
        row["home_margin"] = float((sc[:, 0] - sc[:, 1]).mean())
        row["ot_rate"] = float(np.mean([len(g[10]) > 4 for g in reg])); row["tie_rate"] = float((sc[:, 0] == sc[:, 1]).mean())
        row["pass_share"] = float(np.nanmean(T[:, IX["passAtt"]] / (T[:, IX["passAtt"]] + (T[:, IX["plays"]] - T[:, IX["passAtt"]] - T[:, IX["sacksAllowed"]]).clip(1)))) 
        row["comp_pct"] = float(T[:, IX["passComp"]].sum() / T[:, IX["passAtt"]].sum())
        row["third_pct"] = float(T[:, IX["thirdDownMade"]].sum() / T[:, IX["thirdDownAtt"]].sum())
        row["ypp"] = float(T[:, IX["totalYards"]].sum() / T[:, IX["plays"]].sum())
        row["inj_per_team_game"] = float(s["inj"].__len__() / (2 * len(reg))) if s["inj"] else 0.0
        out.append(row)
    return out

def team_wins(S, reg_only=True):
    res = []
    for s in S:
        w = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
        for g in s["games"]:
            if g[0] != "REG": continue
            h, a, hs, as_ = g[2], g[3], g[4], g[5]
            for t, f, o in ((h, hs, as_), (a, as_, hs)):
                r = w[t]; r[3] += f; r[4] += o
                if f > o: r[0] += 1
                elif f < o: r[1] += 1
                else: r[2] += 1
        res.append({t: v for t, v in w.items()})
    return res

def champions(S): return [s["champion"] for s in S]

def analyze(path, tag, human="KC"):
    cfg, S, snaps = load(path)
    out = {"tag": tag, "seed": cfg["seed"], "talent": cfg["talent"], "seasons": len(S), "first": S[0]["season"], "last": S[-1]["season"]}
    L = league_rows(S); out["league"] = L
    keys = ["points", "totalYards", "passYards", "rushYards", "plays", "turnovers", "sacksAllowed", "penalties", "penaltyYards", "topSeconds", "kickPoints", "comp_pct", "third_pct", "pass_share", "ypp", "points_sd", "margin_sd", "home_win_pct", "inj_per_team_game", "ot_rate"]
    out["league_trend"] = {k: {"mean": float(np.mean([r[k] for r in L])), "first3": float(np.mean([r[k] for r in L[:3]])), "last3": float(np.mean([r[k] for r in L[-3:]])), "slope_per_season": slope([r[k] for r in L])[0], "slope_se": slope([r[k] for r in L])[1]} for k in keys}
    # score tallies
    pts = []; ng = 0; tie = 0
    for s in S:
        for g in s["games"]:
            if g[0] == "REG": pts += [g[4], g[5]]; ng += 1; tie += g[4] == g[5]
    pts = np.array(pts); out["points_all"] = {"n_team_games": int(len(pts)), "mean": float(pts.mean()), "sd": float(pts.std()), "pctl": {str(q): float(np.percentile(pts, q)) for q in (1, 5, 10, 25, 50, 75, 90, 95, 99)}, "ge40": float((pts >= 40).mean()), "shutout": float((pts == 0).mean()), "le6": float((pts <= 6).mean()), "max": int(pts.max()), "counts": {str(k): int((pts == k).sum()) for k in range(0, 70)}}
    # wins
    TW = team_wins(S)
    wins = [[v[0] + 0.5 * v[2] for v in d.values()] for d in TW]
    out["wins"] = {"sd_mean": float(np.mean([np.std(w, ddof=1) for w in wins])), "sd_by_season": [float(np.std(w, ddof=1)) for w in wins],
                   "ge13_per_season": float(np.mean([sum(x >= 13 for x in w) for w in wins])), "le4_per_season": float(np.mean([sum(x <= 4 for x in w) for w in wins])),
                   "ge14_per_season": float(np.mean([sum(x >= 14 for x in w) for w in wins])), "le3_per_season": float(np.mean([sum(x <= 3 for x in w) for w in wins])),
                   "ge16_total": int(sum(sum(x >= 16 for x in w) for w in wins)), "le1_total": int(sum(sum(x <= 1 for x in w) for w in wins)),
                   "max_wins": float(max(max(w) for w in wins)), "min_wins": float(min(min(w) for w in wins))}
    prev = None; xs, ys = [], []; ch = []
    for d in TW:
        cur = {t: v[0] + 0.5 * v[2] for t, v in d.items()}
        if prev:
            for t in cur:
                if t in prev: xs.append(prev[t]); ys.append(cur[t])
        prev = cur
    out["wins"]["yr_to_yr_corr"] = float(np.corrcoef(xs, ys)[0, 1]); out["wins"]["mean_abs_change"] = float(np.mean(np.abs(np.array(xs) - np.array(ys))))
    # persistent dominance: team with highest mean win total / share of seasons in top 8 / bottom 8
    allt = sorted(TW[0].keys())
    mean_w = {t: np.mean([d[t][0] + 0.5 * d[t][2] for d in TW if t in d]) for t in allt}
    out["wins"]["team_mean_wins_range"] = [float(min(mean_w.values())), float(max(mean_w.values()))]
    out["wins"]["team_mean_wins_sd"] = float(np.std(list(mean_w.values())))
    out["wins"]["team_mean_wins_top5"] = sorted(((t, round(float(v), 2)) for t, v in mean_w.items()), key=lambda x: -x[1])[:5]
    out["wins"]["team_mean_wins_bottom5"] = sorted(((t, round(float(v), 2)) for t, v in mean_w.items()), key=lambda x: x[1])[:5]
    # expected sd of team mean wins if every team were equal (binomial): sd of 20 season means
    n = len(S); out["wins"]["team_mean_wins_sd_if_equal_teams"] = float(math.sqrt(17 * 0.25 / n))
    chs = champions(S); out["champions"] = chs; out["distinct_champions"] = len(set(chs))
    out["max_titles_one_team"] = collections.Counter(chs).most_common(3)
    out["repeat_champions"] = int(sum(1 for a, b in zip(chs, chs[1:]) if a == b))
    # playoff team churn: share of playoff teams (from bracket seeds) not in last year's playoffs
    pt = [set(sum(s["bracket"]["seeds"].values(), [])) for s in S]
    out["playoff_turnover"] = float(np.mean([len(b - a) / len(b) for a, b in zip(pt, pt[1:])]))
    out["worst_to_playoffs_next"] = None
    # bye / 1 seed winning titles, seed of champion
    seed_of = []
    for s in S:
        seeds = s["bracket"]["seeds"]
        for conf, lst in seeds.items():
            if s["champion"] in lst: seed_of.append(lst.index(s["champion"]) + 1)
    out["champion_seed_dist"] = dict(collections.Counter(seed_of))
    # worst->first / first->worst moves
    jumps = []
    for a, b in zip(TW, TW[1:]):
        wa = {t: v[0] + .5 * v[2] for t, v in a.items()}; wb = {t: v[0] + .5 * v[2] for t, v in b.items()}
        bot = sorted(wa, key=wa.get)[:8]; top = sorted(wa, key=wa.get)[-8:]
        jumps.append((np.mean([wb[t] for t in bot]), np.mean([wb[t] for t in top]), len([t for t in bot if wb[t] >= 10]), len(set(sorted(wb, key=wb.get)[-14:]) & set(bot))))
    out["recovery"] = {"bottom8_next_year_mean_wins": float(np.mean([j[0] for j in jumps])), "top8_next_year_mean_wins": float(np.mean([j[1] for j in jumps])), "bottom8_to_10plus_wins_per_yr": float(np.mean([j[2] for j in jumps]))}
    # human team record vs peers
    out["human_team_wins"] = [d.get(human, [0, 0, 0])[0] for d in TW]
    # points scored sd across teams (offense/defense spread), team ppg
    tsd = []
    for d in TW:
        tsd.append(np.std([v[3] / 17 for v in d.values()]))
    out["team_ppg_sd"] = float(np.mean(tsd))
    out["pf_pa_diff_sd"] = float(np.mean([np.std([(v[3] - v[4]) / 17 for v in d.values()]) for d in TW]))
    # playoff games: seeds, upset rate
    up = [0, 0]
    for s in S:
        for m in s["bracket"]["matchups"]:
            if m.get("lowSeed") and m.get("homeScore") is not None:
                hi, lo = m["highSeed"]["code"], m["lowSeed"]["code"]
                up[1] += 1; up[0] += (m["winner"] == lo)
    out["playoff_upset_rate"] = up[0] / max(up[1], 1); out["playoff_games"] = up[1]
    # --- players
    out["players"] = analyze_players(S, snaps, human)
    return out, S, snaps

def tier(o): return "elite85+" if o >= 85 else "good75-84" if o >= 75 else "avg65-74" if o >= 65 else "low<65"

def analyze_players(S, snaps, human):
    P = {}
    rows = collections.defaultdict(list)
    for s in S:
        for pid, pos, age, ovr, team, st in s["stats"]:
            rows[pos].append((s["season"], pid, age, ovr, team, st))
    res = {}
    # QBs qualified: >=200 attempts
    qb = [(a, o, t, st) for (se, p, a, o, t, st) in rows["QB"] if st["passAtt"] >= 200]
    def agg(lst, fn): return float(np.mean([fn(x) for x in lst])) if lst else None
    res["QB"] = {"n_qualified": len(qb), "per_season": len(qb) / len(S)}
    fn = {"att_pg": lambda x: x[3]["passAtt"] / max(x[3]["gamesPlayed"], 1), "cmp": lambda x: x[3]["passCmp"] / x[3]["passAtt"], "ypa": lambda x: x[3]["passYds"] / x[3]["passAtt"],
          "int_pct": lambda x: x[3]["passInt"] / x[3]["passAtt"], "td_pct": lambda x: x[3]["passTd"] / x[3]["passAtt"], "rush_yds_pg": lambda x: x[3]["rushYds"] / max(x[3]["gamesPlayed"], 1)}
    for k, f in fn.items():
        v = np.array([f(x) for x in qb]); res["QB"][k] = {"mean": float(v.mean()), "sd": float(v.std()), "p10": float(np.percentile(v, 10)), "p90": float(np.percentile(v, 90))}
    byT = collections.defaultdict(list)
    for x in qb: byT[tier(x[1])].append(x)
    res["QB"]["by_tier"] = {t: {"n": len(v), "ypa": agg(v, fn["ypa"]), "cmp": agg(v, fn["cmp"]), "int_pct": agg(v, fn["int_pct"]), "td_pct": agg(v, fn["td_pct"]), "att_pg": agg(v, fn["att_pg"]), "ovr_mean": agg(v, lambda x: x[1])} for t, v in byT.items()}
    ov = np.array([x[1] for x in qb]); ypa = np.array([fn["ypa"](x) for x in qb]); res["QB"]["corr_ovr_ypa"] = float(np.corrcoef(ov, ypa)[0, 1]); res["QB"]["corr_ovr_intpct"] = float(np.corrcoef(ov, [fn["int_pct"](x) for x in qb])[0, 1])
    res["QB"]["corr_ovr_tdpct"] = float(np.corrcoef(ov, [fn["td_pct"](x) for x in qb])[0, 1])
    res["QB"]["ovr_dist_qualified"] = {"mean": float(ov.mean()), "p10": float(np.percentile(ov, 10)), "p90": float(np.percentile(ov, 90))}
    res["QB"]["passyds_max_by_season"] = [max([x[5]["passYds"] for x in rows["QB"] if x[0] == s["season"]] or [0]) for s in S]
    res["QB"]["n_5000yd"] = sum(1 for x in rows["QB"] if x[5]["passYds"] >= 5000); res["QB"]["n_4000yd_per_season"] = sum(1 for x in rows["QB"] if x[5]["passYds"] >= 4000) / len(S)
    res["QB"]["n_40td"] = sum(1 for x in rows["QB"] if x[5]["passTd"] >= 40)
    res["QB"]["max_td"] = max(x[5]["passTd"] for x in rows["QB"]); res["QB"]["max_int"] = max(x[5]["passInt"] for x in rows["QB"]) 
    # seasonal QB attempts>=200 count per season includes backups in garbage? also top-QB ovr by season
    # RB
    rb = [x for x in rows["RB"] if x[5]["rushAtt"] >= 50]
    rbv = {"carries": [x[5]["rushAtt"] for x in rb], "yds": [x[5]["rushYds"] for x in rb], "ypc": [x[5]["rushYds"] / x[5]["rushAtt"] for x in rb], "td": [x[5]["rushTd"] for x in rb], "rec": [x[5]["rec"] for x in rb]}
    res["RB"] = {"n": len(rb), "per_season": len(rb) / len(S), **{k: {"mean": float(np.mean(v)), "p90": float(np.percentile(v, 90)), "max": float(np.max(v))} for k, v in rbv.items()},
                 "n_1000yd_per_season": sum(1 for x in rows["RB"] if x[5]["rushYds"] >= 1000) / len(S), "n_300carry": sum(1 for x in rows["RB"] if x[5]["rushAtt"] >= 300),
                 "top_carries_by_season": [max([x[5]["rushAtt"] for x in rows["RB"] if x[0] == s["season"]] or [0]) for s in S][:5]}
    ob = collections.defaultdict(list)
    for x in rb: ob[tier(x[3])].append(x[5]["rushYds"] / x[5]["rushAtt"])
    res["RB"]["ypc_by_tier"] = {t: [len(v), float(np.mean(v))] for t, v in ob.items()}
    res["RB"]["corr_ovr_ypc"] = float(np.corrcoef([x[3] for x in rb], rbv["ypc"])[0, 1])
    # carry share of top RB per team-season
    tr = collections.defaultdict(list)
    for x in rows["RB"]: tr[(x[0], x[4])].append(x[5]["rushAtt"])
    sh = [max(v) / sum(v) for v in tr.values() if sum(v) > 100]; res["RB"]["top_back_carry_share"] = {"mean": float(np.mean(sh)), "p10": float(np.percentile(sh, 10)), "p90": float(np.percentile(sh, 90))}
    # receivers
    for pos in ("WR", "TE", "RB"):
        r = rows[pos]
        res[pos + "_rec"] = {"n_1000yd_per_season": sum(1 for x in r if x[5]["recYds"] >= 1000) / len(S), "n_1500yd_per_season": sum(1 for x in r if x[5]["recYds"] >= 1500) / len(S), "max_yds": max([x[5]["recYds"] for x in r] or [0]),
                             "max_rec": max([x[5]["rec"] for x in r] or [0]), "max_td": max([x[5]["recTd"] for x in r] or [0]), "mean_rec_per_game_top": None,
                             "sum_rec_yds_per_season": sum(x[5]["recYds"] for x in r) / len(S)}
    # team receiving yds share by position
    tot = {p: res[p + "_rec"]["sum_rec_yds_per_season"] for p in ("WR", "TE", "RB")}; z = sum(tot.values()); res["rec_yds_share"] = {p: v / z for p, v in tot.items()}
    # WR: ypr, catch counts vs ovr
    wr = [x for x in rows["WR"] if x[5]["rec"] >= 30]
    res["WR_ypr"] = {"mean": float(np.mean([x[5]["recYds"] / x[5]["rec"] for x in wr])), "corr_ovr_recyds": float(np.corrcoef([x[3] for x in wr], [x[5]["recYds"] for x in wr])[0, 1])}
    # defense: sacks, ints, tackles
    d = [x for pos in ("EDGE", "DT", "ILB", "OLB", "CB", "S", "DE", "LB") for x in rows.get(pos, [])]
    res["DEF"] = {"sack_max_by_season": [max([x[5]["sacks"] for x in d if x[0] == s["season"]] or [0]) for s in S][:6], "n_10sack_per_season": sum(1 for x in d if x[5]["sacks"] >= 10) / len(S), "n_15sack": sum(1 for x in d if x[5]["sacks"] >= 15), "max_sacks": max(x[5]["sacks"] for x in d),
                  "int_max_by_season": [max([x[5]["defInt"] for x in d if x[0] == s["season"]] or [0]) for s in S][:6], "n_5int_per_season": sum(1 for x in d if x[5]["defInt"] >= 5) / len(S), "max_int": max(x[5]["defInt"] for x in d),
                  "tackles_max": max(x[5]["tackles"] for x in d), "tackles_top10_mean": float(np.mean(sorted([x[5]["tackles"] for x in d], reverse=True)[:10 * len(S)])),
                  "total_tackles_per_team_game": None}
    for pos in sorted(set(p for p in rows if p in ("EDGE", "DT", "ILB", "OLB", "CB", "S"))):
        r = rows[pos]; res["DEF"][pos] = {"n": len(r), "sack_mean": float(np.mean([x[5]["sacks"] for x in r])), "int_mean": float(np.mean([x[5]["defInt"] for x in r])), "tackles_mean": float(np.mean([x[5]["tackles"] for x in r])),
                                          "corr_ovr_sacks": float(np.corrcoef([x[3] for x in r], [x[5]["sacks"] for x in r])[0, 1]) if len(r) > 5 else None,
                                          "corr_ovr_tackles": float(np.corrcoef([x[3] for x in r], [x[5]["tackles"] for x in r])[0, 1]) if len(r) > 5 else None}
    edge = [x for x in rows["EDGE"] if x[5]["gamesPlayed"] >= 12]
    ob = collections.defaultdict(list)
    for x in edge: ob[tier(x[3])].append(x[5]["sacks"])
    res["DEF"]["EDGE_sacks_by_tier"] = {t: [len(v), float(np.mean(v))] for t, v in ob.items()}
    cb = [x for x in rows["CB"] + rows["S"] if x[5]["gamesPlayed"] >= 12]
    ob = collections.defaultdict(list)
    for x in cb: ob[tier(x[3])].append(x[5]["defInt"])
    res["DEF"]["DB_int_by_tier"] = {t: [len(v), float(np.mean(v))] for t, v in ob.items()}
    # K
    k = [x for x in rows["K"] if x[5]["fga"] >= 15]
    res["K"] = {"n": len(k), "fga_mean": float(np.mean([x[5]["fga"] for x in k])), "fg_pct": float(sum(x[5]["fgm"] for x in k) / sum(x[5]["fga"] for x in k)),
                "fg_pct_sd": float(np.std([x[5]["fgm"] / x[5]["fga"] for x in k])), "xpa_total": int(sum(x[5]["xpa"] for x in rows["K"])), "corr_ovr_fgpct": float(np.corrcoef([x[3] for x in k], [x[5]["fgm"] / x[5]["fga"] for x in k])[0, 1]),
                "fg_pct_by_tier": {t: [len(v), float(np.mean(v))] for t, v in {tt: [x[5]["fgm"] / x[5]["fga"] for x in k if tier(x[3]) == tt] for tt in set(tier(x[3]) for x in k)}.items()}}
    return res

if __name__ == "__main__":
    path, tag = sys.argv[1], sys.argv[2]
    out, S, snaps = analyze(path, tag)
    json.dump(out, open(f"data/summary_{tag}.json", "w"), indent=1, default=lambda o: float(o) if isinstance(o, (np.floating, np.integer)) else str(o))
    print(json.dumps({k: v for k, v in out.items() if k not in ("league", "points_all", "players")}, indent=1, default=str)[:3500])
