import os, sys
import json,numpy as np,pandas as pd
import os; S=os.environ.get("AUDIT_DIR","audit/realism-2026-10/out")+"/"
cols=["game","team","qtr","clock","down","ydstogo","ballOn","call","outcome","gained","diff","dist","td","to"]
def sim(t):
    d=pd.DataFrame(json.load(open(S+f"trace_t{t}.json")),columns=cols)
    return d
rp=pd.concat([pd.read_parquet(S+f"real/pbp_{y}.parquet",columns=["season_type","game_id","posteam","qtr","down","ydstogo","yardline_100","play_type","pass","rush","qb_scramble","qb_kneel","qb_spike","sack","score_differential","kick_distance","field_goal_result","two_point_attempt","safety","touchdown","interception","fumble_lost","half_seconds_remaining","game_seconds_remaining","wp","penalty","play_deleted","punt_blocked","field_goal_attempt"]).assign(season=y) for y in (2023,2024)])
rp=rp[(rp.season_type=="REG")&rp.posteam.notna()&(rp.play_deleted==0)]
ngames_real=rp.game_id.nunique()
print("real games",ngames_real)
def real_class(r):
    pass
R=pd.DataFrame({"qtr":rp.qtr,"down":rp.down,"ydstogo":rp.ydstogo,"yl":rp.yardline_100,"diff":rp.score_differential,
 "dropback":((rp["pass"]==1)|(rp.qb_scramble==1)).astype(int),"run":((rp.rush==1)&(rp.qb_scramble==0)&(rp.qb_kneel==0)).astype(int),
 "pt":rp.play_type,"kneel":rp.qb_kneel,"fgdist":rp.kick_distance,"fgres":rp.field_goal_result,"gsr":rp.game_seconds_remaining,"wp":rp.wp})
R["scrim"]=R.dropback+R.run
def simD(t):
    d=sim(t)
    out=pd.DataFrame({"qtr":d.qtr,"down":d.down,"ydstogo":d.ydstogo,"yl":d.ballOn,"diff":d["diff"],"dropback":d.call.isin(["pass","sack","scramble"]).astype(int),"run":(d.call=="run").astype(int),
        "pt":np.where(d.call=="punt","punt",np.where(d.call=="field_goal","field_goal",np.where(d.call.isin(["pass","sack","scramble"]),"pass","run"))),"fgdist":d.dist,"fgres":d.outcome,"gained":d.gained,"game":d.game})
    out["scrim"]=out.dropback+out.run
    return out
def pass_rate_table(D,label):
    x=D[(D.scrim==1)&(D.down.isin([1,2,3,4]))]
    rows={}
    def pr(m): return x[m].dropback.mean() if m.sum()>200 else np.nan
    rows["Q1-3 |diff|<=3"]=pr((x.qtr<=3)&(x["diff"].abs()<=3))
    rows["Q1-3 lead 4-14"]=pr((x.qtr<=3)&(x["diff"].between(4,14)))
    rows["Q1-3 trail 4-14"]=pr((x.qtr<=3)&(x["diff"].between(-14,-4)))
    rows["Q4 lead 8+"]=pr((x.qtr==4)&(x["diff"]>=8))
    rows["Q4 trail 1-8"]=pr((x.qtr==4)&(x["diff"].between(-8,-1)))
    rows["Q4 trail 9-16"]=pr((x.qtr==4)&(x["diff"].between(-16,-9)))
    rows["Q4 trail 17+"]=pr((x.qtr==4)&(x["diff"]<=-17))
    rows["1st&10"]=pr((x.down==1)&(x.ydstogo==10)&(x.qtr<=3)&(x["diff"].abs()<=7))
    rows["3rd&1-3"]=pr((x.down==3)&(x.ydstogo<=3)); rows["3rd&7+"]=pr((x.down==3)&(x.ydstogo>=7))
    rows["overall dropback rate"]=x.dropback.mean()
    return pd.Series(rows,name=label)
tbl=pd.concat([pass_rate_table(R,"real 23-24"),pass_rate_table(simD("10"),"sim t1.0"),pass_rate_table(simD("15"),"sim t1.5")],axis=1)
print("\nDROPBACK RATE by situation\n",tbl.round(3).to_string())
def fourth(D,real=False):
    x=D[D.down==4]
    x=x[x.pt.isin(["pass","run","punt","field_goal"]) if not real else x.pt.isin(["pass","run","punt","field_goal"])]
    go=x.pt.isin(["pass","run"])
    def rate(m): return go[m].mean() if m.sum()>100 else np.nan
    r={}
    r["4th&1-2, opp territory (yl<=50) |diff|<=8"]=rate((x.ydstogo<=2)&(x.yl<=50)&(x.yl>=20)&(x["diff"].abs()<=8))
    r["4th&1-2 own side (yl>50)"]=rate((x.ydstogo<=2)&(x.yl>50)&(x["diff"].abs()<=8))
    r["4th&3-5, yl 20-50"]=rate((x.ydstogo.between(3,5))&(x.yl.between(20,50))&(x["diff"].abs()<=8))
    r["4th&6+, yl<=50"]=rate((x.ydstogo>=6)&(x.yl<=50))
    r["4th, inside 5, any dist"]=rate((x.yl<=5))
    r["4th, Q4 trail 9+ (desperation)"]=rate((x.qtr==4)&(x["diff"]<=-9))
    r["4th overall go rate"]=go.mean()
    g=D.game.nunique() if not real else ngames_real
    r["4th downs per team-game"]=len(x)/(2*g)
    r["go attempts per team-game"]=go.sum()/(2*g)
    return pd.Series(r)
t4=pd.concat([fourth(R,True).rename("real 23-24"),fourth(simD("10")).rename("sim t1.0"),fourth(simD("15")).rename("sim t1.5")],axis=1)
print("\nFOURTH DOWN\n",t4.round(3).to_string())
def fg(D,real=False):
    x=D[(D.pt=="field_goal")]
    if real: x=x[x.fgres.notna()]; made=x.fgres=="made"; dist=x.fgdist
    else: made=x.fgres=="made"; dist=x.fgdist
    r={}
    for lo,hi in((0,29),(30,39),(40,49),(50,70)):
        m=dist.between(lo,hi); r[f"{lo}-{hi}: share"]=m.mean(); r[f"{lo}-{hi}: make%"]=made[m].mean()
    r["FG att/team-game"]=len(x)/(2*(D.game.nunique() if not real else ngames_real))
    return pd.Series(r)
RR=R.copy(); RR["game"]=0
tg=pd.concat([fg(R,True).rename("real 23-24"),fg(simD("10")).rename("sim t1.0"),fg(simD("15")).rename("sim t1.5")],axis=1)
print("\nFIELD GOALS\n",tg.round(3).to_string())
# clock: kneels & end-of-half? 
for t in ("10",):
    D=simD(t)
    print("\nsim: plays per game", len(D)/D.game.nunique(), " scrimmage:", D.scrim.sum()/D.game.nunique())
print("real: scrimmage plays per game", R.scrim.sum()/ngames_real, "(dropbacks+designed runs, excl kneels)")
