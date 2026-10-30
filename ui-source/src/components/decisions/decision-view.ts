export interface DecisionRow { id:string; name:string; position:string; rating:number; ratingLabel:string; age:number; context?:string }
export type DecisionSort='board'|'name'|'rating'|'age';
/** Public display allowlist; never spread a player or prospect into a comparison. */
export function publicDecisionRow(p:{id:string;name:string;position:string;overall:number;age:number},context?:string):DecisionRow {
 return {id:p.id,name:p.name,position:p.position,rating:p.overall,ratingLabel:'OVR',age:p.age,context};
}
export function sortDecisionRows<T extends {id:string;name:string;rating:number;age:number}>(rows:readonly T[],sort:DecisionSort):T[] {
 const copy=[...rows];
 if(sort==='name') copy.sort((a,b)=>a.name.localeCompare(b.name));
 if(sort==='rating') copy.sort((a,b)=>b.rating-a.rating);
 if(sort==='age') copy.sort((a,b)=>a.age-b.age);
 return copy;
}
export function resolveDecision<T extends {id:string}>(rows:readonly T[],id:string|null,canAct:boolean):T|undefined {
 return canAct?rows.find(p=>p.id===id):undefined;
}
/** Counters retain proposer-oriented payloads; only the viewer's labels are reoriented. */
export function counterSelectionForViewer<T>(fromTeam:string,viewer:string,gives:readonly T[],gets:readonly T[]):{give:readonly T[];get:readonly T[]} {
 return fromTeam===viewer?{give:gives,get:gets}:{give:gets,get:gives};
}
/** Keep comparison UI responsive when picks/signings remove selected IDs. Preserve reference when unchanged. */
export function pruneComparison(ids:string[],rows:readonly {id:string}[]):string[] {
 const available=new Set(rows.map(p=>p.id));const next=ids.filter(id=>available.has(id));return next.length===ids.length?ids:next;
}
