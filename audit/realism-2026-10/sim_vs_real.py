import json, glob, sys, numpy as np, pandas as pd
import os; S = os.environ.get("AUDIT_DIR", "audit/realism-2026-10/out") + "/"
R = S + "real/"
tal = sys.argv[1]
files = sorted(glob.glob(S + f"t{tal}_[0-9].json"))
seasons = []
for f in files: seasons += json.load(open(f))["seasons"]
print(f"### talent file group t{tal}: {len(files)} files, {len(seasons)} seasons, {sum(len(s['games']) for s in seasons)} games\n")
real = json.load(open(R + "bench.json"))["games_2018_2025"]
real23 = json.load(open(R + "bench.json"))["games_2023_2025"]

def line(name, sim, rl, fmt="{:.3f}"):
    rs = fmt.format(rl) if rl is not None else "-"
    rel = f"{(sim - rl) / rl * 100:+.1f}%" if rl not in (None, 0) else ""
    print(f"{name:34s} sim {fmt.format(sim):>9s}   real {rs:>9s}  {rel}")

G = pd.DataFrame([dict(season=i, **{k: g[k] for k in ("w", "h", "a", "hs", "as", "ot", "plays")}, lh=g["lead"]["h"], la=g["lead"]["a"]) for i, s in enumerate(seasons) for g in s["games"]])
G["m"] = G.hs - G["as"]
pts = np.concatenate([G.hs, G["as"]])
print("== GAME LEVEL (sim vs nflverse 2018-2025 REG) ==")
line("points/team-game", pts.mean(), real["pts_per_team_game"])
line("points sd", pts.std(), real["pts_sd"])
line("total points mean", (G.hs + G["as"]).mean(), real["total_mean"])
line("total points sd", (G.hs + G["as"]).std(), real["total_sd"])
line("margin sd", G.m.std(), real["margin_sd"])
line("mean |margin|", G.m.abs().mean(), real["abs_margin_mean"])
line("home win % (non-tie)", (G.m > 0).sum() / (G.m != 0).sum(), real["home_win_pct"])
line("home margin mean", G.m.mean(), real["home_margin_mean"])
line("tie %", (G.m == 0).mean(), real["tie_pct"], "{:.4f}")
line("OT %", G.ot.mean(), real["ot_pct"])
for t in (8, 14, 17, 21, 28): line(f"|margin| >= {t}", (G.m.abs() >= t).mean(), real[f"margin_ge_{t}"])
line("one score (<=8)", (G.m.abs() <= 8).mean(), real["one_score_le8"])
line("decided by <=3", (G.m.abs() <= 3).mean(), real["decided_le3"])
for t in (35, 40, 45, 50): line(f"team >= {t}", (pts >= t).mean(), real[f"team_ge_{t}"], "{:.4f}")
for t in (7, 10, 14): line(f"team <= {t}", (pts <= t).mean(), real[f"team_le_{t}"])
line("shutouts", (pts == 0).mean(), real["shutout_pct"], "{:.4f}")
line("total >= 60", ((G.hs + G["as"]) >= 60).mean(), real["total_ge_60"])
line("total <= 30", ((G.hs + G["as"]) <= 30).mean(), real["total_le_30"])
print("max single-team score:", pts.max(), " max total:", (G.hs + G["as"]).max(), " max margin:", G.m.abs().max())
rg = pd.read_csv(R + "games.csv"); rg = rg[(rg.game_type == "REG") & rg.home_score.notna() & rg.season.between(2018, 2025)]
rp = np.concatenate([rg.home_score, rg.away_score])
print("real max single-team score:", rp.max(), " real max total:", (rg.home_score + rg.away_score).max(), " real max |margin|:", (rg.home_score - rg.away_score).abs().max())
# impossible / rare scores
for sc in (1, 2, 4, 5, 8, 11):
    print(f"  final score == {sc}: sim {(pts == sc).mean() * 100:.3f}%   real {(rp == sc).mean() * 100:.3f}%")
print("  score distribution mod: P(score in {3,6,7,10,13,14,17,20,21,24,27,28}) sim %.3f real %.3f" % (np.isin(pts, [3, 6, 7, 10, 13, 14, 17, 20, 21, 24, 27, 28]).mean(), np.isin(rp, [3, 6, 7, 10, 13, 14, 17, 20, 21, 24, 27, 28]).mean()))
print("  max lead blown & won: games where team led by >=17 and lost: sim %.4f" % (((G.lh >= 17) & (G.m < 0)).mean() + ((G.la >= 17) & (G.m > 0)).mean()))

# ---- team seasons
rows = []
for i, s in enumerate(seasons):
    t = {}
    for g in s["games"]:
        for tm, pf, pa in ((g["h"], g["hs"], g["as"]), (g["a"], g["as"], g["hs"])):
            r = t.setdefault(tm, [0, 0, 0, 0]); r[0] += (pf > pa) + 0.5 * (pf == pa); r[1] += pf; r[2] += pa; r[3] += 1
    for tm, r in t.items(): rows.append(dict(season=i, team=tm, w=r[0], pf=r[1], pa=r[2], n=r[3]))
T = pd.DataFrame(rows)
print("\n== TEAM SEASONS ==")
line("win total sd", T.w.std(), real["win_total_sd"])
line("wins >= 13", (T.w >= 13).mean(), real["win_ge_13"])
line("wins >= 12", (T.w >= 12).mean(), real["win_ge_12"])
line("wins <= 4", (T.w <= 4).mean(), real["win_le_4"])
line("wins <= 5", (T.w <= 5).mean(), real["win_le_5"])
line("PF/g sd (team-seasons)", (T.pf / T.n).std(), real["pf_per_g_sd_between_teams"])
line("pt diff/g sd (team-seasons)", ((T.pf - T.pa) / T.n).std(), real["pd_per_g_sd"])
line("max wins per season (mean)", T.groupby("season").w.max().mean(), real["max_wins_mean"])
line("min wins per season (mean)", T.groupby("season").w.min().mean(), real["min_wins_mean"])
line("teams >=14 wins per season", (T.w >= 14).sum() / len(seasons), real["teams_ge_14wins_per_season"])
print("  undefeated/winless seasons: ", int((T.w >= 17).sum()), int((T.w <= 0).sum()), " of ", len(T))
# persistence: season-to-season win correlation for same roster (reference rosters are fixed, so this is the 'true strength' share)
tm_mean = T.groupby("team").w.mean()
print("  sd of team mean wins (fixed rosters => true strength spread): %.2f ; ranges %.1f .. %.1f" % (tm_mean.std(), tm_mean.min(), tm_mean.max()))
exp_noise = np.sqrt((T.w - T.team.map(tm_mean)).pow(2).mean())
print("  within-team season-to-season win sd (luck): %.2f" % exp_noise)

# favourites: leave-one-season-out team strength
sm = {}
for i, s in enumerate(seasons):
    for g in s["games"]:
        for tm, d in ((g["h"], g["hs"] - g["as"]), (g["a"], g["as"] - g["hs"])):
            sm.setdefault(tm, []).append((i, d))
hfa = G.m.mean()
def strength(tm, excl):
    xs = [d for (i, d) in sm[tm] if i != excl]; return np.mean(xs)
pred = np.array([strength(r.h, r.season) - strength(r.a, r.season) + hfa for r in G.itertuples()])
dec = G.m != 0
favwin = np.where(pred > 0, G.m > 0, G.m < 0)
print("\n== FAVOURITES (leave-one-season-out strength + HFA as 'spread') ==")
line("favourite win % (all)", favwin[dec].mean(), real["fav_win_pct"])
for lo, hi, nm, rk in ((7, 99, ">=7", "fav7_win_pct"), (0, 3.01, "<=3", "fav3_win_pct")):
    mk = (np.abs(pred) >= lo) & (np.abs(pred) <= hi) & dec
    line(f"fav win % |spread| {nm}", favwin[mk].mean(), real[rk])
    print(f"      share of games in bucket: sim {mk.mean():.3f}")
print("  sd of predicted spread: %.2f (real spread_line sd: %.2f)" % (pred.std(), rg.spread_line.dropna().std()))
slope = np.polyfit(pred, G.m, 1)[0]
print("  slope actual margin ~ predicted: %.2f ; residual sd %.2f (real cover residual sd 12.77)" % (slope, (G.m - np.polyval(np.polyfit(pred, G.m, 1), pred)).std()))
# upsets: underdog by >=7 wins
mk = (pred.__abs__() >= 7)
print("  big underdogs (spread>=7) win %%: sim %.3f ; real %.3f" % (1 - favwin[mk & dec].mean(), 1 - real["fav7_win_pct"]))

# ---- team-game box stats
print("\n== TEAM-GAME BOX STATS ==")
rows = []
for s in seasons:
    for g in s["games"]:
        for side, op in (("H", "A"), ("A", "H")):
            r = dict(g[side]); r["t3c"], r["t3a"] = r["t3"]; r["rzt"], r["rza"] = r["rz"][0], r["rz"][1]
            r["opp_pts"] = g[op]["pts"]; rows.append(r)
B = pd.DataFrame(rows)
ps = pd.read_pickle(R + "ps_all.pkl")
tg = ps.groupby(["season", "week", "team"]).agg(att=("attempts", "sum"), cmp=("completions", "sum"), py=("passing_yards", "sum"), ptd=("passing_tds", "sum"), int_=("passing_interceptions", "sum"),
                                                       sk=("sacks_suffered", "sum"), ca=("carries", "sum"), ry=("rushing_yards", "sum"), rtd=("rushing_tds", "sum"), fl=("fl_total", "sum")).reset_index()
tg = tg[tg.att > 5]
tg["ypa"] = tg.py / tg.att
print("(real = nflverse 2023-25 team-games, n=%d; real carries INCLUDE QB scrambles)" % len(tg))
def row(name, sv, rv, fmt="{:.2f}"):
    print(f"{name:30s} sim mean {fmt.format(sv.mean()):>8s} sd {fmt.format(sv.std()):>7s} | real mean {fmt.format(rv.mean()):>8s} sd {fmt.format(rv.std()):>7s} | p95 sim {np.percentile(sv, 95):7.1f} real {np.percentile(rv, 95):7.1f} | max sim {sv.max():6.0f} real {rv.max():6.0f}")
row("pass attempts", B.pa, tg.att); row("completions", B.cmp, tg.cmp); row("pass yards", B.py, tg.py)
row("yards/attempt", B.py / B.pa, tg.ypa); row("rush att (designed only in sim)", B.ra, tg.ca); row("rush yards (designed only)", B.ry, tg.ry)
row("sacks taken", B.sk, tg.sk); row("interceptions", B.int, tg.int_); row("fumbles lost", B.fl, tg.fl)
row("turnovers (int+fl)", B.to, tg.int_ + tg.fl)
row("points", B.pts, pd.Series(rp), "{:.1f}")
print("turnover games: P(0 TO) sim %.3f ; P(>=4 TO) sim %.4f   [real P(0 turnovers) approx 0.31, >=4 approx 0.03 — from int+fl in ps]" % ((B.to == 0).mean(), (B.to >= 4).mean()))
print("   real P(0 TO) %.3f ; real P(>=4 TO) %.4f" % (((tg.int_ + tg.fl) == 0).mean(), ((tg.int_ + tg.fl) >= 4).mean()))
print("sim 3rd-down conv %.3f ; qb hits/gm %.2f ; penalties %.2f ; first downs %.1f ; drives %.2f ; TOP sec %.0f ; kr td/g %.4f ; pr td/g %.4f" % (B.t3c.sum() / B.t3a.sum(), B.qbh.mean(), B.pen.mean(), B.fd.mean(), B.drv.mean(), B.top.mean(), B.krtd.mean(), B.prtd.mean()))
print("sim plays/game (both teams scrimmage trace): mean %.1f" % G.plays.mean())
print("pass rate (att / (att+designed rush)) sim %.3f" % ((B.pa.sum()) / (B.pa.sum() + B.ra.sum())))
print("pass yds + rush yds per team-game sim %.1f ; real %.1f" % ((B.py + B.ry).mean(), (tg.py + tg.ry).mean()))
# invariants
print("\n== INVARIANTS ==")
bad_pts = ((B.pts - 6 * B.td - 3 * B.fg) < 0).sum()
rem = B.pts - 6 * B.td - 3 * B.fg
print("team-games with pts < 6*TD+3*FG:", int(bad_pts), " remainder (xp/2pt/safety) range: ", int(rem.min()), "..", int(rem.max()), " remainder > td+... flagged (rem > td*2+4):", int((rem > B.td * 2 + 4).sum()))
gd = pd.DataFrame([abs(g["H"]["drv"] - g["A"]["drv"]) for s in seasons for g in s["games"]])[0]
print("drive count difference |H-A| distribution:", gd.value_counts().sort_index().to_dict())
print("TOP sum per game (sec) mean %.0f max %.0f ; games with TOP sum > 3600+? : %d" % (pd.Series([g['H']['top'] + g['A']['top'] for s in seasons for g in s['games']]).mean(), max(g['H']['top'] + g['A']['top'] for s in seasons for g in s['games']), sum((g['H']['top'] + g['A']['top']) > 4300 for s in seasons for g in s['games'])))
print("ties:", int((G.m == 0).sum()), "OT games:", int(G.ot.sum()), " OT end of tie share:", (G[G.ot == 1].m == 0).mean())
# OT scoring sanity
print("OT games home win %% %.3f" % ((G[G.ot == 1].m > 0).sum() / max(1, (G[G.ot == 1].m != 0).sum())))
