import json,sys,numpy as np,pandas as pd
d=pd.DataFrame([json.loads(l) for l in open(sys.argv[1])]); lo,hi=int(sys.argv[2]),int(sys.argv[3])
rows=[]
for (t,lab),y in d.groupby(["talent","label"]):
    y=y[(y.ovr>=lo)&(y.ovr<=hi)]
    r=dict(talent=t,config=lab)
    for c in("cmp","ypa","td","int","sack","margin","win"): r[c]=10*np.polyfit(y.ovr,y[c],1)[0]
    r["margin_per_sd(6.8)"]=r["margin"]*0.68
    # span across the pool-like range
    r["cmp@70"]=np.interp(70,y.ovr,y.cmp);r["cmp@95"]=np.interp(95,d[(d.talent==t)&(d.label==lab)].ovr,d[(d.talent==t)&(d.label==lab)].cmp)
    r["int@70"]=np.interp(70,y.ovr,y["int"]);r["int@95"]=np.interp(95,d[(d.talent==t)&(d.label==lab)].ovr,d[(d.talent==t)&(d.label==lab)]["int"])
    rows.append(r)
pd.set_option("display.width",250)
print(pd.DataFrame(rows).round(2).to_string(index=False))
