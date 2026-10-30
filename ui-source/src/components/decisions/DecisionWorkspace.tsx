import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { getMotionLevel } from '@/motion/level';
import { MotionSurface } from '@/motion/MotionSurface';
import { TeamCrest, SportsIcon } from '@/components/roster/SportsPresentation';
import { useDialog } from '@/components/useDialog';
import { teamFullName } from '@/data/teams';
import type { DecisionRow, DecisionSort } from './decision-view';
import './decisions.css';
export function DecisionFrame({children,kind,code,focused=false}:{children:ReactNode;focused?:boolean;kind:'draft'|'market'|'trade';code?:string|null}) {
 return <div className={'decision-workspace decision-'+kind} data-team={code??''} data-focused={focused}>{children}</div>;
}
export function DecisionHeading({code,title,subtitle,children}:{code?:string|null;title:string;subtitle:string;children?:ReactNode}) {
 return <header className="decision-heading">{code&&<TeamCrest code={code}/>}<div><p className="decision-eyebrow">{code?teamFullName(code):'Franchise front office'}</p><h1>{title}</h1><p>{subtitle}</p></div>{children&&<div className="decision-heading-side">{children}</div>}</header>;
}
export function DecisionSortControl({value,onChange}:{value:DecisionSort;onChange:(value:DecisionSort)=>void}) {
 return <label className="decision-sort">Sort board <select value={value} onChange={e=>onChange(e.target.value as DecisionSort)}><option value="board">Board order</option><option value="name">Name A–Z</option><option value="rating">Rating — highest</option><option value="age">Age — youngest</option></select></label>;
}
export function CompareToggle({row,selected,onToggle}:{row:DecisionRow;selected:readonly string[];onToggle:(id:string)=>void}) {
 const on=selected.includes(row.id);
 return <button type="button" className="decision-compare-toggle" aria-label={`${on?'Remove from comparison':'Compare'} ${row.name}`} aria-pressed={on} disabled={!on&&selected.length>=2} onClick={()=>onToggle(row.id)}>{on?'Comparing':'Compare'}</button>;
}
export function DecisionComparison({rows,ids,onClear}:{rows:readonly DecisionRow[];ids:readonly string[];onClear:()=>void}) {
 const chosen=ids.map(id=>rows.find(p=>p.id===id)).filter((p):p is DecisionRow=>!!p);
 return <MotionSurface className="decision-context"><div className="decision-section-title"><h2><SportsIcon name="roster"/>Player comparison</h2>{ids.length>0&&<button type="button" className="btnlink" onClick={onClear}>Clear comparison</button>}</div>{chosen.length===0?<p className="decision-muted">Choose up to two players to compare their public ratings, age and scouting information.</p>:<div className="decision-comparison">{chosen.map(p=><article key={p.id} data-player-id={p.id}><h3>{p.name}</h3><p>{p.position} · Age {p.age}</p><strong>{p.rating} <small>{p.ratingLabel}</small></strong>{p.context&&<p>{p.context}</p>}</article>)}</div>}</MotionSurface>;
}
export function ConfirmDecision({title,children,onCancel,onConfirm,disabled=false}:{title:string;children:ReactNode;onCancel:()=>void;onConfirm:()=>void;disabled?:boolean}) {
 const ref=useDialog(onCancel);const id=useId();
 return <div className="modal-scrim" onClick={onCancel}><div ref={ref} className="modal-card decision-confirm" role="dialog" aria-modal="true" aria-labelledby={id} onClick={e=>e.stopPropagation()}><div className="modal-head"><h2 id={id}>{title}</h2></div><div className="modal-body">{children}</div><div className="modal-foot"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="btn-primary" disabled={disabled} onClick={onConfirm}>Confirm pick</button></div></div></div>;
}
export function toggleComparison(ids:readonly string[],id:string):string[] {
 return ids.includes(id)?ids.filter(x=>x!==id):ids.length<2?[...ids,id]:[...ids];
}

/** Keep a rejected action visible even when its form is below a mobile board. */
export function DecisionError({message}:{message:string|null}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(message){ref.current?.focus({preventScroll:true});ref.current?.scrollIntoView({block:'center',behavior:getMotionLevel()==='off'?'auto':'smooth'});}},[message]);
 return message?<div ref={ref} className="notice bad" role="status" tabIndex={-1}>{message}</div>:null;
}

export function FocusedOfferPanel({title,children}:{title:string;children:ReactNode}) {
 const ref=useRef<HTMLElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.scrollIntoView({block:'nearest',behavior:getMotionLevel()==='off'?'auto':'smooth'});ref.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 return <section ref={ref} className="decision-context" aria-label={`Offer to ${title}`}><h2>{title}</h2>{children}</section>;
}
