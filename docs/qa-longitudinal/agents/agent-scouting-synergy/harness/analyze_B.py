import json,sys,math,collections,statistics as st
d=json.load(open(sys.argv[1])); rows=d['rows']
by=collections.defaultdict(dict)
for r in rows: by[(r['team'],r['r'])][r['arm']]=r
def cmp(a,b,key='margin'):
    x=[v[a][key]-v[b][key] for v in by.values() if a in v and b in v]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x)), len(x)
out=[]
def P(s): print(s); out.append(s)
P(f"engine={'PROTOTYPE' if d['proto'] else 'BASELINE'} lambda={d['lambda']} pairs={len(by)}")
for a,b,lab in (('F','H','fit-based (F) minus highest-overall (H): margin'),('B','H','balanced-no-concept (B) minus H: margin'),('F','B','F minus B')):
    m=cmp(a,b); P(f"  {lab:55s} {m[0]:+.2f} pts (SE {m[1]:.2f}, 95% CI {m[0]-1.96*m[1]:+.2f}..{m[0]+1.96*m[1]:+.2f})")
o=cmp('F','H','ovr'); s=cmp('F','H','spend')
P(f"  mean overall of purchased starters: F is {o[0]:+.2f} vs H;  spend F-H = {s[0]:+.2f} chart points")
# win prob effect
w=[(1 if v['F']['margin']>0 else 0 if v['F']['margin']<0 else .5)-(1 if v['H']['margin']>0 else 0 if v['H']['margin']<0 else .5) for v in by.values()]
P(f"  win-share difference F-H: {50*st.mean([x for x in w])*2/2:+.1f} pct points (per-game, sign of margin)")
open(sys.argv[1].replace('.json','_summary.txt'),'w').write('\n'.join(out))
