import json,gzip,math,collections,statistics as st,sys
d=json.load(gzip.open('data/expD1_baseline.json.gz'))
by=collections.defaultdict(dict)
for r in d['rows']: by[(r['kind'],r['tagless'],r['team'],r['r'])][r['scheme']]=r['margin']
def cell(kind,tag,s,neutral):
    x=[v[s]-v[neutral] for k,v in by.items() if k[0]==kind and k[1]==tag and s in v and neutral in v]
    m=st.mean(x); se=st.stdev(x)/math.sqrt(len(x)); return m,se,len(x)
def p2(z): return math.erfc(abs(z)/math.sqrt(2))
rows=[]
for kind,neutral,sch in (('off','pro_style',["west_coast","vertical","spread","power_run","zone_run"]),('def','multiple',["four_three","three_four","cover_3","cover_2","man_press"])):
    for tag in (False,True):
        for s in sch:
            m,se,n=cell(kind,tag,s,neutral); rows.append((kind,tag,s,m,se,n,p2(m/se)))
# Holm over all 20
order=sorted(range(len(rows)),key=lambda i:rows[i][6]); holm={}
for rank,i in enumerate(order):
    holm[i]=min(1,rows[i][6]*(len(rows)-rank))
for j in range(1,len(order)): holm[order[j]]=max(holm[order[j]],holm[order[j-1]])
out=[]
def P(s): print(s); out.append(s)
P("D1: coordinator scheme (rating 50) minus neutral scheme, margin pts; n=512 paired games per cell; Holm adjustment across all 20 cells")
P(f"{'side':4s} {'rosters':9s} {'scheme':11s} {'effect':>7s} {'95% CI':>16s} {'p':>7s} {'Holm p':>7s}")
for i,(kind,tag,s,m,se,n,p) in enumerate(rows):
    P(f"{kind:4s} {'tagless' if tag else 'tagged':9s} {s:11s} {m:+7.2f} [{m-1.96*se:+.2f},{m+1.96*se:+.2f}] {p:7.3f} {holm[i]:7.3f}")
for kind in ('off','def'):
    for tag in (False,True):
        sub=[r for r in rows if r[0]==kind and r[1]==tag]
        # pooled mean over schemes (average of cell means) and number significantly negative
        P(f"  {kind} {'tagless' if tag else 'tagged'}: mean of 5 scheme effects {st.mean(r[3] for r in sub):+.2f}; negative {sum(r[3]<0 for r in sub)}/5; significantly negative (p<.05 unadjusted) {sum(r[3]<0 and r[6]<.05 for r in sub)}/5; after Holm {sum(r[3]<0 and holm[rows.index(r)]<.05 for r in sub)}/5; significantly positive {sum(r[3]>0 and r[6]<.05 for r in sub)}/5")
open('data/expD1_ci_summary.txt','w').write('\n'.join(out))
