import json,sys,math,collections,statistics as st
d=json.load(open(sys.argv[1])); rows=d['rows']
by=collections.defaultdict(dict)
for r in rows: by[(r['team'],r['r'])][r['cell']]=r
def diff(a,b,key='margin'):
    x=[v[a][key]-v[b][key] for v in by.values() if a in v and b in v and v[a][key] is not None and v[b][key] is not None]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x)), len(x)
def excess(key='margin'):
    x=[(v['combo|aligned'][key]-v['base'][key])-(v['both'][key]-v['base'][key])-(v['run|rbE|olM|zone'][key]-v['base'][key]) for v in by.values()]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x)), len(x)
out=[]
def P(s): print(s); out.append(s)
P(f"engine={'PROTOTYPE' if d['proto'] else 'BASELINE'} pairs={len(by)}  (margin pts vs base; SE)")
for c in ('rb','ol','both','eliteN','run|rbE|olM|zone','run|rbE|olM|power','comboN|balanced','comboN|aligned','comboN|anti','combo|aligned','combo|anti'):
    m=diff(c,'base'); y=diff(c,'base','ypc'); P(f"  {c:20s} margin {m[0]:+.2f} ({m[1]:.2f})  ypc {y[0]:+.3f} ({y[1]:.3f})")
def exN(key):
    x=[(v['comboN|aligned'][key]-v['base'][key])-(v['eliteN'][key]-v['base'][key])-(v['run|rbE|olM|zone'][key]-v['base'][key]) for v in by.values() if 'comboN|aligned' in v]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x))
if any('comboN|aligned' in v for v in by.values()):
    a1=exN('margin'); a2=exN('ypc'); P(f"  STYLE-NEUTRAL SUPERADDITIVE EXCESS = comboN|aligned - eliteN - style-only(zone): margin {a1[0]:+.2f} (SE {a1[1]:.2f})  ypc {a2[0]:+.3f} (SE {a2[1]:.3f})")
    g2=diff('comboN|aligned','comboN|anti'); g3=diff('run|rbE|olM|zone','run|rbE|olM|power'); P(f"  alignment gap (aligned - anti): elite {g2[0]:+.2f} (SE {g2[1]:.2f})  vs base quality {g3[0]:+.2f} (SE {g3[1]:.2f})")
    sys.exit(open(sys.argv[1].replace('.json','_summary.txt'),'w').write('\n'.join(out)) and 0)
e=excess('margin'); ey=excess('ypc'); P(f"  SUPERADDITIVE EXCESS (elite quality + aligned style) - (quality alone) - (style alone): margin {e[0]:+.2f} (SE {e[1]:.2f})  ypc {ey[0]:+.3f} (SE {ey[1]:.3f})")
g=diff('combo|aligned','combo|anti'); P(f"  elite team: aligned minus anti-aligned concept: {g[0]:+.2f} (SE {g[1]:.2f})")
open(sys.argv[1].replace('.json','_summary.txt'),'w').write('\n'.join(out))
