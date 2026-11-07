"""Scoring/play-level forensics from harness/agent02_forensics.test.ts output vs NFL benchmarks."""
import json, sys, collections, numpy as np
def run(path, tag):
    D = json.load(open(path)); G = D["games"]; n = len(G); ntg = 2 * n
    out = {"tag": tag, "seed": D["seed"], "talent": D["talent"], "games": n}
    kinds = collections.Counter(e[2] for g in G for e in g["ev"])
    out["events_per_game"] = {k: v / n for k, v in kinds.items()}
    out["events_per_team_game"] = {k: v / ntg for k, v in kinds.items()}
    # decomposition
    bad = 0
    for g in G:
        s = [0, 0]
        for e in g["ev"]: s[e[0]] += e[1]
        bad += s != g["score"]
    out["score_decomposition_mismatch"] = bad
    pts = np.array([x for g in G for x in g["score"]]); out["ppg"] = float(pts.mean()); out["pts_sd"] = float(pts.std())
    mar = np.array([g["score"][0] - g["score"][1] for g in G]); out["margin_sd"] = float(mar.std()); out["home_win"] = float(((mar > 0) + .5 * (mar == 0)).mean())
    out["ot_rate"] = sum(g["ot"] for g in G) / n; out["tie_rate"] = float((mar == 0).mean())
    # OT: who won, score margin; ties
    ot = [g for g in G if g["ot"]]; out["ot_games"] = len(ot)
    out["ot_tie_share"] = float(np.mean([g["score"][0] == g["score"][1] for g in ot])) if ot else None
    out["ot_margin_dist"] = dict(collections.Counter(abs(g["score"][0] - g["score"][1]) for g in ot))
    # tied after regulation share: games with ot among those tied after Q4 unknown; use ot_rate
    # safeties
    out["safeties_per_game"] = kinds.get("safety", 0) / n
    # two point
    out["two_point_per_game"] = kinds.get("two_point", 0) / n
    out["xp_per_team_game"] = kinds.get("extra_point", 0) / ntg
    td = kinds.get("touchdown", 0); out["td_per_team_game"] = td / ntg
    out["xp_per_td"] = kinds.get("extra_point", 0) / max(td + kinds.get("interception_return_td", 0) + kinds.get("fumble_return_td", 0) + kinds.get("punt_return_td", 0) + kinds.get("kick_return_td", 0), 1)
    # impossible / unusual scores
    cnt = collections.Counter(int(x) for x in pts)
    out["score_value_counts_low"] = {k: cnt.get(k, 0) for k in range(0, 12)}
    out["score_1_count"] = cnt.get(1, 0)
    out["score_max"] = int(pts.max()); out["total_max"] = int(max(g["score"][0] + g["score"][1] for g in G))
    # def scores
    dtd = kinds.get("interception_return_td", 0) + kinds.get("fumble_return_td", 0)
    out["def_td_per_team_game"] = dtd / ntg; out["pick6_per_team_game"] = kinds.get("interception_return_td", 0) / ntg
    out["punt_return_td_per_team_game"] = kinds.get("punt_return_td", 0) / ntg; out["kick_return_td_per_team_game"] = kinds.get("kick_return_td", 0) / ntg
    # FG
    out["fg_per_team_game"] = kinds.get("field_goal", 0) / ntg
    # drives
    dr = [d for g in G for d in g["drives"]]
    out["drives_per_team_game"] = len(dr) / ntg
    res = collections.Counter(d[2] for d in dr); out["drive_results"] = {k: v / len(dr) for k, v in res.items()}
    out["points_per_drive"] = float(np.mean([d[4] for d in dr])); out["avg_start_yl"] = float(np.mean([d[1] for d in dr]))
    # fourth down
    f4 = [f for g in G for f in g["fourth"]]
    out["fourth_downs_per_team_game"] = len(f4) / ntg
    go = [f for f in f4 if f[0] in ("pass", "run", "sack", "scramble")]
    out["fourth_go_rate"] = len(go) / len(f4)
    def band(fil):
        d = [f for f in f4 if fil(f)]
        if not d: return {"n": 0}
        return {"n": len(d), "go": sum(f[0] in ("pass", "run", "sack", "scramble") for f in d) / len(d), "fg": sum(f[0] == "field_goal" for f in d) / len(d), "punt": sum(f[0] == "punt" for f in d) / len(d)}
    out["fourth_situations"] = {
        "own_territory_4th_long(>5 to go, yl>60)": band(lambda f: f[2] > 60 and f[1] > 5),
        "midfield_short(1-2 to go,40<yl<=60)": band(lambda f: 40 < f[2] <= 60 and f[1] <= 2),
        "fg_range_4th_and_1(yl 20-35)": band(lambda f: 20 <= f[2] <= 35 and f[1] <= 1),
        "redzone_4th_and_goal(yl<=5)": band(lambda f: f[2] <= 5),
        "fg_range_4th_long(>=7 to go, yl<=35)": band(lambda f: f[2] <= 35 and f[1] >= 7)}
    gc = [f for f in go if f[3] in ("complete", "run", "scramble") or True]
    # conversions: approximate via outcome strings
    outc = collections.Counter(f[3] for f in go); out["fourth_go_outcomes"] = dict(outc.most_common(8))
    # late-game desperation: trailing by >=8 in Q4, 4th down go rate
    late = [f for f in f4 if f[5] == 4 and f[6] <= -8]; out["q4_trailing8plus_4th_go_rate"] = (sum(f[0] in ("pass", "run", "sack", "scramble") for f in late) / len(late)) if late else None
    out["q4_trailing8plus_n"] = len(late)
    # fractional ydstogo share
    out["fourth_ydstogo_fractional_share"] = float(np.mean([abs(f[1] - round(f[1])) > 0.01 for f in f4]))
    # blowouts
    out["margin_ge21"] = float((np.abs(mar) >= 21).mean()); out["margin_le3"] = float((np.abs(mar) <= 3).mean()); out["pts_ge40"] = float((pts >= 40).mean()); out["pts_le6"] = float((pts <= 6).mean())
    out["total_ge70"] = float(np.mean([g["score"][0] + g["score"][1] >= 70 for g in G]))
    out["plays_per_team_game_traced"] = float(np.mean([g["nplays"] for g in G]) / 2)
    return out
if __name__ == "__main__":
    o = run(sys.argv[1], sys.argv[2]); json.dump(o, open(f"data/forensics_{sys.argv[2]}.json", "w"), indent=1, default=str); print(json.dumps(o, indent=1, default=str))
