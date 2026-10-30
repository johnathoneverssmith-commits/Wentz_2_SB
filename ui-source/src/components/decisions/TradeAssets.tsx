import type { ReactNode } from 'react';
export type AssetStep='you'|'them'|'review';
export function AssetNavigation({step,onChange,give,get}:{step:AssetStep;onChange:(step:AssetStep)=>void;give:number;get:number}) {
 return <div className="decision-mobile-steps" role="group" aria-label="Trade workflow">{(['you','them','review'] as const).map(s=><button type="button" key={s} aria-pressed={step===s} onClick={()=>onChange(s)}>{s==='you'?`Your assets (${give})`:s==='them'?`Their assets (${get})`:'Review'}</button>)}</div>;
}
export function AssetSummary({give,get,children}:{give:{id:string;name:string}[];get:{id:string;name:string}[];children?:ReactNode}) {
 return <section aria-label="Selected trade assets"><div className="decision-selected-assets">{[{title:'You send',assets:give},{title:'You receive',assets:get}].map(side=><div key={side.title}><h3>{side.title}</h3>{side.assets.length?<ul>{side.assets.map(p=><li key={p.id} data-asset-id={p.id}>{p.name}</li>)}</ul>:<p className="decision-muted">No assets selected</p>}</div>)}</div>{children}</section>;
}
