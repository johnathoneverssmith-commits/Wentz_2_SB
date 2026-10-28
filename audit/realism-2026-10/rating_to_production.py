import json,glob,sys,numpy as np,pandas as pd
import os; S=os.environ.get("AUDIT_DIR","audit/realism-2026-10/out")+"/"
tal=sys.argv[1]
seasons=[]
for f in sorted(glob.glob(S+f"t{tal}_[0-9].json")): seasons+=json.load(open(f))["seasons"]
P=pd.DataFrame([dict(season=i,**p) for i,s in enumerate(seasons) for p in s["players"]]).fillna(0)
A=P.groupby(["team","name","pos"]).agg(ovr=("ovr","first"),n=("g","size"),g=("g","sum"),**{c:(c,"sum") for c in ["att","cmp","pyd","ptd","int","sacked","car","cyd","ctd","tgt","rec","ryd","rtd","sack","dint","pd","fga","fgm","tkl","scr"]}).reset_index()
pd.set_option("display.width",200)
qb=A[(A.pos=="QB")&(A.att>3000)].copy()
qb["cmp%"]=100*qb.cmp/qb.att; qb["ypa"]=qb.pyd/qb.att; qb["int%"]=100*qb.int/qb.att; qb["td%"]=100*qb.ptd/qb.att; qb["sk%"]=100*qb.sacked/(qb.att+qb.sacked); qb["att/g"]=qb.att/qb.g
qb["yds/g"]=qb.pyd/qb.g; qb["int/g17"]=qb.int/qb.g*17
print("QB1s (sim):",len(qb)); print(qb.sort_values("ovr",ascending=False)[["team","name","ovr","cmp%","ypa","td%","int%","sk%","att/g","yds/g","int/g17"]].round(2).iloc[[0,1,2,3,4,8,12,16,20,24,28,30,31]].to_string(index=False))
print("corr(ovr, cmp%%) %.2f  corr(ovr, ypa) %.2f corr(ovr,int%%) %.2f corr(ovr,td%%) %.2f"%tuple(np.corrcoef(qb.ovr,qb[c])[0,1] for c in ["cmp%","ypa","int%","td%"]))
for c in["cmp%","ypa","int%","td%","sk%"]:
    b=np.polyfit(qb.ovr,qb[c],1)[0]; print(f"  slope per +10 ovr: {c} {10*b:+.2f}")
print("QB ovr sd %.1f range %d..%d"%(qb.ovr.std(),qb.ovr.min(),qb.ovr.max()))
# RB
rb=A[(A.pos=="RB")&(A.car>1500)].copy(); rb["ypc"]=rb.cyd/rb.car; rb["car/g"]=rb.car/rb.g; rb["td/g17"]=rb.ctd/rb.g*17
print("\nRB1s:",len(rb),"corr(ovr,ypc) %.2f ; corr(ovr,car/g) %.2f ; ypc sd %.2f ; ovr range %d-%d ; td/17 mean %.1f max %.1f"%(np.corrcoef(rb.ovr,rb.ypc)[0,1],np.corrcoef(rb.ovr,rb["car/g"])[0,1],rb.ypc.std(),rb.ovr.min(),rb.ovr.max(),rb["td/g17"].mean(),rb["td/g17"].max()))
print("  RB ypc slope per +10 ovr: %+.3f"%(10*np.polyfit(rb.ovr,rb.ypc,1)[0]))
print(rb.sort_values("td/g17",ascending=False)[["team","name","ovr","car/g","ypc","td/g17"]].head(5).round(2).to_string(index=False))
# WR
wr=A[(A.pos=="WR")&(A.tgt>1500)].copy(); wr["tgt/g"]=wr.tgt/wr.g; wr["ypt"]=wr.ryd/wr.tgt; wr["catch%"]=100*wr.rec/wr.tgt
print("\nWRs:",len(wr),"corr(ovr,tgt/g) %.2f corr(ovr,ypt) %.2f corr(ovr,catch%%) %.2f ; ypt slope per +10 ovr %+.2f ; tgt/g slope %+.2f"%(np.corrcoef(wr.ovr,wr["tgt/g"])[0,1],np.corrcoef(wr.ovr,wr.ypt)[0,1],np.corrcoef(wr.ovr,wr["catch%"])[0,1],10*np.polyfit(wr.ovr,wr.ypt,1)[0],10*np.polyfit(wr.ovr,wr["tgt/g"],1)[0]))
# does WR1 slot get same targets regardless of rating?
# compute within-team WR rank by ovr -> tgt/g
A2=A[(A.pos=="WR")&(A.tgt>500)].copy(); A2["rk"]=A2.groupby("team").ovr.rank(ascending=False,method="first"); A2["tgt/g"]=A2.tgt/A2.g
print("  WR targets/g by team rank:",A2.groupby("rk")["tgt/g"].mean().round(2).head(5).to_dict())
# EDGE sacks
ed=A[(A.pos=="EDGE")&(A.g>=1000)].copy(); ed["sk17"]=ed.sack/ (len(seasons))
ed=A[(A.pos=="EDGE")].copy(); ed["sk_per_season"]=ed.sack/len(seasons)
ed=ed[ed.sk_per_season>1]
print("\nEDGE sacks/season: n=%d corr(ovr,sacks) %.2f ; slope per +10 ovr %+.2f sacks ; top %.1f ; ovr 90+ avg %.1f ; ovr<70 avg %.1f"%(len(ed),np.corrcoef(ed.ovr,ed.sk_per_season)[0,1],10*np.polyfit(ed.ovr,ed.sk_per_season,1)[0],ed.sk_per_season.max(),ed[ed.ovr>=90].sk_per_season.mean(),ed[ed.ovr<70].sk_per_season.mean()))
# DB INT
db=A[(A.pos.isin(["CB","S"]))&(A.dint>0)].copy(); db["int_s"]=db.dint/len(seasons)
print("DB INT/season: n=%d corr(ovr,int) %.2f ; top5 players:"%(len(db),np.corrcoef(db.ovr,db.int_s)[0,1]))
print(db.sort_values("int_s",ascending=False)[["team","name","pos","ovr","int_s"]].head(6).round(2).to_string(index=False))
k=A[(A.pos=="K")&(A.fga>200)].copy(); k["fg%"]=100*k.fgm/k.fga; print("\nK: corr(ovr, fg%%) %.2f ; fg%% range %.1f-%.1f ; slope per +10 ovr %+.2f"%(np.corrcoef(k.ovr,k["fg%"])[0,1],k["fg%"].min(),k["fg%"].max(),10*np.polyfit(k.ovr,k["fg%"],1)[0]))
