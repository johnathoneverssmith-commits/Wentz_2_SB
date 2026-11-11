import json,sys,glob,math,collections,statistics as st
rows=[]
for f in sys.argv[1:]: rows+=json.load(open(f))
by=collections.defaultdict(dict)
for r in rows: by[r['seed']][r['arm']]=r
arms=[a for a in ['public','basic24-top','basic24-window','basic24-need','basic24-needwin','deep8-need','deep8-needwin','basic24-random','basic24-voi','deep8-top','deep8-voi','basic48-voi','deep16-voi','perfect'] if any(a in v for v in by.values())]
out=[]
def P(s): print(s); out.append(s)
seeds=sorted(by)
P(f"leagues={len(seeds)}; treated teams per league=11; metric = team rating (exact, 0.1) after draft+signing, minus the same team in the control draft (CPU default)")
base={}
for a in arms:
    d=[];pk=[]
    for s in seeds:
        v=by[s]
        if a not in v or 'control' not in v: continue
        for t in v[a]['treated']:
            d.append(v[a]['rating'][t]-v['control']['rating'][t])
        pk+= [x for l in v[a]['picks'].values() for x in l]
    base[a]=d
    P(f"  {a:16s} dRating vs CPU {st.mean(d):+.2f} (SE {st.stdev(d)/math.sqrt(len(d)):.2f}, n={len(d)})  mean true rating of picks {st.mean(pk):.1f}")
pub=base.get('public')
if pub:
    P("  paired difference vs public (same teams, same leagues):")
    for a in arms:
        if a=='public' or len(base[a])!=len(pub): continue
        x=[p-q for p,q in zip(base[a],pub)]
        P(f"     {a:16s} {st.mean(x):+.2f} (SE {st.stdev(x)/math.sqrt(len(x)):.2f})")
import os; open(os.path.join(os.path.dirname(sys.argv[1]),os.environ.get('OUTNAME','expC_summary.txt')),'w').write('\n'.join(out))
