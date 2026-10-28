import json,glob,numpy as np,pandas as pd
import os; S=os.environ.get("AUDIT_DIR","audit/realism-2026-10/out")+"/"
def load(p):
    out=[]
    for f in sorted(glob.glob(S+p)):
        d=json.load(open(f)); out+= [(f,s) for s in d["seasons"]]
    return out
def summ(rows):
    m=[];ts=[]
    for f,s in rows:
        t={}
        for g in s["games"]:
            m.append(g["hs"]-g["as"])
            for tm,a,b in((g["h"],g["hs"],g["as"]),(g["a"],g["as"],g["hs"])):
                r=t.setdefault(tm,[0,0,0]); r[0]+=(a>b)+0.5*(a==b); r[1]+=a-b; r[2]+=1
        for tm,r in t.items(): ts.append((f,r[0],r[1]/r[2]))
    m=np.array(m); T=pd.DataFrame(ts,columns=["f","w","pd"])
    n=len(rows)
    sd_pd=T.pd.std()
    return dict(seasons=n,games=len(m),margin_sd=m.std(),one_score=(np.abs(m)<=8).mean()*100,b21=(np.abs(m)>=21).mean()*100,b28=(np.abs(m)>=28).mean()*100,
      w14=(T.w>=14).sum()/n,w13=(T.w>=13).sum()/n,perfect_or_winless=((T.w>=16.5)|(T.w<=0.5)).sum(),team_seasons=len(T),perfect=int((T.w>=16.5).sum()),winless=int((T.w<=0.5).sum()),
      win_sd=T.w.std(),pd_sd=sd_pd,true_sd=np.sqrt(max(0,sd_pd**2-(m.std()/np.sqrt(17))**2)),best=T.groupby("f").pd.max().mean(),worst=T.groupby("f").pd.min().mean(),
      maxw=T.groupby("f").w.max().mean(),minw=T.groupby("f").w.min().mean())
real=dict(margin_sd=14.31,one_score=53.3,b21=16.5,b28=6.8,w14=1.4,pd_sd=6.11,true_sd=5.0,win_sd=3.15,maxw=13.75,minw=2.5)
print("REAL:",real)
tab={}
for lab,pat in(("fixed rosters","dr_fix_%s_*.json"),("drafted (standard CPUs)","dr_std_%s_*.json"),("drafted (master CPUs)","dr_mst_%s_*.json")):
    for t in("1","1.5"):
        tab[(lab,t)]=summ(load(pat%t))
df=pd.DataFrame(tab).T
pd.set_option("display.width",250)
print(df[["seasons","games","margin_sd","one_score","b21","b28","w14","perfect","winless","team_seasons","win_sd","pd_sd","true_sd","best","worst","maxw","minw"]].round(2).to_string())
# per-league spread: sd of league-level true strength between leagues
for lab,pat in(("fixed","dr_fix_1_*.json"),("std","dr_std_1_*.json")):
    rows=load(pat); print(lab,"per-league margin sd range at 1.0:",np.round(sorted([summ([r])["margin_sd"] for r in rows])[::4],2))
