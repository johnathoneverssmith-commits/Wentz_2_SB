import json,statistics as st,collections,math,random,sys
f=sys.argv[1] if len(sys.argv)>1 else 'data/x04_tailoring_t15.jsonl'
rows=[json.loads(l) for l in open(f)]
M=collections.defaultdict(dict)
for r in rows: M[r['m']][r['plan']]=r['margins']
plans=sorted({p for m in M.values() for p in m}); G=len(next(iter(M[0].values()))); h=G//2
mean=lambda x:sum(x)/len(x)
out=[]
def P(*a):
    s=' '.join(str(x) for x in a); print(s); out.append(s)
P("matchups",len(M),"games per plan-cell",G,"plans",plans)
# global effect of each plan vs std (paired by seed), +SE
P("\nplan  mean margin vs std (pts/game) [95%% CI] over all matchups (paired, n=%d games)"%(len(M)*G))
for p in plans:
    if p=='std':continue
    d=[a-b for m in M.values() for a,b in zip(m[p],m['std'])]
    se=st.pstdev(d)/math.sqrt(len(d)); P("%-8s %+.2f [%+.2f,%+.2f]"%(p,mean(d),mean(d)-1.96*se,mean(d)+1.96*se))
# per-matchup effect SD vs sampling noise: is there matchup-specific heterogeneity?
P("\nheterogeneity: sd across matchups of the per-matchup plan effect (observed) vs expected from noise alone")
for p in plans:
    if p=='std':continue
    eff=[];se2=[]
    for m in M.values():
        d=[a-b for a,b in zip(m[p],m['std'])]; eff.append(mean(d)); se2.append(st.pvariance(d)/len(d))
    obs=st.pstdev(eff); noise=math.sqrt(mean(se2)); true=math.sqrt(max(0,obs**2-noise**2))
    P("%-8s observed sd %.2f noise %.2f -> true between-matchup sd ~%.2f"%(p,obs,noise,true))
# split-half: choose plan on first half seeds, evaluate on second half
def gain(select_half,eval_half,restrict=None):
    ps=[p for p in plans if (restrict is None or p in restrict)]
    tail=[];glob=[];stdm=[]
    # best global plan chosen on selection half pooled over matchups
    gm={p:mean([mean(m[p][select_half])-mean(m['std'][select_half]) for m in M.values()]) for p in ps}
    bg=max(gm,key=gm.get)
    for m in M.values():
        sel={p:mean(m[p][select_half]) for p in ps}; ch=max(sel,key=sel.get)
        tail.append(mean(m[ch][eval_half])-mean(m['std'][eval_half])); glob.append(mean(m[bg][eval_half])-mean(m['std'][eval_half]))
    return mean(tail),mean(glob),bg,tail,glob
A=slice(0,h);B=slice(h,G)
for sel,ev,lab in ((A,B,'select A -> eval B'),(B,A,'select B -> eval A')):
    t,g,bg,tl,gl=gain(sel,ev)
    diff=[x-y for x,y in zip(tl,gl)]; se=st.pstdev(diff)/math.sqrt(len(diff))
    P("\n%s: best-global plan=%s gain %+.2f pts/game vs std; per-matchup-selected plan gain %+.2f; tailoring - global = %+.2f +/- %.2f (SE, %d matchups)"%(lab,bg,g,t,t-g,se,len(diff)))
# oracle (in-sample, optimistic) for scale
orc=[max(mean(m[p])-mean(m['std']) for p in plans) for m in M.values()]
P("in-sample best-of-%d per matchup (optimistic, includes selection bias): %+.2f pts/game"%(len(plans),mean(orc)))
# how often is std best / pass15 best etc. (split-half agreement)
agree=0
for m in M.values():
    a=max(plans,key=lambda p:mean(m[p][A])); b=max(plans,key=lambda p:mean(m[p][B])); agree+=a==b
P("split-half agreement on which plan is best per matchup: %d/%d (chance 1/%d=%.0f%%)"%(agree,len(M),len(plans),100/len(plans)))
open('data/x04_summary.txt','w').write('\n'.join(out))
