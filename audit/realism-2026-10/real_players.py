import pandas as pd, numpy as np
import os; S = os.environ.get("AUDIT_DIR", "audit/realism-2026-10/out") + "/"
R=S+"real/"
ps=pd.concat([pd.read_csv(R+f"wk_{y}.csv",low_memory=False) for y in (2023,2024,2025)])
ps=ps[ps.season_type=="REG"].copy()
num=[c for c in ps.columns if ps[c].dtype!=object and c not in("season","week")]
ps[num]=ps[num].fillna(0)
ps["fl_total"]=ps.sack_fumbles_lost+ps.rushing_fumbles_lost+ps.receiving_fumbles_lost
ps.to_pickle(R+"ps_all.pkl")
keys=["season","player_id","player_display_name","position","team"]
agg=ps.groupby(keys).agg(**{c:(c,"sum") for c in ["completions","attempts","passing_yards","passing_tds","passing_interceptions","sacks_suffered","carries","rushing_yards","rushing_tds","receptions","targets","receiving_yards","receiving_tds","def_sacks","def_interceptions","def_pass_defended","def_tackles_solo","def_tackle_assists","fg_made","fg_att","fg_made_50_59","fg_made_60_","fg_missed_50_59","fg_missed_60_","fl_total"]},gp=("week","size")).reset_index()
agg.to_pickle(R+"szn.pkl")
print(len(ps),len(agg), ps.week.max())
