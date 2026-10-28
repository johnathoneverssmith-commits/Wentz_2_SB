"""Franchise-path playoffs (from replay_playoffs.ts output *.po.json) vs real 2018-2025 rounds. usage: playoffs_franchise.py <10|15>"""
import json, glob, sys, os, numpy as np, pandas as pd
S = os.environ.get("AUDIT_DIR", "audit/realism-2026-10/out") + "/"
R = json.load(open(S + "real/bench.json"))["playoffs_2018_2025"]
tal = sys.argv[1]
seasons = []
for f in sorted(glob.glob(S + f"t{tal}_[0-9].po.json")): seasons += json.load(open(f))["seasons"]
rows, champs, cseed = [], [], []
for s in seasons:
    for po in s["po"]:
        champs.append(po["champion"])
        for g in po["games"]: rows.append({x: g[x] for x in ("round", "home", "away", "homeSeed", "awaySeed", "homeScore", "awayScore", "winner")})
        sb = [g for g in po["games"] if g["round"] == "superbowl"][0]
        cseed.append(sb["homeSeed"] if sb["winner"] == sb["home"] else sb["awaySeed"])
P = pd.DataFrame(rows); P["m"] = P.homeScore - P.awayScore
print(f"t{tal}: {len(seasons)} seasons x5 replays, {len(P)} games")
for r, k in (("wildcard", "WC"), ("divisional", "DIV"), ("conference", "CON"), ("superbowl", "SB")):
    x = P[P["round"] == r]; hw = (x.m > 0).sum() / max(1, (x.m != 0).sum())
    print(f"  {r:11s} n={len(x):4d} home win {hw:.3f} (real {R[k]['home_win']:.3f}) margin sd {x.m.std():.1f} (real {R[k]['margin_sd']:.1f}) total {(x.homeScore + x.awayScore).mean():.1f} (real {R[k]['total_mean']:.1f}) ties {int((x.m == 0).sum())}")
print("  champion seed distribution:", pd.Series(cseed).value_counts(normalize=True).sort_index().round(3).to_dict())
print("  top title shares:", pd.Series(champs).value_counts(normalize=True).head(4).round(3).to_dict(), " distinct champions:", len(set(champs)))
