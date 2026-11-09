import json,sys,glob,math,collections,statistics as st,os
rows=[]
for f in sys.argv[1:]: rows+=json.load(open(f))
by=collections.defaultdict(dict)
for r in rows: by[r['seed']][r['arm']]=r
arms=[a for a in ['public','R24','RD24','D24','Rperf','RDperf','Dperf'] if any(a in v for v in by.values())]
out=[]
def P(s): print(s); out.append(s)
seeds=[s for s in sorted(by) if 'control' in by[s]]
P(f"leagues={len(seeds)} (11 treated teams each). Metric: treated team's exact rating after N offseasons of real aging, minus the same team in the control draft; teams otherwise static (no FA/retirement), so differences come from the draft class only.")
def deltas(a,y):
    d=[]
    for s in seeds:
        v=by[s]
        if a not in v: continue
        for t in v[a]['treated']:
            d.append(v[a]['rating'][str(y)][t]-v['control']['rating'][str(y)][t])
    return d
P(f"{'arm':8s} "+" ".join(f"{'yr'+str(y):>20s}" for y in (0,1,3,5)))
base={}
for a in arms:
    cells=[]
    for y in (0,1,3,5):
        d=deltas(a,y); base[(a,y)]=d; cells.append(f"{st.mean(d):+.3f} ({st.stdev(d)/math.sqrt(len(d)):.3f})")
    P(f"{a:8s} "+" ".join(f"{c:>20s}" for c in cells))
P("paired difference vs the stated reference (same teams, same leagues): rating points (SE)")
def paired(a,b,y):
    x=[p-q for p,q in zip(base[(a,y)],base[(b,y)])]; return st.mean(x), st.stdev(x)/math.sqrt(len(x))
for a,b in (('R24','public'),('RD24','R24'),('D24','public'),('RD24','public'),('Rperf','public'),('RDperf','Rperf'),('RDperf','public'),('Dperf','public')):
    if (a,0) in base and (b,0) in base:
        P(f"  {a:7s} - {b:7s} "+" ".join(f"yr{y}: {paired(a,b,y)[0]:+.3f} ({paired(a,b,y)[1]:.3f})" for y in (0,1,3,5)))
# picks' overall
P("mean overall of the treated teams' drafted rookies (all picks), paired vs public")
for a in arms:
    if a=='public': continue
    s_=[]
    for y in ('0','3','5'):
        x=[]
        for s in seeds:
            v=by[s]
            if a not in v: continue
            for t in v[a]['treated']: x.append(st.mean(v[a]['pickOvr'][y][t])-st.mean(v['public']['pickOvr'][y][t]))
        s_.append(f"yr{y}: {st.mean(x):+.2f} ({st.stdev(x)/math.sqrt(len(x)):.2f})")
    P(f"  {a:7s} "+" ".join(s_))
x=[v['public']['rookieStarters'][str(y)][t] for v in by.values() for t in v['public']['treated'] for y in (0,3)]
for y in ('0','1','3','5'):
    z=[v['public']['rookieStarters'][y][t] for v in by.values() if 'public' in v for t in v['public']['treated']]
    P(f"  share of the 21 starting slots held by the team's own draft class, public arm, year {y}: {st.mean(z):.3f}")
open(os.path.join(os.path.dirname(sys.argv[1]),'expB2_summary.txt'),'w').write('\n'.join(out))
