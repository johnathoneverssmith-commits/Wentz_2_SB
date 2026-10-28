import json,glob,numpy as np,pandas as pd
def rows(p):
    out=[]
    for f in sorted(glob.glob(p)):
        for s in json.load(open(f))["seasons"]:
            for q in s["qb"]:
                if q["att"]>=300: out.append(q)
    return pd.DataFrame(out)
pd.set_option("display.width",200)
print("REAL starters (nflverse 2023-25, >=300 att): cmp% sd 3.2, mean 65.5 ; INT% mean 2.05; per-17g INT max 21")
rs=pd.read_pickle("real/szn.pkl"); rs=rs[(rs.position=="QB")&(rs.attempts>=300)]
rs["cmp"]=100*rs.completions/rs.attempts; rs["int"]=100*rs.passing_interceptions/rs.attempts; rs["ypa"]=rs.passing_yards/rs.attempts
print(" real n=%d cmp mean %.1f sd %.2f min %.1f max %.1f | INT%% mean %.2f sd %.2f min %.2f max %.2f | Y/A mean %.2f sd %.2f min %.2f max %.2f"%(len(rs),rs["cmp"].mean(),rs["cmp"].std(),rs["cmp"].min(),rs["cmp"].max(),rs["int"].mean(),rs["int"].std(),rs["int"].min(),rs["int"].max(),rs.ypa.mean(),rs.ypa.std(),rs.ypa.min(),rs.ypa.max()))
for lab,pat in(("fixed","dr_fix_%s_*.json"),("drafted std","dr_std_%s_*.json")):
    for t in("1","1.5"):
        d=rows(pat%t); d["cmp"]=100*d.cmp/d.att; d["int"]=100*d.int/d.att; d["ypa"]=d.yds/d.att; d["td"]=100*d.td/d.att
        print(f"\n{lab} talent {t}: n={len(d)} starters-seasons; QB overall mean {d.ovr.mean():.1f} sd {d.ovr.std():.1f} range {d.ovr.min()}-{d.ovr.max()}")
        print(f"  cmp% mean {d['cmp'].mean():.1f} sd {d['cmp'].std():.2f} min {d['cmp'].min():.1f} max {d['cmp'].max():.1f} | INT% mean {d['int'].mean():.2f} sd {d['int'].std():.2f} min {d['int'].min():.2f} max {d['int'].max():.2f} | Y/A mean {d.ypa.mean():.2f} sd {d.ypa.std():.2f} min {d.ypa.min():.2f} max {d.ypa.max():.2f}")
        d["bucket"]=pd.cut(d.ovr,[0,69,74,79,84,89,100],labels=["<70","70-74","75-79","80-84","85-89","90+"])
        g=d.groupby("bucket",observed=True).agg(n=("ovr","size"),cmp=("cmp","mean"),ypa=("ypa","mean"),td=("td","mean"),int=("int","mean")).round(2)
        print(g.T.to_string())
        print("  slope per +10 ovr: cmp %+.2f ypa %+.2f int %+.2f"%tuple(10*np.polyfit(d.ovr,d[c],1)[0] for c in("cmp","ypa","int")))
