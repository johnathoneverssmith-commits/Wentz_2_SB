import json,glob,sys,numpy as np,pandas as pd
import os; S=os.environ.get("AUDIT_DIR","audit/realism-2026-10/out")+"/"
pool=json.load(open("ui-source/src/data/pool-2026.json"))
df=pd.DataFrame([dict(team=p["nfl_team"],pos=p["position"],ovr=p["overall"],name=p["name"]) for p in pool if p["nfl_team"] and p["nfl_team"]!="FA"])
def top(t,pos,k): 
    x=df[(df.team==t)&(df.pos.isin(pos))].sort_values("ovr",ascending=False).head(k).ovr.values
    return x
units={}
for t in sorted(df.team.unique()):
    u={}
    u["QB"]=top(t,["QB"],1).mean(); u["RB"]=top(t,["RB"],1).mean(); u["WR"]=top(t,["WR"],3).mean(); u["TE"]=top(t,["TE"],1).mean()
    ot=top(t,["OT"],2); og=top(t,["OG"],2); c=top(t,["C"],1); u["OL"]=np.mean(list(ot)+list(og)+list(c))
    u["EDGE"]=top(t,["EDGE"],2).mean(); u["DT"]=top(t,["DT"],2).mean(); u["ILB"]=top(t,["ILB"],2).mean(); u["CB"]=top(t,["CB"],3).mean(); u["S"]=top(t,["S"],2).mean()
    u["K"]=top(t,["K"],1).mean(); u["P"]=top(t,["P"],1).mean()
    units[t]=u
U=pd.DataFrame(units).T
for tal in sys.argv[1:]:
    seasons=[]
    for f in sorted(glob.glob(S+f"t{tal}_[0-9].json")): seasons+=json.load(open(f))["seasons"]
    m={}; pf={}; pa={}
    for s in seasons:
        for g in s["games"]:
            for tm,a,b in((g["h"],g["hs"],g["as"]),(g["a"],g["as"],g["hs"])):
                m.setdefault(tm,[]).append(a-b); pf.setdefault(tm,[]).append(a); pa.setdefault(tm,[]).append(b)
    M=pd.Series({k:np.mean(v) for k,v in m.items()}); PF=pd.Series({k:np.mean(v) for k,v in pf.items()}); PA=pd.Series({k:np.mean(v) for k,v in pa.items()})
    X=U.loc[M.index]
    print(f"\n### talent {tal}: team mean margin sd {M.std():.2f} (per game); PF sd {PF.std():.2f}; PA sd {PA.std():.2f}; best {M.idxmax()} {M.max():+.1f}, worst {M.idxmin()} {M.min():+.1f}")
    print("top5:",M.sort_values(ascending=False).head(5).round(1).to_dict()," bottom5:",M.sort_values().head(5).round(1).to_dict())
    z=(X-X.mean())/X.std()
    print("unit sd of rating across teams:",X.std().round(2).to_dict())
    res={}
    for c in X.columns:
        b=np.polyfit(X[c],M,1)[0]; r=np.corrcoef(X[c],M)[0,1]
        res[c]=(b*X[c].std(),r)
    print("univariate: margin pts per +1 sd of unit rating (corr):")
    print("  "+" | ".join(f"{k} {v[0]:+.2f} ({v[1]:+.2f})" for k,v in sorted(res.items(),key=lambda kv:-abs(kv[1][0]))))
    # multivariate ridge-ish OLS on z
    A=np.c_[np.ones(len(z)),z.values]; lam=3.0
    beta=np.linalg.solve(A.T@A+lam*np.diag([0]+[1]*z.shape[1]),A.T@M.values)
    print("ridge multivariate (pts/g per +1 sd): "+" | ".join(f"{k} {b:+.2f}" for k,b in sorted(zip(z.columns,beta[1:]),key=lambda kv:-abs(kv[1]))))
    pred=A@beta; print("  R2 of unit ratings -> margin (ridge): %.2f"%(1-((M.values-pred)**2).sum()/((M.values-M.mean())**2).sum()))
    tot=X.mean(axis=1); print("  overall-sum rating corr with margin: %.2f"%np.corrcoef(tot,M)[0,1])
U.to_csv(S+"units.csv")
