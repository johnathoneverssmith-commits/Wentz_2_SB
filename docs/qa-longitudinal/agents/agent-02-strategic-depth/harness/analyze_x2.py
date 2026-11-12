import json,glob,statistics as st,math,collections
ctrl={}
for f in glob.glob('data/x1_[abc].json'):
    for r in json.load(open(f)):
        ctrl[(r['seed'],r['season'])]=r
def load(a):
    try: return json.load(open(f'data/x02_{a}.json'))
    except Exception: return []
out=[]
def P(*a):
    s=' '.join(str(x) for x in a); print(s); out.append(s)
b=load('base')
for r in b:
    if 'wins' in r:
        c=ctrl[(r['seed'],r['season'])]
        P("determinism check seed",r['seed'],r['season'],"wins identical:",r['wins']==c['wins'],"ovr identical:",r['ovr']==c['ovr'])
mean=lambda x:sum(x)/len(x)
def se(x): return st.pstdev(x)/math.sqrt(len(x)) if len(x)>1 else float('nan')
res={}
for arm in ('skilled','board','oracle','poor'):
    rows=[r for r in load(arm) if 'wins' in r]
    seeds=sorted({r['seed'] for r in rows})
    P("\n== arm",arm,"seeds",seeds)
    rk=[r for r in load(arm) if 'rookies' in r]
    ro=[x for r in rk for x in r['rookies']]
    if ro: P("rookies drafted by treated teams: n=%d mean true ovr %.1f, mean visible (college) ovr %.1f"%(len(ro),mean([x['true'] for x in ro]),mean([x['college'] for x in ro])))
    for k in (1,2,3):  # seasons after first draft: season index 1 (2027)=after draft #1
        dd={'ovr':[], 'top24':[], 'wins':[]}; du={'ovr':[], 'top24':[], 'wins':[]}
        for r in rows:
            if r['season']!=2026+k: continue
            c=ctrl.get((r['seed'],r['season']))
            if not c: continue
            T=set(r['treatedTeams'])
            for t in r['wins']:
                for m,key in (('ovr',r['ovr']),('top24',r['top24']),('wins',r['wins'])):
                    base=c['ovr'][t] if m=='ovr' else (c['roster'][t]['top24'] if m=='top24' else c['wins'][t])
                    (dd if t in T else du)[m].append(key[t]-base)
        P("season +%d (after %d draft%s): treated n=%d"%(k,k,'s' if k>1 else '',len(dd['ovr'])),
          " | ".join("%s: treated-vs-control %+.2f(SE %.2f), untreated(noise) %+.2f -> DiD %+.2f"%(m,mean(dd[m]),se(dd[m]),mean(du[m]),mean(dd[m])-mean(du[m])) for m in ('ovr','top24','wins')))
        res[(arm,k)]=(mean(dd['wins'])-mean(du['wins']), se(dd['wins']), mean(dd['ovr'])-mean(du['ovr']))
open('data/x02_summary.txt','w').write('\n'.join(out))
