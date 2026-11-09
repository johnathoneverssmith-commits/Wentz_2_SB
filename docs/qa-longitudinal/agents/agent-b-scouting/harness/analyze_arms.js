// paired difference of treated-team rating vs the same team in the control draft; per-seed means, SE over seeds
const d=require(process.argv[2]);const yrs=(process.env.YRS||"0").split(",");
const bySeed={};for(const x of d)(bySeed[x.seed]??={})[x.arm]=x;
const arms=[...new Set(d.map(x=>x.arm))].filter(a=>a!="control");
const stat=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length,sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));return [m,sd/Math.sqrt(a.length)];};
for(const a of arms){const cells=[];
 for(const y of yrs){const dl=[];for(const s of Object.values(bySeed)){const c=s.control,r=s[a];if(!r||!r.rating[y]||!c.rating[y])continue;const m=r.treated.map(t=>r.rating[y][t]-c.rating[y][t]);dl.push(m.reduce((x,z)=>x+z,0)/m.length);}
  if(dl.length>1){const [m,se]=stat(dl);cells.push(`y${y} ${m>=0?"+":""}${m.toFixed(3)}±${se.toFixed(3)}`);}}
 const q=d.filter(x=>x.arm==a).flatMap(x=>x.q);const mm=f=>q.reduce((s,x)=>s+f(x),0)/(q.length||1);
 const n=Object.values(bySeed).filter(s=>s[a]).length;
 console.log(a.padEnd(7),"n="+n,cells.join("  "));
 console.log("        reports",q.length,"rmse public→report",Math.sqrt(mm(x=>(x.pub-x.tru)**2)).toFixed(2),"→",Math.sqrt(mm(x=>(x.est-x.tru)**2)).toFixed(2),"| 80% band covers",(100*mm(x=>x.tru>=x.lo&&x.tru<=x.hi?1:0)).toFixed(0)+"%","| corr(true,pub)",corr(q.map(x=>x.pub),q.map(x=>x.tru)).toFixed(2),"corr(true,report)",corr(q.map(x=>x.est),q.map(x=>x.tru)).toFixed(2));
}
function corr(a,b){const n=a.length,ma=a.reduce((x,y)=>x+y,0)/n,mb=b.reduce((x,y)=>x+y,0)/n;let s=0,va=0,vb=0;for(let i=0;i<n;i++){s+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2}return s/Math.sqrt(va*vb)}
