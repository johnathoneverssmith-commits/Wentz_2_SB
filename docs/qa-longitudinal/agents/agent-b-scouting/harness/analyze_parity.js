const f=process.argv[2],arm=process.argv[3];const d=require(f);const by={};for(const x of d)(by[x.seed]??={})[x.arm]=x;
const st=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length,sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));return `${m>=0?"+":""}${m.toFixed(3)}±${(sd/Math.sqrt(a.length)).toFixed(3)}`};
for(const y of [0,1,3,5]){const h=[],c=[];for(const s of Object.values(by)){if(!s[arm].rating[y])continue;const C=s.control.rating[y],M=s[arm].rating[y];const dh=s[arm].treated.map(t=>M[t]-C[t]),dc=s[arm].cpu.map(t=>M[t]-C[t]);h.push(dh.reduce((a,b)=>a+b)/dh.length);c.push(dc.reduce((a,b)=>a+b)/dc.length)}
console.log(arm,"year",y,"the 11 teams",st(h),"| the 21 CPU teams",st(c))}
