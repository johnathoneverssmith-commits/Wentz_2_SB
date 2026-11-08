"""
Experiment E (MATHEMATICAL MODEL - not an engine result): does a sustained, intelligently-built advantage of +a team-rating
points create unstoppable dynasties?  Dynamics are fitted to the REAL-engine CPU-run leagues of PR #105 (X1, 8 leagues x 8 seasons):
  team rating: AR(1), rho and sd from X1; margin/game = M_PER_RATING * rating gap, game sd = 13.5 (NFL);
  M_PER_RATING = 1.9 (X1: ~1.0 win/season per rating point  =>  ~2 margin points per rating point).
A focal team gets a persistent +a (an UPPER bound: in a real game the edge has to be re-bought every year).
Run:  python3 expE_dynasty_model.py <x1_dir> <out.json>
"""
import json,glob,sys,math,random,statistics as st
x1dir,out=sys.argv[1],sys.argv[2]
rows=[]
for f in glob.glob(x1dir+'/x1_[abc].json'): rows+=json.load(open(f))
by={}
for r in rows: by.setdefault(r['seed'],[]).append(r)
pairs=[]; allx=[]
for s,L in by.items():
    L.sort(key=lambda r:r['season'])
    for r in L[1:]: allx+=list(r['ovr'].values())
    for a,b in zip(L[1:],L[2:]):   # skip burn-in year
        ma=st.mean(a['ovr'].values()); mb=st.mean(b['ovr'].values())
        for t in a['ovr']: pairs.append((a['ovr'][t]-ma,b['ovr'][t]-mb))
sd=st.pstdev([p[0] for p in pairs]); n=len(pairs)
rho=sum(x*y for x,y in pairs)/sum(x*x for x,y in pairs)
M=1.9; GSD=13.5
def phi(z): return 0.5*(1+math.erf(z/math.sqrt(2)))
eps_sd=sd*math.sqrt(1-rho*rho)
rng=random.Random(20261108)
def season(x):
    n=len(x); wins=[0]*n
    conf=[list(range(0,16)),list(range(16,32))]
    for i in range(n):
        for _ in range(17):
            j=rng.randrange(n-1); j=j+1 if j>=i else j
            if rng.random()<phi(M*(x[i]-x[j])/GSD): wins[i]+=1
    champs=[]
    for c in conf:
        order=sorted(c,key=lambda i:(-wins[i]-rng.random()*0.01))[:7]
        def g(a,b): return a if rng.random()<phi(M*(x[a]-x[b])/GSD) else b
        w=[g(order[1],order[6]),g(order[2],order[5]),g(order[3],order[4])]
        w.sort(key=lambda i:order.index(i))
        s2=[g(order[0],w[2]),g(w[0],w[1])]
        s2.sort(key=lambda i:order.index(i)); champs.append(g(s2[0],s2[1]))
    return wins,g(champs[0],champs[1]) if False else (champs[0] if rng.random()<phi(M*(x[champs[0]]-x[champs[1]])/GSD) else champs[1])
res={}
N=int(sys.argv[3]) if len(sys.argv)>3 else 1500
for a in (0,0.5,1,1.5,2,3):
    titles=[];ge3=0;streak3=0;wins_f=[];po=[];best_cpu=[];share=[]
    for _ in range(N):
        x=[rng.gauss(0,sd) for _ in range(32)]
        tl=0;run=0;mx=0;cpu_t=[0]*32
        for y in range(10):
            x=[rho*v+rng.gauss(0,eps_sd) for v in x]
            xe=x[:]; xe[0]+=a
            w,ch=season(xe)
            wins_f.append(w[0])
            if ch==0: tl+=1;run+=1;mx=max(mx,run)
            else: run=0; cpu_t[ch]+=1
        titles.append(tl); ge3+= tl>=3; streak3+= mx>=3; best_cpu.append(max(cpu_t))
    res[a]={'wins_per_season':st.mean(wins_f),'titles_per_decade':st.mean(titles),'P_3plus_titles_in_10y':ge3/N,'P_3_straight':streak3/N,'best_CPU_team_titles_per_decade':st.mean(best_cpu),'fair_share_titles_per_decade':10/32}
    print(a,{k:round(v,3) for k,v in res[a].items()})
json.dump({'rho':rho,'rating_sd':sd,'eps_sd':eps_sd,'pairs':n,'M_PER_RATING':M,'sims_per_cell':N,'cells':res},open(out,'w'),indent=1)
