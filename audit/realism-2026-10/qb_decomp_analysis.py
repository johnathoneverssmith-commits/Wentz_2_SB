import json,sys,numpy as np,pandas as pd
f=sys.argv[1] if len(sys.argv)>1 else "decomp.jsonl"
d=pd.DataFrame([json.loads(l) for l in open(f)])
pd.set_option("display.width",220)
for t in sorted(d.talent.unique()):
    x=d[d.talent==t]
    print(f"\n=== talent {t}  (cell n={x.n.iloc[0]} games; paired seeds)")
    for lab in x.label.unique():
        y=x[x.label==lab].sort_values("ovr")
        print(f"-- {lab}")
        print(y[["ovr","cmp","ypa","td","int","sack","margin","win","tdPer17","intPer17"]].round(2).to_string(index=False))
    # slopes per +10 overall (linear fit) per label
    print("\nslope per +10 overall:")
    rows=[]
    for lab in x.label.unique():
        y=x[x.label==lab]
        r={"layer":lab}
        for c in("cmp","ypa","td","int","sack","margin","win"): r[c]=10*np.polyfit(y.ovr,y[c],1)[0]
        rows.append(r)
    print(pd.DataFrame(rows).round(3).to_string(index=False))
