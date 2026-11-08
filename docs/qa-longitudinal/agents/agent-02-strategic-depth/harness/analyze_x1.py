import json,glob,statistics as st,math,collections,sys
rows=[]
for f in sorted(glob.glob('data/x1_[abc].json')): rows+=json.load(open(f))
by=collections.defaultdict(list)
for r in rows: by[r['seed']].append(r)
def corr(a,b):
    ma,mb=st.mean(a),st.mean(b); 
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(sum((x-ma)**2 for x in a)*sum((y-mb)**2 for y in b))
out=[]
P=lambda *a: (print(*a), out.append(' '.join(str(x) for x in a)))
P("leagues",len(by),"league-seasons",len(rows))
# 1 year-to-year wins & rating persistence
pw,pr,xw,xr=[],[],[],[]
for s,L in by.items():
    L.sort(key=lambda r:r['season'])
    for a,b in zip(L,L[1:]):
        for t in a['wins']:
            pw.append((a['wins'][t],b['wins'][t])); pr.append((a['ovr'][t],b['ovr'][t]))
P("wins(t) vs wins(t+1) r=%.2f; team-ovr(t) vs ovr(t+1) r=%.2f (n=%d team-seasons)"%(corr(*zip(*pw)),corr(*zip(*pr)),len(pw)))
# 2 rating->wins slope & r
ov=[];wn=[]
for r in rows:
    for t in r['wins']: ov.append(r['ovr'][t]); wn.append(r['wins'][t])
m=st.mean(ov); sl=sum((x-m)*(y-st.mean(wn)) for x,y in zip(ov,wn))/sum((x-m)**2 for x in ov)
P("same-season ovr->wins r=%.2f, slope=%.2f wins per team-ovr point, sd(ovr)=%.2f sd(wins)=%.2f"%(corr(ov,wn),sl,st.pstdev(ov),st.pstdev(wn)))
# 3 title concentration, dynasty
champs=[r['champion'] for r in rows if r['champion']]
cnt=collections.Counter(champs); P("titles",len(champs),"distinct champions",len(cnt),"max titles by one team/league-run(8 seasons):",max(collections.Counter((r['seed'],r['champion']) for r in rows if r['champion']).values()))
P("title share top-ovr team (pre-playoff best ovr):", sum(1 for r in rows if r['champion'] and r['champion']==max(r['ovr'],key=r['ovr'].get))/len(champs))
rk=[]
for r in rows:
    if not r['champion']: continue
    order=sorted(r['ovr'],key=r['ovr'].get,reverse=True); rk.append(order.index(r['champion'])+1)
P("champion's pre-playoff ovr rank: mean %.1f median %d; top3 %.0f%%; bottom half %.0f%%"%(st.mean(rk),st.median(rk),100*sum(x<=3 for x in rk)/len(rk),100*sum(x>16 for x in rk)/len(rk)))
# 4 mobility: bottom-quartile teams (by wins) -> wins k years later; top quartile
for k in (1,2,3,5):
    lo,hi=[],[]
    for s,L in by.items():
        for i in range(len(L)-k):
            w=L[i]['wins']; q=sorted(w,key=w.get); n=len(q)//4
            lo+= [L[i+k]['wins'][t] for t in q[:n]]; hi+=[L[i+k]['wins'][t] for t in q[-n:]]
    P("k=%d years later: bottom-quartile teams avg %.2f wins; top-quartile %.2f (league avg 8.5) n=%d"%(k,st.mean(lo),st.mean(hi),len(lo)))
# 5 long-run rating drift
for key in ('top24',):
    yrs=collections.defaultdict(list)
    for r in rows:
        for t,v in r['roster'].items(): yrs[r['season']-2026].append(v[key])
    P("league mean top-24 ovr by year:",[round(st.mean(v),1) for k,v in sorted(yrs.items())], "sd across teams:",[round(st.pstdev(v),2) for k,v in sorted(yrs.items())])
yrs=collections.defaultdict(list); ag=collections.defaultdict(list)
for r in rows:
    for t,v in r['roster'].items(): ag[r['season']-2026].append(v['age'])
P("mean age of top-24 by year:",[round(st.mean(v),1) for k,v in sorted(ag.items())])
# 6 payroll: cap used vs cap and spread
pay=collections.defaultdict(list)
for r in rows:
    for t,v in r['pay'].items(): pay[r['season']-2026].append(v)
P("payroll $M mean by year:",[round(st.mean(v),0) for k,v in sorted(pay.items())],"sd:",[round(st.pstdev(v),0) for k,v in sorted(pay.items())],"max:",[round(max(v),0) for k,v in sorted(pay.items())])
# 7 spending -> performance: does payroll predict wins beyond ovr? corr
pc=[];wc=[];oc=[]
for r in rows:
    for t in r['wins']: pc.append(r['pay'][t]); wc.append(r['wins'][t]); oc.append(r['ovr'][t])
P("corr(payroll,wins)=%.2f corr(payroll,ovr)=%.2f"%(corr(pc,wc),corr(pc,oc)))
# 8 best/worst: teams' win total distribution
allw=[v for r in rows for v in r['wins'].values()]
P("wins: sd %.2f; share of team-seasons >=12 wins %.1f%%, <=5 wins %.1f%%; max %d min %d"%(st.pstdev(allw),100*sum(w>=12 for w in allw)/len(allw),100*sum(w<=5 for w in allw)/len(allw),max(allw),min(allw)))
# 9 sustained dominance: teams with >=3 consecutive 11+ win seasons
streak=0;tot=0
for s,L in by.items():
    for t in L[0]['wins']:
        run=0;best=0
        for r in L:
            run=run+1 if r['wins'][t]>=11 else 0; best=max(best,run)
        if best>=3: streak+=1
        tot+=1
P("team-runs with >=3 consecutive 11+ win seasons: %d of %d (%.1f%%)"%(streak,tot,100*streak/tot))
# 10 worst-to-first
w2f=0;n=0;sust=0
for s,L in by.items():
    for a,b in zip(L,L[1:]):
        q=sorted(a['wins'],key=a['wins'].get)[:4]; 
        for t in q: n+=1; w2f+= b['wins'][t]>=10
P("bottom-4 -> next year >=10 wins: %d/%d (%.0f%%)  (real NFL ~ 20-25%% of last-place teams make playoffs next year)"%(w2f,n,100*w2f/n))
open('data/x1_summary.txt','w').write('\n'.join(out))
