import json,sys,math,collections,statistics as st
d=json.load(open(sys.argv[1])); by=collections.defaultdict(dict)
for r in d['rows']: by[(r['team'],r['r'])][r['cell']]=r
out=[]
def P(s): print(s); out.append(s)
def con(f,key):
    x=[f(v,key) for v in by.values() if len(v)==8 and all(v[c][key] is not None for c in v)]
    return st.mean(x), st.stdev(x)/math.sqrt(len(x)), len(x)
c=lambda v,k,al,rb,ol: v[f"{al}|rb{rb}|ol{ol}"][k]
rbol=lambda al: (lambda v,k: c(v,k,al,1,1)-c(v,k,al,1,0)-c(v,k,al,0,1)+c(v,k,al,0,0))
qa=lambda v,k: (c(v,k,'A',1,1)-c(v,k,'M',1,1))-(c(v,k,'A',0,0)-c(v,k,'M',0,0))
gap=lambda rb,ol: (lambda v,k: c(v,k,'A',rb,ol)-c(v,k,'M',rb,ol))
P(f"engine={'PROTOTYPE q='+d['q'] if d['proto'] else 'BASELINE'} talent={d['talent']} elite={d['elite']}z pairs={len(by)}")
for key,lab in (('ypc','yd/carry'),('margin','margin')):
    P(f"  [{lab}]")
    for nm,f in (('RBxOL interaction | aligned',rbol('A')),('RBxOL interaction | mismatched',rbol('M')),('Quality x Alignment (both elite vs both avg)',qa),('alignment gap, avg RB + avg line',gap(0,0)),('alignment gap, elite RB + avg line',gap(1,0)),('alignment gap, avg RB + elite line',gap(0,1)),('alignment gap, elite RB + elite line',gap(1,1))):
        m=con(f,key); P(f"    {nm:48s} {m[0]:+.3f} (SE {m[1]:.3f})")
open(sys.argv[1].replace('.json','_summary.txt'),'w').write('\n'.join(out))
