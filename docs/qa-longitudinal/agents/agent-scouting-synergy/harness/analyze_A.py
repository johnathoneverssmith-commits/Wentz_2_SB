import json,sys,math,collections,statistics as st
f=sys.argv[1]; d=json.load(open(f)); rows=d['rows']
by=collections.defaultdict(dict)
for r in rows: by[(r['team'],r['r'])][r['cell']]=r
cells=sorted({r['cell'] for r in rows})
def diff(a,b,key='margin'):
    x=[v[a][key]-v[b][key] for v in by.values() if a in v and b in v and v[a][key] is not None and v[b][key] is not None]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x)), len(x)
def inter(key='margin'):
    x=[(v['both'][key]-v['base'][key])-(v['rb'][key]-v['base'][key])-(v['ol'][key]-v['base'][key]) for v in by.values() if all(c in v for c in('both','rb','ol','base'))]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x)), len(x)
out=[]
def P(s): print(s); out.append(s)
P(f"engine={'PROTOTYPE' if d['proto'] else 'BASELINE'}  pairs per cell={len(by)}")
P("Part 1  quality factorial (vs base; margin pts | YPC)")
for c in ('rb','ol','both'):
    m=diff(c,'base');y=diff(c,'base','ypc'); P(f"  {c:5s} margin {m[0]:+.2f} (SE {m[1]:.2f})   ypc {y[0]:+.3f} (SE {y[1]:.3f})")
for k in ('margin','ypc'):
    i=inter(k); P(f"  interaction (both - rb - ol) on {k}: {i[0]:+.3f} (SE {i[1]:.3f})")
P("Part 2  run style x run concept (quality held constant). margin vs base | ypc vs base")
for c in cells:
    if c.startswith('run|'):
        m=diff(c,'base');y=diff(c,'base','ypc'); P(f"  {c:28s} margin {m[0]:+.2f} ({m[1]:.2f})  ypc {y[0]:+.3f} ({y[1]:.3f})")
def agg(prefix, aligned):
    xs=[];ys=[]
    for v in by.values():
        for c in cells:
            if c.startswith(prefix) and aligned(c) and c in v and 'base' in v:
                xs.append(v[c]['margin']-v['base']['margin']); 
                if v[c]['ypc'] is not None and v['base']['ypc'] is not None: ys.append(v[c]['ypc']-v['base']['ypc'])
    return st.mean(xs), st.stdev(xs)/math.sqrt(len(xs)), (st.mean(ys) if ys else 0), len(xs)
al=lambda c: (('rbE' in c and 'olM' in c and 'zone' in c) or ('rbP' in c and 'olD' in c and 'power' in c))
mis=lambda c: (('rbE' in c and 'olM' in c and 'power' in c) or ('rbP' in c and 'olD' in c and 'zone' in c))
mix=lambda c: (('rbE' in c and 'olD' in c) or ('rbP' in c and 'olM' in c))
for nm,fn in (('aligned (RB+OL+concept agree)',al),('anti-aligned (RB+OL agree, concept opposite)',mis),('RB/OL split (any concept)',mix)):
    a=agg('run|',fn); P(f"  {nm:48s} margin {a[0]:+.2f} (SE {a[1]:.2f}) ypc {a[2]:+.3f} n={a[3]}")
P("Part 3  pass style x pass concept")
for c in cells:
    if c.startswith('pass|'):
        m=diff(c,'base'); P(f"  {c:28s} margin {m[0]:+.2f} ({m[1]:.2f})")
alp=lambda c: (('qbV' in c and 'wrV' in c and 'vertical' in c) or ('qbK' in c and 'wrT' in c and 'timing' in c))
misp=lambda c: (('qbV' in c and 'wrV' in c and 'timing' in c) or ('qbK' in c and 'wrT' in c and 'vertical' in c))
mixp=lambda c: (('qbV' in c and 'wrT' in c) or ('qbK' in c and 'wrV' in c))
for nm,fn in (('aligned',alp),('anti-aligned',misp),('QB/WR split',mixp)):
    a=agg('pass|',fn); P(f"  {nm:48s} margin {a[0]:+.2f} (SE {a[1]:.2f}) n={a[3]}")
open(f.replace('.json','_summary.txt'),'w').write('\n'.join(out))
