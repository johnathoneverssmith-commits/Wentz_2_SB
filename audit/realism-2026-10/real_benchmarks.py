"""Real-NFL benchmarks from nflverse (games.csv 2018-2025; weekly player stats 2023-2025 regular season)."""
import numpy as np, pandas as pd, json, sys
import os; S = os.environ.get("AUDIT_DIR", "audit/realism-2026-10/out") + "/"
R = S + "real/"
g = pd.read_csv(R + "games.csv")
reg = g[(g.game_type == "REG") & g.home_score.notna()]
out = {}

def game_stats(df, label):
    d = {}
    h, a = df.home_score.values, df.away_score.values
    pts = np.concatenate([h, a]); m = h - a
    d["n_games"] = len(df)
    d["pts_per_team_game"] = pts.mean(); d["pts_sd"] = pts.std()
    d["total_mean"] = (h + a).mean(); d["total_sd"] = (h + a).std()
    d["margin_sd"] = m.std(); d["abs_margin_mean"] = np.abs(m).mean()
    d["home_win_pct"] = ((m > 0).sum()) / (m != 0).sum()
    d["home_margin_mean"] = m.mean()
    d["tie_pct"] = (m == 0).mean(); d["ot_pct"] = df.overtime.mean()
    for t in (8, 14, 17, 21, 28): d[f"margin_ge_{t}"] = (np.abs(m) >= t).mean()
    d["one_score_le8"] = (np.abs(m) <= 8).mean()
    d["decided_le3"] = (np.abs(m) <= 3).mean()
    for t in (35, 40, 45, 50): d[f"team_ge_{t}"] = (pts >= t).mean()
    for t in (7, 10, 14): d[f"team_le_{t}"] = (pts <= t).mean()
    d["shutout_pct"] = (pts == 0).mean()
    d["total_ge_60"] = ((h + a) >= 60).mean(); d["total_le_30"] = ((h + a) <= 30).mean()
    # favourite (by spread_line; spread_line > 0 means home favoured)
    s = df.dropna(subset=["spread_line"]); s = s[s.spread_line != 0]
    ms = (s.home_score - s.away_score).values
    fav_home = s.spread_line.values > 0
    fav_margin = np.where(fav_home, ms, -ms)
    dec = fav_margin != 0
    d["fav_win_pct"] = (fav_margin[dec] > 0).mean()
    d["fav_cover_resid_sd"] = np.std(fav_margin - np.abs(s.spread_line.values))
    big = np.abs(s.spread_line.values) >= 7
    d["fav7_win_pct"] = (fav_margin[big & dec] > 0).mean()
    d["fav3_win_pct"] = (fav_margin[(np.abs(s.spread_line.values) <= 3) & dec] > 0).mean()
    # team-season
    rows = []
    for _, r in df.iterrows():
        rows.append((r.season, r.home_team, r.home_score, r.away_score)); rows.append((r.season, r.away_team, r.away_score, r.home_score))
    t = pd.DataFrame(rows, columns=["season", "team", "pf", "pa"])
    t["w"] = (t.pf > t.pa) + 0.5 * (t.pf == t.pa)
    ts = t.groupby(["season", "team"]).agg(w=("w", "sum"), pf=("pf", "sum"), pa=("pa", "sum"), n=("w", "size")).reset_index()
    ts = ts[ts.n >= 16]
    d["win_total_sd"] = ts.w.std(); d["win_ge_13"] = (ts.w >= 13).mean(); d["win_le_4"] = (ts.w <= 4).mean()
    d["win_ge_12"] = (ts.w >= 12).mean(); d["win_le_5"] = (ts.w <= 5).mean()
    d["pf_per_g_sd_between_teams"] = (ts.pf / ts.n).std(); d["pd_per_g_sd"] = ((ts.pf - ts.pa) / ts.n).std()
    d["max_wins_mean"] = ts.groupby("season").w.max().mean(); d["min_wins_mean"] = ts.groupby("season").w.min().mean()
    d["teams_ge_14wins_per_season"] = (ts.w >= 14).sum() / ts.season.nunique()
    out[label] = d

game_stats(reg[reg.season.between(2018, 2025)], "games_2018_2025")
game_stats(reg[reg.season.between(2023, 2025)], "games_2023_2025")

# playoffs
po = g[(g.game_type != "REG") & g.home_score.notna() & g.season.between(2018, 2025)].copy()
p = {}
for gt in ["WC", "DIV", "CON", "SB"]:
    x = po[po.game_type == gt]
    m = (x.home_score - x.away_score)
    nn = x[(m != 0)]
    # SB is neutral; skip home win
    p[gt] = dict(n=len(x), home_win=float(((x.home_score > x.away_score).sum()) / max(1, (m != 0).sum())), margin_sd=float(m.std()), total_mean=float((x.home_score + x.away_score).mean()), ot=float(x.overtime.mean()))
    xs = x.dropna(subset=["spread_line"])
    xs = xs[xs.spread_line != 0]
    fh = xs.spread_line > 0
    fm = np.where(fh, xs.home_score - xs.away_score, xs.away_score - xs.home_score)
    p[gt]["fav_win"] = float((fm[fm != 0] > 0).mean()) if len(fm) else None
out["playoffs_2018_2025"] = p
# SB / playoffs in 2020+ (7 seeds): WC home-team win rate
po20 = po[(po.season >= 2020) & (po.game_type == "WC")]
out["wc_home_win_2020_2025"] = float(((po20.home_score > po20.away_score).sum()) / len(po20))

print(json.dumps(out, indent=1, default=float))
json.dump(out, open(R + "bench.json", "w"), indent=1, default=float)
