"""Agent 3 follow-up analysis -> data/analysis_followup.md (run from the agent folder: python3 harness/analyze_followup.py)"""
import json, math, statistics as st, collections
def z(x,se): return f"{x:+.2f} [{x-1.96*se:+.2f},{x+1.96*se:+.2f}]"
o=["# Follow-up results (95% CI = 1.96 SE)\n","## Single-starter +10 (640 pairs each, talent 1.0)\n","| starter | margin [CI] | win% pts [CI] |","|---|---|---|"]
for l in sorted(open('data/unit_single.jsonl'),key=lambda l:-json.loads(l)['dMargin']):
    r=json.loads(l); o.append(f"| {r['pos']} slot {r['slot']} | {z(r['dMargin'],r['seMargin'])} | {z(r['dWinPct'],r['seWinPct'])} |")
o+=["\n## Equal-payroll QB test (640 pairs): QB rating change financed evenly by the other 22 slots at the game's FA price curve\n","| talent | QB change | others (mean) | margin [CI] | win% pts [CI] |","|---|---|---|---|---|"]
for l in sorted(open('data/qb_budget.jsonl'),key=lambda l:(json.loads(l)['talent'],-json.loads(l)['qbDeltaRequested'])):
    r=json.loads(l); o.append(f"| {r['talent']} | {r['meanQbDeltaApplied']:+.1f} | {r['meanOthersDelta']:+.2f} | {z(r['dMargin'],r['seMargin'])} | {z(r['dWinPct'],r['seWinPct'])} |")
d=json.load(open('data/flip_sign_and_trade.json'))
o+=["\n## Sign-and-flip (real judgeWith + checkTrade; 4 seeds x ranks {0,4} x contract years {1,4} = 16 cases/position per room setting)\n",
"room=true: each CPU team first released its worst player (a free roster slot). Pick value = sum of the game's own chart values of the picks the best-paying CPU team would give.\n",
"| pos | cases sold/16 | mean salary $M | mean picks received / player chart value | mean CPU teams willing | mean best pick value |","|---|---|---|---|---|---|"]
g=collections.defaultdict(list)
for r in d:
    if r['room']: g[r['pos']].append(r)
for p,rs in g.items():
    ok=[r for r in rs if r['bestPickValue']>0]
    o.append(f"| {p} | {len(ok)}/{len(rs)} | {st.mean(r['salaryM'] for r in rs):.1f} | {(st.mean(r['bestPickValue']/r['chartValue'] for r in ok) if ok else float('nan')):.2f} | {st.mean(r['teamsWillingToPay'] for r in rs):.1f} | {(st.mean(r['bestPickValue'] for r in ok) if ok else 0):.1f} |")
nr=[r for r in d if not r['room']]
o.append(f"\nroom=false (rosters full at 53): sold in {sum(1 for r in nr if r['bestPickValue']>0)}/{len(nr)} cases; the 53-man limit blocks nearly every CPU team.\n")
s=json.load(open('data/skill_split_real_engine.json'))
dl=collections.defaultdict(list)
for r in s:
    h=[r['wins'][t] for t,g_ in r['group'].items() if g_=='hi']; l=[r['wins'][t] for t,g_ in r['group'].items() if g_=='lo']; dl[r['seed']].append(st.mean(h)-st.mean(l))
per=[st.mean(v) for v in dl.values()]
o+=["## CPU management-skill split (real engine; GM skill +2.5 vs -2.5 on alternating teams, 6 leagues x 5 seasons)\n",
f"Mean (high - low skill) wins/team/season by league: {', '.join(f'{x:+.2f}' for x in per)}; overall {st.mean(per):+.2f} (SE across leagues {st.stdev(per)/math.sqrt(len(per)):.2f}). Titles high/low: {sum(1 for r in s for t,g_ in r['group'].items() if g_=='hi' and r['champion']==t)}/{sum(1 for r in s for t,g_ in r['group'].items() if g_=='lo' and r['champion']==t)} of {len(s)} seasons.\n"]
open('data/analysis_followup.md','w').write("\n".join(o)+"\n"); print("\n".join(o))
