import json,glob,os,numpy as np,pandas as pd
rows=[]
for f in sorted(glob.glob("lc/*.json")):
    cfg,tag,t=os.path.basename(f)[:-5].split("__"); t=t[1:]
    d=json.load(open(f)); q=[];m=[];tot=dict(att=0,cmp=0,yds=0,int=0,sack=0,pts=0,tg=0)
    pdt=[]
    for s in d["seasons"]:
        q+= [x for x in s["qb"] if x["att"]>=300]
        for k in tot: tot[k]+=s["tot"][k]
        tm={}
        for h,a,hs,as_ in s["games"]:
            m.append(hs-as_)
            for z,x,y in((h,hs,as_),(a,as_,hs)): r=tm.setdefault(z,[0,0]); r[0]+=x-y; r[1]+=1
        pdt+= [v[0]/v[1] for v in tm.values()]
    Q=pd.DataFrame(q); Q["c"]=100*Q.cmp/Q.att; Q["i"]=100*Q["int"]/Q.att; Q["y"]=Q.yds/Q.att; Q["td"]=100*Q.td/Q.att
    m=np.array(m); ms=m.std(); tsd=np.sqrt(max(0,np.std(pdt,ddof=1)**2-(ms/np.sqrt(17))**2))
    rows.append(dict(cfg=cfg,rosters=tag,talent=t,n=len(Q),cmp_sd=Q.c.std(),cmp_min=Q.c.min(),cmp_max=Q.c.max(),int_sd=Q.i.std(),int_min=Q.i.min(),int_max=Q.i.max(),ypa_sd=Q.y.std(),td_sd=Q.td.std(),
      tdSeason=(Q.td/100*Q.att*17/ (Q.att/ (Q.att/ (Q.att/560)) ) ).mean() if False else (Q.td/100*560).mean(),intSeason_max=(Q.i/100*560).max(),yds_sd=(Q.y*560).std(),
      lg_cmp=100*tot["cmp"]/tot["att"],lg_int=100*tot["int"]/tot["att"],lg_ypa=tot["yds"]/tot["att"],lg_sack=100*tot["sack"]/(tot["att"]+tot["sack"]),pts=tot["pts"]/tot["tg"],margin_sd=ms,true_sd=tsd,b21=100*(np.abs(m)>=21).mean()))
df=pd.DataFrame(rows); pd.set_option("display.width",300,"display.max_columns",40)
df["cfg"]=pd.Categorical(df.cfg,["BASE","C1","C4","C5"])
print("REAL starters: cmp sd 3.09 (58.1-72.9)  INT sd 0.71 (0.60-3.99)  Y/A sd 0.76 ; pass TD/season mean 21 sd? ; league cmp 64.7 int 2.2 ypa 7.06 sack 6.6 pts 22.6")
for r in ["fixed","mature_realistic_1_json_1","mature_realistic_1_json_3"]:
    print("\n##",r)
    print(df[df.rosters==r].sort_values(["talent","cfg"])[["cfg","talent","n","cmp_sd","cmp_min","cmp_max","int_sd","int_min","int_max","ypa_sd","intSeason_max","lg_cmp","lg_int","lg_ypa","lg_sack","pts","margin_sd","true_sd","b21"]].round(2).to_string(index=False))
