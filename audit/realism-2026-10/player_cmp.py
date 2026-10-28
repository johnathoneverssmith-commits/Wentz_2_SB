import json, glob, sys, numpy as np, pandas as pd
import os; S = os.environ.get("AUDIT_DIR", "audit/realism-2026-10/out") + "/"
R = S + "real/"
tal = sys.argv[1]
seasons = []
for f in sorted(glob.glob(S + f"t{tal}_[0-9].json")): seasons += json.load(open(f))["seasons"]
rows = []
for i, s in enumerate(seasons):
    for p in s["players"]: rows.append(dict(season=i, **p))
P = pd.DataFrame(rows).fillna(0)
nS = len(seasons)
rs = pd.read_pickle(R + "szn.pkl")
rs = rs.rename(columns=dict(player_display_name="name", team="tm"))
NSR = rs.season.nunique()
print(f"### players, talent group t{tal}: {nS} sim seasons, real {NSR} seasons (nflverse 2023-25)\n")
pd.set_option("display.width", 220)

def desc(name, sv, rv, fmt="{:8.2f}"):
    print(f"  {name:34s} sim {fmt.format(sv)}  real {fmt.format(rv)}")

def per_season_top(df, pos, key, n, extra=None):
    out = []
    for s, d in df[df.pos.isin(pos) if "pos" in df else df.position.isin(pos)].groupby("season"):
        out.append(d.sort_values(key, ascending=False).head(n))
    return pd.concat(out)

# ---- QB
print("== QB (top 32 by attempts per season) ==")
sq = per_season_top(P, ["QB"], "att", 32)
rq = per_season_top(rs.rename(columns=dict(position="pos")), ["QB"], "attempts", 32)
def qbstats(d, a, c, y, td, it, sk, g, ry):
    d = d.copy()
    r = dict(cmp_pct=100 * d[c].sum() / d[a].sum(), ypa=d[y].sum() / d[a].sum(), td_pct=100 * d[td].sum() / d[a].sum(), int_pct=100 * d[it].sum() / d[a].sum(), sack_pct=100 * d[sk].sum() / (d[a].sum() + d[sk].sum()))
    d["cp"] = 100 * d[c] / d[a]; d["yp"] = d[y] / d[a]
    r.update(cmp_sd=d.cp.std(), ypa_sd=d.yp.std(), yds_mean=d[y].mean(), yds_sd=d[y].std(), yds_max=d[y].max(), y4000=(d[y] >= 4000).sum() / d.season.nunique(), y4500=(d[y] >= 4500).sum() / d.season.nunique(), y5000=(d[y] >= 5000).sum() / d.season.nunique(),
             td_mean=d[td].mean(), td_max=d[td].max(), td30=(d[td] >= 30).sum() / d.season.nunique(), td40=(d[td] >= 40).sum() / d.season.nunique(), int_mean=d[it].mean(), int_max=d[it].max(), int_le5=(d[it] <= 5).sum() / d.season.nunique(),
             att_mean=d[a].mean(), att_max=d[a].max(), rush_yds_mean=d[ry].mean(), rush_yds_max=d[ry].max(), gp=d[g].mean(),
             top1_yds=d.groupby("season")[y].max().mean(), q10=d.groupby("season")[y].apply(lambda x: x.sort_values(ascending=False).iloc[9]).mean(), q32=d.groupby("season")[y].apply(lambda x: x.sort_values(ascending=False).iloc[-1]).mean())
    return r
sqs = qbstats(sq, "att", "cmp", "pyd", "ptd", "int", "sacked", "g", "cyd")
rqs = qbstats(rq, "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions", "sacks_suffered", "gp", "rushing_yards")
for k in sqs: desc(k, sqs[k], rqs[k])
print("  (sim QBs have no season-long injuries/rest: games played is ~17 for QB1; real QB1s miss games)")
print("  per-game: sim QB1 yds/g %.1f  real top32 yds/g %.1f" % (sq.pyd.sum() / sq.g.sum(), rq.passing_yards.sum() / rq.gp.sum()))

# ---- RB
print("\n== RB (top 40 by carries) ==")
sr = per_season_top(P, ["RB"], "car", 40); rr = per_season_top(rs.rename(columns=dict(position="pos")), ["RB"], "carries", 40)
def rbstats(d, car, yds, td, rec, ryd, g):
    n = d.season.nunique()
    gr = d.copy();
    return dict(ypc=d[yds].sum() / d[car].sum(), car_mean=d[car].mean(), car_max=d[car].max(), yds_mean=d[yds].mean(), yds_sd=d[yds].std(), yds_max=d[yds].max(), n1000=(d[yds] >= 1000).sum() / n, n1500=(d[yds] >= 1500).sum() / n, n2000=(d[yds] >= 2000).sum() / n,
                td_mean=d[td].mean(), td_max=d[td].max(), td15=(d[td] >= 15).sum() / n, top1_yds=d.groupby("season")[yds].max().mean(), rec_mean=d[rec].mean(), rec_max=d[rec].max(), recyds_max=d[ryd].max(), gp=d[g].mean(),
                ypc_sd=(d[yds] / d[car]).std(), n_with_ypc_lt3_5=((d[yds] / d[car]) < 3.5).sum() / n, n_with_ypc_gt5=((d[yds] / d[car]) > 5.0).sum() / n)
a = rbstats(sr, "car", "cyd", "ctd", "rec", "ryd", "g"); b = rbstats(rr, "carries", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "gp")
for k in a: desc(k, a[k], b[k])
# ---- WR / TE
for posn, nn in (("WR", 64), ("TE", 32)):
    print(f"\n== {posn} (top {nn} by targets) ==")
    sw = per_season_top(P, [posn], "tgt", nn); rw = per_season_top(rs.rename(columns=dict(position="pos")), [posn], "targets", nn)
    def ws(d, tg, rc, yd, td, g):
        n = d.season.nunique()
        return dict(catch_pct=100 * d[rc].sum() / d[tg].sum(), yds_per_tgt=d[yd].sum() / d[tg].sum(), yds_per_rec=d[yd].sum() / d[rc].sum(), tgt_mean=d[tg].mean(), tgt_max=d[tg].max(), rec_mean=d[rc].mean(), rec_max=d[rc].max(),
                    yds_mean=d[yd].mean(), yds_sd=d[yd].std(), yds_max=d[yd].max(), n1000=(d[yd] >= 1000).sum() / n, n1200=(d[yd] >= 1200).sum() / n, n1400=(d[yd] >= 1400).sum() / n, n1600=(d[yd] >= 1600).sum() / n,
                    td_mean=d[td].mean(), td_max=d[td].max(), td10=(d[td] >= 10).sum() / n, top1_yds=d.groupby("season")[yd].max().mean(), gp=d[g].mean())
    a = ws(sw, "tgt", "rec", "ryd", "rtd", "g"); b = ws(rw, "targets", "receptions", "receiving_yards", "receiving_tds", "gp")
    for k in a: desc(k, a[k], b[k])
# target concentration
print("\n== target distribution inside a team-season (WR1 share, TE share, RB share of all targets) ==")
tt = P[P.tgt > 0].groupby(["season", "team"]).apply(lambda d: pd.Series(dict(wr1=d[d.pos == "WR"].tgt.max() / d.tgt.sum(), te=d[d.pos == "TE"].tgt.sum() / d.tgt.sum(), rb=d[d.pos == "RB"].tgt.sum() / d.tgt.sum(), wr=d[d.pos == "WR"].tgt.sum() / d.tgt.sum(), top=d.tgt.max() / d.tgt.sum()))).mean()
rt = rs[rs.targets > 0].groupby(["season", "tm"]).apply(lambda d: pd.Series(dict(wr1=d[d.position == "WR"].targets.max() / d.targets.sum(), te=d[d.position == "TE"].targets.sum() / d.targets.sum(), rb=d[d.position == "RB"].targets.sum() / d.targets.sum(), wr=d[d.position == "WR"].targets.sum() / d.targets.sum(), top=d.targets.max() / d.targets.sum()))).mean()
for k in tt.index: desc("target share " + k, tt[k], rt[k], "{:8.3f}")

# ---- defense
print("\n== DEFENSE: sacks ==")
grp_sim = {"EDGE": "EDGE", "DT": "DT", "ILB": "LB", "OLB": "LB", "CB": "DB", "S": "DB"}
rgrp = {"DE": "EDGE", "OLB": "EDGE", "DT": "DT", "NT": "DT", "LB": "LB", "ILB": "LB", "MLB": "LB", "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB", "DB": "DB"}
sd = P[P.sack > 0].copy(); sd["g2"] = sd.pos.map(lambda x: grp_sim.get(x, "OTH"))
rd = rs[rs.def_sacks > 0].copy(); rd["g2"] = rd.position.map(lambda x: rgrp.get(x, "OTH"))
print("  share of league sacks by position group:")
for g in ["EDGE", "DT", "LB", "DB", "OTH"]:
    print(f"    {g:5s} sim {sd[sd.g2 == g].sack.sum() / sd.sack.sum():6.3f}   real {rd[rd.g2 == g].def_sacks.sum() / rd.def_sacks.sum():6.3f}")
sl = P.groupby("season").sack.apply(lambda x: x.sort_values(ascending=False).head(10).values)
rl = rs.groupby("season").def_sacks.apply(lambda x: x.sort_values(ascending=False).head(10).values)
print("  league sack leaders (mean over seasons) rank1 / rank5 / rank10: sim %.1f %.1f %.1f   real %.1f %.1f %.1f" % tuple([np.mean([v[0] for v in sl]), np.mean([v[4] for v in sl]), np.mean([v[9] for v in sl]), np.mean([v[0] for v in rl]), np.mean([v[4] for v in rl]), np.mean([v[9] for v in rl])]))
print("  max single-season: sim %.1f real %.1f ; # players >=10 sacks per season: sim %.1f real %.1f ; >=15: sim %.2f real %.2f" % (P.sack.max(), rs.def_sacks.max(), (P.sack >= 10).sum() / nS, (rs.def_sacks >= 10).sum() / NSR, (P.sack >= 15).sum() / nS, (rs.def_sacks >= 15).sum() / NSR))
print("  total sacks per team-game: sim %.2f (credited)  real %.2f" % (P.sack.sum() / (nS * 272 * 2), rs.def_sacks.sum() / (NSR * 272 * 2)))
print("\n== DEFENSE: INT / PD ==")
il = P.groupby("season").dint.apply(lambda x: x.sort_values(ascending=False).head(10).values); rl2 = rs.groupby("season").def_interceptions.apply(lambda x: x.sort_values(ascending=False).head(10).values)
print("  INT leaders rank1 / rank10: sim %.1f %.1f  real %.1f %.1f ; max sim %d real %d ; players with >=6 INT per season sim %.1f real %.1f" % (np.mean([v[0] for v in il]), np.mean([v[9] for v in il]), np.mean([v[0] for v in rl2]), np.mean([v[9] for v in rl2]), P.dint.max(), rs.def_interceptions.max(), (P.dint >= 6).sum() / nS, (rs.def_interceptions >= 6).sum() / NSR))
pl = P.groupby("season").pd.apply(lambda x: x.sort_values(ascending=False).head(10).values); rl3 = rs.groupby("season").def_pass_defended.apply(lambda x: x.sort_values(ascending=False).head(10).values)
print("  PD leaders rank1 / rank10: sim %.1f %.1f real %.1f %.1f ; sim total PD/team-game %.2f real %.2f" % (np.mean([v[0] for v in pl]), np.mean([v[9] for v in pl]), np.mean([v[0] for v in rl3]), np.mean([v[9] for v in rl3]), P.pd.sum() / (nS * 544), rs.def_pass_defended.sum() / (NSR * 544)))
ipos = P[P.dint > 0].groupby("pos").dint.sum() / P.dint.sum()
print("  INT share by sim position:", ipos.round(3).to_dict())
rip = rs[rs.def_interceptions > 0].groupby("position").def_interceptions.sum() / rs.def_interceptions.sum()
print("  INT share by real position:", rip.round(3).sort_values(ascending=False).head(8).to_dict())

# ---- Kickers
print("\n== KICKERS ==")
sk = P[(P.pos == "K") & (P.fga > 0)]; rk = rs[(rs.position == "K") & (rs.fg_att > 0)]
for nm, d, a, m, a5, m5 in (("sim", sk, "fga", "fgm", "fga50", "fgm50"), ("real", rk, "fg_att", "fg_made", None, None)):
    dd = d[d[a] >= 20]
    pct = 100 * dd[m] / dd[a]
    print(f"  {nm}: kickers (>=20 att) per season {len(dd) / (nS if nm == 'sim' else NSR):.1f}; FG% mean {100 * dd[m].sum() / dd[a].sum():.1f} sd {pct.std():.1f} min {pct.min():.1f} max {pct.max():.1f}; att/K mean {dd[a].mean():.1f} max {dd[a].max()}")
rr50a = (rk.fg_made_50_59 + rk.fg_missed_50_59 + rk.fg_made_60_ + rk.fg_missed_60_).sum() / NSR; rr50m = (rk.fg_made_50_59 + rk.fg_made_60_).sum() / NSR
print(f"  50+ yd: sim att/season {sk.fga50.sum() / nS:.1f} make% {100 * sk.fgm50.sum() / sk.fga50.sum():.1f} ; real att/season {rr50a:.1f} make% {100 * rr50m / rr50a:.1f}")
print(f"  FG att per team-game: sim {sk.fga.sum() / (nS * 544):.2f} real {rk.fg_att.sum() / (NSR * 544):.2f}")

# ---- single game extremes
print("\n== SINGLE-GAME EXTREMES (events per 272-game regular season; sim per-season avg vs real 2023-25 per-season avg) ==")
wk = pd.read_pickle(R + "ps_all.pkl")
def real_cnt(cond): return cond.sum() / NSR
ext = pd.DataFrame([dict(**g["ext"]) for s in seasons for g in s["games"]])
rows = [("QB 400+ pass yds", (ext.pyd >= 400).sum() / nS, real_cnt((wk.passing_yards >= 400))),
        ("QB 350+ pass yds", (ext.pyd >= 350).sum() / nS, real_cnt((wk.passing_yards >= 350))),
        ("QB 5+ pass TD", (ext.ptd >= 5).sum() / nS, real_cnt((wk.passing_tds >= 5))),
        ("QB 4+ pass TD", (ext.ptd >= 4).sum() / nS, real_cnt((wk.passing_tds >= 4))),
        ("QB 4+ INT", (ext.int >= 4).sum() / nS, real_cnt((wk.passing_interceptions >= 4))),
        ("RB 150+ rush yds", (ext.cyd >= 150).sum() / nS, real_cnt(((wk.rushing_yards >= 150) & (wk.position == "RB")))),
        ("RB 200+ rush yds", (ext.cyd >= 200).sum() / nS, real_cnt(((wk.rushing_yards >= 200) & (wk.position == "RB")))),
        ("RB 30+ carries", (ext.car >= 30).sum() / nS, real_cnt(((wk.carries >= 30) & (wk.position == "RB")))),
        ("WR/TE 150+ rec yds", (ext.ryd >= 150).sum() / nS, real_cnt(((wk.receiving_yards >= 150) & wk.position.isin(["WR", "TE", "RB"])))),
        ("WR/TE 200+ rec yds", (ext.ryd >= 200).sum() / nS, real_cnt(((wk.receiving_yards >= 200) & wk.position.isin(["WR", "TE", "RB"])))),
        ("10+ receptions", (ext.rec >= 10).sum() / nS, real_cnt(((wk.receptions >= 10) & wk.position.isin(["WR", "TE", "RB"])))),
        ("12+ receptions", (ext.rec >= 12).sum() / nS, real_cnt(((wk.receptions >= 12) & wk.position.isin(["WR", "TE", "RB"]))))]
for n, a, b in rows: print(f"  {n:22s} sim {a:6.1f}   real {b:6.1f}")
print("  sim single-game maxima across all seasons: pass yds %d, rec yds %d, rush yds %d, receptions %d, rush car %d" % (ext.pyd.max(), ext.ryd.max(), ext.cyd.max(), ext.rec.max(), ext.car.max()))
print("  real maxima 2023-25:     pass yds %d, rec yds %d, rush yds %d, receptions %d, carries %d" % (wk.passing_yards.max(), wk.receiving_yards.max(), wk.rushing_yards.max(), wk.receptions.max(), wk.carries.max()))
