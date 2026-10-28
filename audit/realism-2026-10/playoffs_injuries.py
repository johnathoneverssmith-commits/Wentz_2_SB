import json, glob, sys, numpy as np, pandas as pd
import os; S=os.environ.get("AUDIT_DIR","audit/realism-2026-10/out")+"/"; R=S+"real/"
tal=sys.argv[1]
seasons=[]
for f in sorted(glob.glob(S+f"t{tal}_[0-9].json")): seasons+=json.load(open(f))["seasons"]
n=len(seasons)
print(f"### playoffs+injuries t{tal}: {n} seasons")
rows=[]
for i,s in enumerate(seasons):
    for g in s["playoffs"]: rows.append(dict(season=i,**{k:g[k] for k in("round","home","away","homeSeed","awaySeed","homeScore","awayScore","winner")}))
P=pd.DataFrame(rows); P["m"]=P.homeScore-P.awayScore
real=json.load(open(R+"bench.json"))["playoffs_2018_2025"]
for r,k in (("wildcard","WC"),("divisional","DIV"),("conference","CON"),("superbowl","SB")):
    x=P[P["round"]==r]
    hw=(x.m>0).sum()/max(1,(x.m!=0).sum())
    ls=((x.winner==x.away)&(x.homeSeed<x.awaySeed)).sum()/len(x) if r!="superbowl" else float("nan")
    print(f"{r:11s} n={len(x):4d} home win {hw:.3f} (real {real[k]['home_win']:.3f}) margin sd {x.m.std():.1f} (real {real[k]['margin_sd']:.1f}) total mean {(x.homeScore+x.awayScore).mean():.1f} (real {real[k]['total_mean']:.1f}) ties/forced {int((x.m==0).sum())}")
wc=P[P["round"]=="wildcard"]
print("WC lower-seed win rate by matchup (2v7,3v6,4v5):", {f"{a}v{b}": round(float(((wc.homeSeed==a)&(wc.awaySeed==b)&(wc.winner==wc.away)).sum()/max(1,((wc.homeSeed==a)&(wc.awaySeed==b)).sum())),3) for a,b in((2,7),(3,6),(4,5))})
sb=P[P["round"]=="superbowl"]
champ=pd.Series([s["champion"] for s in seasons])
print("distinct champions over %d seasons: %d ; top champion counts: %s ; max title share %.3f"%(n,champ.nunique(),champ.value_counts().head(5).to_dict(),champ.value_counts().iloc[0]/n))
champseed=[]
for i,s in enumerate(seasons):
    g=[x for x in s["playoffs"] if x["round"]=="superbowl"][0]
    champseed.append(g["homeSeed"] if g["winner"]==g["home"] else g["awaySeed"])
print("champion seed distribution:",pd.Series(champseed).value_counts(normalize=True).sort_index().round(3).to_dict(), " (real 2002-2024: #1 seeds win ~30-35%, #5-7 ~15%)")
# repeat champions
rep=sum(seasons[i]["champion"]==seasons[i+1]["champion"] for i in range(n-1) if True)
print("back-to-back same champion (cross-batch pairs included incorrectly if seeds differ; indicative only):",rep)
# injuries
inj=pd.DataFrame([dict(season=i,**x) for i,s in enumerate(seasons) for x in s["injuries"]])
ng=sum(len(s["games"]) for s in seasons)
print("\ninjuries per game (both teams): %.2f ; per team-game %.2f ; per team-season %.1f"%(len(inj)/ng,len(inj)/ng/2,len(inj)/n/32))
print("severity mix:",inj.sev.value_counts(normalize=True).round(3).to_dict())
inj["mid"]=inj.wk.apply(lambda w:(w[0]+w[1])/2)
inj["games_out"]=np.where(inj.sev=="minor",0.5,inj.mid)
print("expected games missed per team-season (sum of projected weeks midpoint; minor = 0.5): %.1f"%(inj.games_out.sum()/n/32))
print("season-ending share of injuries: %.4f -> per team-season %.2f ; ACL-type 'season' events league-wide per season %.1f"%((inj.sev=="season").mean(),(inj.sev=="season").sum()/n/32,(inj.sev=="season").sum()/n))
print("position mix:",(inj.pos.value_counts(normalize=True)).round(3).to_dict())
qb=inj[inj.pos=="QB"]
print("QB injuries per season (league): %.2f ; QB1 slot: %.2f ; severities: %s"%(len(qb)/n,(qb.slot=="QB1").sum()/n,qb.sev.value_counts().to_dict()))
print("starter injuries per team-season by slot group:",(inj.groupby(inj.slot.str.replace(r"\d","",regex=True)).size()/n/32).round(2).to_dict())
# real injury report
ri=pd.concat([pd.read_csv(R+f"inj_{y}.csv",low_memory=False) for y in(2023,2024,2025)])
ri=ri[ri.game_type=="REG"]
out=ri[ri.report_status=="Out"]
print("\nREAL (nflverse injury report 2023-25): 'Out' player-weeks per team-season: %.1f ; distinct players listed Out per team-season: %.1f"%(len(out)/(3*32),out.drop_duplicates(["season","team","gsis_id"]).shape[0]/(3*32)))
print("   Out by position share:",(out.position.value_counts(normalize=True).head(8)).round(3).to_dict())
qbo=out[out.position=="QB"]
print("   QB 'Out' player-weeks per season (league): %.1f ; distinct QBs out/season %.1f"%(len(qbo)/3,qbo.drop_duplicates(["season","gsis_id"]).shape[0]/3))
