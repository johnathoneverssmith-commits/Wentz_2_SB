import json,sys,math,collections,statistics as st
d=json.load(open(sys.argv[1])); rows=d['rows']; out=[]
def P(s): print(s); out.append(s)
if d['MODE']=='D1':
    by=collections.defaultdict(dict)
    for r in rows: by[(r['kind'],r['tagless'],r['team'],r['r'])][r['scheme']]=r['margin']
    P("D1 baseline engine. Effect of coordinator SCHEME (rating 50) vs neutral scheme, margin pts (SE); n pairs")
    for kind,neutral,schemes in (('off','pro_style',["west_coast","vertical","spread","power_run","zone_run"]),('def','multiple',["four_three","three_four","cover_3","cover_2","man_press"])):
        for tagless in (False,True):
            P(f"  {kind} players {'WITHOUT scheme_tags (default fictional league / rookies)' if tagless else 'WITH scheme_tags (pool-2026)'}")
            for s in schemes:
                x=[v[s]-v[neutral] for k,v in by.items() if k[0]==kind and k[1]==tagless and s in v and neutral in v]
                P(f"     {s:11s} {st.mean(x):+.2f} ({st.stdev(x)/math.sqrt(len(x)):.2f}) n={len(x)}")
    # roster-specificity of best offensive scheme with tags (split-half)
    teams=sorted({k[2] for k in by if k[0]=='off'})
    agree=0;n=0;gain=[];glob_gain=[]
    S=["west_coast","vertical","spread","power_run","zone_run","pro_style"]
    for t in teams:
        reps=sorted({k[3] for k in by if k[0]=='off' and k[2]==t and k[1]==False})
        A=reps[::2];B=reps[1::2]
        mA={s:st.mean(by[('off',False,t,r)][s] for r in A) for s in S}; mB={s:st.mean(by[('off',False,t,r)][s] for r in B) for s in S}
        bA=max(mA,key=mA.get); bB=max(mB,key=mB.get); agree+=bA==bB;n+=1; gain.append(mB[bA]-mB['pro_style'])
    P(f"  per-team best offensive scheme (tags present): split-half agreement {agree}/{n} (chance {n/6:.1f}); chosen-on-A scheme vs pro_style on B: {st.mean(gain):+.2f} pts")
else:
    by=collections.defaultdict(dict); meta={}
    for r in rows: by[(r['team'],r['r'])][r['strat']]=r['margin']; meta[(r['team'],r['r'])]=r
    P("D2 prototype engine. Concept strategy minus balanced (no declared concept), margin pts (SE)")
    for s in ('natural','opposite','counter','natLean','allZoneVert','allPowerTiming'):
        x=[v[s]-v['balanced'] for v in by.values()]
        P(f"  {s:15s} {st.mean(x):+.2f} ({st.stdev(x)/math.sqrt(len(x)):.2f}) n={len(x)}")
    P("  fixed league-wide concept vs opponent front (front>0 stout/slow, <0 quick/penetrating): margin minus balanced")
    for lab,sel in (('opp front stout (>0.3)',lambda m:m['front']>0.3),('opp front neutral',lambda m:abs(m['front'])<=0.3),('opp front quick (<-0.3)',lambda m:m['front']<-0.3)):
        for s in ('allZoneVert','allPowerTiming','counter','natLean','natural'):
            x=[v[s]-v['balanced'] for k,v in by.items() if sel(meta[k])]
            P(f"     {lab:26s} {s:15s} {st.mean(x):+.2f} ({st.stdev(x)/math.sqrt(len(x)):.2f}) n={len(x)}")
open(sys.argv[1].replace('.json','_summary.txt'),'w').write('\n'.join(out))
