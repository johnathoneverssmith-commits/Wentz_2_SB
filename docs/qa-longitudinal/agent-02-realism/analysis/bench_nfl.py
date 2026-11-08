"""Historical NFL benchmarks from nflverse (CC-BY 4.0 data), downloaded to NFLV_DIR:
 games.csv  (raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv)
 pbp_{2021..2024}.csv.gz (github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_YYYY.csv.gz)
 ps_{2018..2024}.csv (…/releases/download/player_stats/stats_player_reg_YYYY.csv)
Window: 2021-2024 regular season = the 17-game, 32-team format (n=4 seasons x 272 games). Output: nfl_benchmarks.json"""
import json, sys, os
import numpy as np, pandas as pd
D = os.environ.get("NFLV_DIR", "/tmp/nflv")
Y = [2021, 2022, 2023, 2024]
out = {"sources": "nflverse games.csv, play_by_play 2021-24, player_stats 2018-24; reg season; 17-game era 2021-24", "n_seasons": len(Y)}

g = pd.read_csv(f"{D}/games.csv")
g = g[(g.season.isin(Y)) & (g.game_type == "REG")]
out["n_games"] = int(len(g))
pts = pd.concat([g.home_score, g.away_score])
out["points_per_team_game"] = float(pts.mean()); out["points_sd"] = float(pts.std())
out["margin_sd"] = float((g.home_score - g.away_score).std())
out["total_mean"] = float((g.home_score + g.away_score).mean())
out["home_win_pct"] = float(((g.home_score > g.away_score) + 0.5 * (g.home_score == g.away_score)).mean())
out["home_margin_mean"] = float((g.home_score - g.away_score).mean())
out["ot_rate"] = float((g.overtime == 1).mean())
out["tie_rate"] = float((g.home_score == g.away_score).mean())
out["pts_pctl"] = {str(q): float(np.percentile(pts, q)) for q in (1, 5, 10, 25, 50, 75, 90, 95, 99)}
out["pts_ge45_total_rate"] = float(((g.home_score + g.away_score) >= 60).mean())
out["shutout_team_rate"] = float((pts == 0).mean())
out["pts_ge40_rate"] = float((pts >= 40).mean())
out["margin_ge21_rate"] = float(((g.home_score - g.away_score).abs() >= 21).mean())
out["margin_le3_rate"] = float(((g.home_score - g.away_score).abs() <= 3).mean())
# which team-game scores never occur in the NFL context (counts of single scores)
vc = pts.value_counts()
out["score_counts"] = {str(k): int(vc.get(k, 0)) for k in range(0, 50)}
# team wins by season
rows = []
for s, d in g.groupby("season"):
    w = {}
    for _, r in d.iterrows():
        for t, f, a in ((r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)):
            w.setdefault(t, [0, 0, 0]); w[t][0 if f > a else 1 if f < a else 2] += 1
    for t, (a, b, c) in w.items(): rows.append((s, t, a + 0.5 * c, b + 0.5 * c, a, b, c))
W = pd.DataFrame(rows, columns=["season", "team", "w", "l", "W", "L", "T"])
out["wins_sd"] = float(W.groupby("season").w.std().mean())
out["wins_ge13_per_season"] = float((W.w >= 13).sum() / len(Y)); out["wins_le4_per_season"] = float((W.w <= 4).sum() / len(Y))
out["wins_ge14_per_season"] = float((W.w >= 14).sum() / len(Y)); out["wins_le3_per_season"] = float((W.w <= 3).sum() / len(Y))
out["wins_pctl"] = {str(q): float(np.percentile(W.w, q)) for q in (5, 25, 50, 75, 95)}
# season-to-season persistence
W2 = W.sort_values(["team", "season"]); W2["prev"] = W2.groupby("team").w.shift(1)
x = W2.dropna(subset=["prev"]); out["win_autocorr_yr_to_yr"] = float(np.corrcoef(x.w, x.prev)[0, 1])
out["abs_win_change_yr_to_yr"] = float((x.w - x.prev).abs().mean())
# playoff-team turnover: share of last year's non-playoff... approximated by top-7-per-conf is unavailable; use top 14 by wins
# points-for sd across teams
pf = []
for s, d in g.groupby("season"):
    pf_t = {}
    for _, r in d.iterrows():
        pf_t[r.home_team] = pf_t.get(r.home_team, 0) + r.home_score; pf_t[r.away_team] = pf_t.get(r.away_team, 0) + r.away_score
    pf.append(np.std(list(pf_t.values())) / 17)
out["team_ppg_sd_across_teams"] = float(np.mean(pf))

# play by play
P = pd.concat([pd.read_csv(f"{D}/pbp_{y}.csv.gz", low_memory=False, usecols=lambda c: c in {
    "game_id", "season_type", "play_type", "down", "ydstogo", "yardline_100", "posteam", "defteam", "qtr", "touchdown", "safety",
    "two_point_attempt", "two_point_converted", "two_point_conv_result", "field_goal_attempt", "field_goal_result", "kick_distance",
    "extra_point_attempt", "extra_point_result", "interception", "fumble_lost", "penalty", "penalty_yards", "sack", "return_touchdown",
    "pass_touchdown", "rush_touchdown", "fourth_down_converted", "fourth_down_failed", "yards_gained", "pass_attempt", "rush_attempt",
    "complete_pass", "qb_dropback", "score_differential", "game_seconds_remaining", "punt_attempt", "air_yards", "wp", "special_teams_play",
    "kickoff_attempt", "fumble", "td_team", "posteam_type"}) for y in Y])
P = P[P.season_type == "REG"]
ng = P.game_id.nunique(); ntg = ng * 2
out["pbp_games"] = int(ng)
out["safeties_per_game"] = float(P.safety.sum() / ng)
out["two_pt_att_per_game"] = float(P.two_point_attempt.sum() / ng)
out["two_pt_conv_rate"] = float((P.two_point_conv_result=="success").sum() / max(1, P.two_point_attempt.sum()))
out["fg_att_per_team_game"] = float(P.field_goal_attempt.sum() / ntg)
out["fg_pct"] = float((P.field_goal_result == "made").sum() / max(1, P.field_goal_attempt.sum()))
fga = P[P.field_goal_attempt == 1]
out["fg_pct_by_dist"] = {k: float((d.field_goal_result == "made").mean()) for k, d in fga.groupby(pd.cut(fga.kick_distance, [0, 29, 39, 49, 70]).astype(str))}
out["fg_att_by_dist_share"] = {k: float(len(d) / len(fga)) for k, d in fga.groupby(pd.cut(fga.kick_distance, [0, 29, 39, 49, 70]).astype(str))}
out["xp_att_per_team_game"] = float(P.extra_point_attempt.sum() / ntg)
out["xp_pct"] = float((P.extra_point_result == "good").sum() / max(1, P.extra_point_attempt.sum()))
tds = P[P.touchdown == 1]
out["td_per_team_game"] = float(len(tds) / ntg)
out["int_per_team_game"] = float(P.interception.sum() / ntg)
out["fumble_lost_per_team_game"] = float(P.fumble_lost.sum() / ntg)
out["turnovers_per_team_game"] = out["int_per_team_game"] + out["fumble_lost_per_team_game"]
out["sacks_per_team_game"] = float(P["sack"].sum() / ntg)
out["penalties_per_team_game"] = float(P.penalty.sum() / ntg)
out["penalty_yards_per_team_game"] = float(P.loc[P.penalty == 1, "penalty_yards"].sum() / ntg)
out["pass_att_per_team_game"] = float(P.pass_attempt.sum() / ntg); out["rush_att_per_team_game"] = float(P.rush_attempt.sum() / ntg)
pa = P[P.pass_attempt == 1]
out["completion_pct"] = float(pa.complete_pass.mean()); out["ypa"] = float(pa.yards_gained.mean())
ra = P[(P.rush_attempt == 1)]
out["ypc"] = float(ra.yards_gained.mean())
out["explosive_pass_20plus_per_team_game"] = float((pa.yards_gained >= 20).sum() / ntg)
out["explosive_run_10plus_per_team_game"] = float((ra.yards_gained >= 10).sum() / ntg)
# defensive scores: interception returns & fumble returns TD with defense scoring
dtd = P[(P.touchdown == 1) & (P.td_team == P.defteam)]
out["def_td_per_team_game"] = float(len(dtd) / ntg)
out["pick6_per_team_game"] = float(len(dtd[dtd.interception == 1]) / ntg)
out["kick_return_td_per_team_game"] = float(len(P[(P.touchdown == 1) & (P.special_teams_play == 1) & (P.td_team == P.defteam) & ((P.kickoff_attempt == 1))]) / ntg)
out["punt_return_td_per_team_game"] = float(len(P[(P.touchdown == 1) & (P.punt_attempt == 1) & (P.td_team == P.defteam)]) / ntg)
# fourth down: go rate by situation (offense, scrimmage plays or punts/FG)
f4 = P[(P.down == 4) & (P.play_type.isin(["pass", "run", "punt", "field_goal"]))].copy()
f4["go"] = f4.play_type.isin(["pass", "run"])
out["fourth_downs_per_team_game"] = float(len(f4) / ntg)
out["fourth_go_rate_overall"] = float(f4.go.mean())
out["fourth_go_conv"] = float(f4[f4.go].fourth_down_converted.fillna(0).mean())
def band(df, name, cond): 
    d = df[cond(df)]; return {"n": int(len(d)), "go": float(d.go.mean()), "fg": float((d.play_type == "field_goal").mean()), "punt": float((d.play_type == "punt").mean())}
out["fourth_situations"] = {
    "own_territory_4th_long(>5 to go, yl>60)": band(f4, "a", lambda d: (d.yardline_100 > 60) & (d.ydstogo > 5)),
    "midfield_short(1-2 to go,40<yl<=60)": band(f4, "b", lambda d: (d.yardline_100 > 40) & (d.yardline_100 <= 60) & (d.ydstogo <= 2)),
    "fg_range_4th_and_1(yl 20-35)": band(f4, "c", lambda d: (d.yardline_100 <= 35) & (d.yardline_100 >= 20) & (d.ydstogo <= 1)),
    "redzone_4th_and_goal(yl<=5)": band(f4, "d", lambda d: (d.yardline_100 <= 5)),
    "fg_range_4th_long(>=7 to go, yl<=35)": band(f4, "e", lambda d: (d.yardline_100 <= 35) & (d.ydstogo >= 7)),
}
# red zone TD rate per drive entry (approx: drives with a play inside the 20)
rz = P[(P.yardline_100 <= 20) & P.posteam.notna() & P.play_type.isin(["pass", "run", "field_goal"])]
rzd = rz.groupby(["game_id", "posteam", "qtr"]).agg(td=("touchdown", "max")).reset_index()
out["rz_td_per_trip_approx"] = float(rzd.td.mean())
# per-game scoring forms
scores_by_game = []
out["td_share_of_points"] = None
json.dump(out, open(os.environ.get("OUT", "nfl_benchmarks.json"), "w"), indent=1)

# player seasons
PS = pd.concat([pd.read_csv(f"{D}/ps_{y}.csv") for y in range(2018, 2025)])
PS = PS[PS.season_type == "REG"]
def lead(df, col, n=1): return df.groupby("season")[col].apply(lambda s: s.nlargest(n).tolist())
pl = {}
qb = PS[(PS.position == "QB") & (PS.attempts >= 200)].copy()
qb["g17"] = qb.games.clip(lower=1)
for c in ["attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions", "sacks_suffered", "carries", "rushing_yards", "rushing_tds"]:
    qb[c + "_pg"] = qb[c] / qb.g17
qb["cmp"] = qb.completions / qb.attempts; qb["ypa"] = qb.passing_yards / qb.attempts; qb["int_pct"] = qb.passing_interceptions / qb.attempts; qb["td_pct"] = qb.passing_tds / qb.attempts
pl["QB_n"] = int(len(qb)); 
for c in ["attempts_pg", "cmp", "ypa", "int_pct", "td_pct", "sacks_suffered_pg", "carries_pg", "rushing_yards_pg"]:
    pl["QB_" + c] = {"mean": float(qb[c].mean()), "sd": float(qb[c].std()), "p10": float(qb[c].quantile(.1)), "p90": float(qb[c].quantile(.9))}
pl["QB_passyds_max_by_season"] = {int(s): float(v) for s, v in PS[PS.position == "QB"].groupby("season").passing_yards.max().items()}
pl["QB_5000yd_seasons_2018_24"] = int((PS[PS.position == "QB"].passing_yards >= 5000).sum())
pl["QB_4000yd_per_season"] = float((PS[PS.position == "QB"].passing_yards >= 4000).sum() / 7)
pl["QB_40td_seasons_2018_24"] = int((PS[PS.position == "QB"].passing_tds >= 40).sum())
pl["QB_attempts_gt_200_per_season"] = float(len(qb) / 7)
rb = PS[(PS.position == "RB") & (PS.carries >= 50)].copy()
for c in ["carries", "rushing_yards", "rushing_tds", "targets", "receptions", "receiving_yards"]:
    pl["RB_" + c] = {"mean": float(rb[c].mean()), "p90": float(rb[c].quantile(.9)), "max": float(rb[c].max())}
pl["RB_1000yd_per_season"] = float((PS[PS.position == "RB"].rushing_yards >= 1000).sum() / 7)
pl["RB_top_carries_by_season"] = {int(s): float(v) for s, v in PS[PS.position == "RB"].groupby("season").carries.max().items()}
pl["RB_top_ypc_min100car"] = float(PS[(PS.position == "RB") & (PS.carries >= 100)].eval("rushing_yards/carries").max())
wr = PS[PS.position == "WR"]
pl["WR_1000yd_per_season"] = float((wr.receiving_yards >= 1000).sum() / 7)
pl["WR_1500yd_per_season"] = float((wr.receiving_yards >= 1500).sum() / 7)
pl["WR_10td_per_season"] = float((wr.receiving_tds >= 10).sum() / 7)
te = PS[PS.position == "TE"]
pl["TE_800yd_per_season"] = float((te.receiving_yards >= 800).sum() / 7)
pl["TE_1000yd_per_season"] = float((te.receiving_yards >= 1000).sum() / 7)
alln = PS[PS.position.isin(["WR", "TE", "RB"])]
pl["rec_leader_yards_by_season"] = {int(s): float(v) for s, v in alln.groupby("season").receiving_yards.max().items()}
pl["sack_leader_by_season"] = {int(s): float(v) for s, v in PS.groupby("season").sacks_suffered.max().items()}
d = PS[PS.position_group.isin(["DL", "LB", "DB"])]
pl["def_sacks_leader_by_season"] = {int(s): float(v) for s, v in d.groupby("season").def_sacks.max().items()}
pl["def_sacks_10plus_per_season"] = float((d.def_sacks >= 10).sum() / 7)
pl["def_int_leader_by_season"] = {int(s): float(v) for s, v in d.groupby("season").def_interceptions.max().items()}
pl["def_int_5plus_per_season"] = float((d.def_interceptions >= 5).sum() / 7)
pl["def_tackles_solo_leader_by_season"] = {int(s): float((d.groupby('season').def_tackles_solo.max()).loc[s]) for s in range(2018, 2025)}
k = PS[PS.position == "K"]
pl["K_fg_att_mean_k20plus"] = float(k[k.fg_att >= 15].fg_att.mean()); pl["K_fg_pct"] = float(k.fg_made.sum() / k.fg_att.sum())
pl["K_fg_pct_sd_between_k"] = float((k[k.fg_att >= 15].fg_made / k[k.fg_att >= 15].fg_att).std())
out["players"] = pl
json.dump(out, open(os.environ.get("OUT", "nfl_benchmarks.json"), "w"), indent=1)
print(json.dumps(out, indent=1)[:6000])
