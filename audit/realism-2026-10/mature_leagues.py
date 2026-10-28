"""Mature CPU-only leagues played end to end by the production stage machinery (online/test/_audit_mature.test.ts).
Per season index (1 = first played season, right after the fantasy draft, coaching draft and camp): the league's own regular-season
results, measured the same way as drafted_vs_fixed.py. Run from the out directory: python3 ../mature_leagues.py [mature]"""
import json, glob, sys, numpy as np, pandas as pd
D = (sys.argv[1] if len(sys.argv) > 1 else "mature") + "/"
real = dict(margin_sd=14.31, one_score=53.3, b21=16.5, b28=6.8, w14=1.4, true_sd=5.02, win_sd=3.15, best=11.7, worst=-11.5)
def metrics(games):
    # games: list of [home, away, hs, as] for several seasons grouped by (league,season)
    m, ts = [], []
    for key, gs in games.items():
        t = {}
        for h, a, hs, as_ in gs:
            m.append(hs - as_)
            for tm, x, y in ((h, hs, as_), (a, as_, hs)):
                r = t.setdefault(tm, [0, 0, 0]); r[0] += (x > y) + 0.5 * (x == y); r[1] += x - y; r[2] += 1
        for tm, r in t.items(): ts.append((key, r[0], r[1] / r[2]))
    m = np.array(m); T = pd.DataFrame(ts, columns=["k", "w", "pd"]); n = T.k.nunique()
    sd_pd = T.pd.std()
    return dict(seasons=n, games=len(m), margin_sd=m.std(), one_score=100 * (np.abs(m) <= 8).mean(), b21=100 * (np.abs(m) >= 21).mean(), b28=100 * (np.abs(m) >= 28).mean(),
                w14=(T.w >= 14).sum() / n, perfect=int((T.w >= 16.5).sum()), winless=int((T.w <= 0.5).sum()), team_seasons=len(T), win_sd=T.w.std(),
                true_sd=np.sqrt(max(0, sd_pd ** 2 - (m.std() / np.sqrt(17)) ** 2)), best=T.groupby("k").pd.max().mean(), worst=T.groupby("k").pd.min().mean())
rows = {}
qual = {}
for tal in ("realistic", "amplified"):
    by = {}
    for f in sorted(glob.glob(D + f"mature_{tal}_*.json")):
        d = json.load(open(f))
        for s in d["seasons"]:
            if s.get("games"):
                by.setdefault(s["idx"], {})[f"{f}|{s['idx']}"] = s["games"]
            qual.setdefault((tal, s["idx"]), []).append((s["quality"]["starterSd"], s["quality"]["starterMean"], s["quality"]["qbSd"]))
    for idx, g in by.items(): rows[(tal, idx)] = metrics(g)
    rows[(tal, "all")] = metrics({k: v for i in by for k, v in by[i].items()})
    rows[(tal, "3-10")] = metrics({k: v for i in by if i >= 3 for k, v in by[i].items()})
df = pd.DataFrame(rows).T
pd.set_option("display.width", 250)
print("REAL:", real)
print(df.round(2).to_string())
print("\nstarter-quality sd across teams (mean overall of starting lineup), mean over leagues; [real rosters 1.86, post-draft 0.41]")
for k in sorted(qual, key=lambda x: (x[0], x[1])):
    a = np.array(qual[k]); print(k, "leagues", len(a), "starterSd %.2f  starterMean %.1f  QB1 sd %.2f" % tuple(a.mean(axis=0)))
