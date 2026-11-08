"""Agent 3 analysis. Reads data/unit_swap.jsonl, staff_swap.jsonl and the committed pool; writes data/analysis_unit_summary.md.
Price tables are COPIED from ui-source/src/sim/MockSimulationService.ts (TRADE_POSITION_VALUE, POSITION_VALUE) - cite line numbers there."""
import json, math, collections, statistics as st
TRADE={'QB':2.92,'EDGE':1.3,'OT':1.15,'WR':1.15,'CB':1.15,'DT':1.08,'S':.9,'OG':.92,'C':.88,'TE':.9,'ILB':.85,'RB':.78,'K':.3,'P':.2}
FA={'QB':2.92,'CB':1.42,'EDGE':1.35,'RB':1.21,'S':1.11,'OT':1.0,'ILB':.97,'OG':.9,'C':.9,'WR':.87,'TE':.84,'DT':.79,'K':.5,'P':.25}
UNITS={'QB':{'QB':1},'OL':{'C':1,'OG':2,'OT':2},'WRTE':{'WR':3,'TE':1},'RB':{'RB':1},'FRONT':{'EDGE':2,'DT':2},'LB':{'ILB':2},'SECONDARY':{'CB':3,'S':2},'K':{'K':1},'P':{'P':1}}
pool=json.load(open('../../../ui-source/src/data/pool-2026.json'))
by=collections.defaultdict(lambda: collections.defaultdict(list))
for p in pool:
    if p['nfl_team'] and p['nfl_team']!='FA': by[p['position']][p['nfl_team']].append(p['overall'])
def starters(pos,n): return [o for t in by[pos].values() for o in sorted(t,reverse=True)[:n]]
def backups(pos,n): return [sorted(t,reverse=True)[n] for t in by[pos].values() if len(t)>n]
rows=[json.loads(l) for l in open('data/unit_swap.jsonl')]
qb1=st.mean(starters('QB',1))
def z(x,se): return f"{x:+.2f} [{x-1.96*se:+.2f},{x+1.96*se:+.2f}]"
out=["# Unit-swap results (95% CI = 1.96 SE, paired seeds)\n",f"League mean QB1 overall in the pool: {qb1:.1f}\n",
"| unit | shift | talent | pairs | margin pts/game [95% CI] | win% pts [95% CI] |","|---|---|---|---|---|---|"]
for r in sorted(rows,key=lambda r:(r['talent'],r['unit'],r['delta'])):
    out.append(f"| {r['unit']} | {r['delta']} | {r['talent']} | {r['n']} | {z(r['dMargin'],r['seMargin'])} | {z(r['dWinPct'],r['seWinPct'])} |")
out+=["\n## Group vs per-starter vs price (talent 1.0, +10 and -10 averaged; |effect| per +10 rating points)\n",
"| unit | starters | group margin/+10 | per-starter margin/+10 | mean starter ovr | mean first backup ovr | trade price mult (avg) | FA price mult (avg) | per-starter margin per trade-price unit | per FA-price unit |","|---|---|---|---|---|---|---|---|---|---|"]
for u,ps in UNITS.items():
    if u=='QB': continue
    a=[r for r in rows if r['unit']==u and r['talent']==1]
    if len(a)<2: continue
    g=(abs(next(r for r in a if r['delta']=='10')['dMargin'])+abs(next(r for r in a if r['delta']=='-10')['dMargin']))/2
    n=sum(ps.values()); per=g/n
    tp=sum(TRADE[p]*k for p,k in ps.items())/n; fp=sum(FA[p]*k for p,k in ps.items())/n
    ms=st.mean(o for p,k in ps.items() for o in starters(p,k)); mb=st.mean(o for p,k in ps.items() for o in backups(p,k))
    out.append(f"| {u} | {n} | {g:.2f} | {per:.2f} | {ms:.1f} | {mb:.1f} | {tp:.2f} | {fp:.2f} | {per/tp:.2f} | {per/fp:.2f} |")
for T in (1,1.5):
    a={r['delta']:r for r in rows if r['unit']=='QB' and r['talent']==T}
    if a: 
        up=(95-qb1); dn=(qb1-72)
        out.append(f"\nQB talent {T}: 72 -> {z(a['abs:72']['dMargin'],a['abs:72']['seMargin'])} margin ({a['abs:72']['dMargin']/dn:.2f}/pt over {dn:.1f} pts avg gap); 95 -> {z(a['abs:95']['dMargin'],a['abs:95']['seMargin'])} ({a['abs:95']['dMargin']/up:.2f}/pt over {up:.1f} pts). Elite-vs-replacement swing 72->95 ~ {a['abs:95']['dMargin']-a['abs:72']['dMargin']:.1f} margin pts, {a['abs:95']['dWinPct']-a['abs:72']['dWinPct']:.1f} win-pct pts.")
out+=["\n## Position scarcity (pool): starters 90th-pct vs first backup mean\n","| pos | starters mean | starters p90 | backup mean | gap |","|---|---|---|---|---|"]
for p in TRADE:
    s=starters(p,UNITS_N) if False else None
for p,n in [('QB',1),('RB',1),('WR',3),('TE',1),('C',1),('OG',2),('OT',2),('EDGE',2),('DT',2),('ILB',2),('CB',3),('S',2),('K',1),('P',1)]:
    s=sorted(starters(p,n)); b=backups(p,n)
    out.append(f"| {p} | {st.mean(s):.1f} | {s[int(.9*len(s))]} | {st.mean(b) if b else float('nan'):.1f} | {st.mean(s)-(st.mean(b) if b else 0):.1f} |")
out+=["\n## Coaching staff (talent 1.5, vs league-average staff, 640 pairs/arm)\n","| roles | rating | margin [95% CI] | win% [95% CI] |","|---|---|---|---|"]
for l in open('data/staff_swap.jsonl'):
    r=json.loads(l); out.append(f"| {r['roles']} | {r['rating']} | {z(r['dMargin'],r['seMargin'])} | {z(r['dWinPct'],r['seWinPct'])} |")
open('data/analysis_unit_summary.md','w').write("\n".join(out)+"\n"); print("\n".join(out))
