import type { Player } from '@/domain';
import type { UnitRow } from '@/state/unitReport';
import { RosterNeeds } from '@/components/RosterNeeds';
import { MotionMeter } from '@/motion/MotionSurface';
import { TEAMS_BY_CODE } from '@/data/teams';
export function DraftContext({pickOrder,current,recent,roster,units,mode}:{pickOrder:string[];current:number;recent:{pickNumber:number;selectedName?:string|null;teamCode:string}[];roster:Player[];units:UnitRow[];mode:'fantasy'|'rookie'}) {
 return <><section className="decision-context"><h2>Upcoming selections</h2><div className="decision-pick-strip">{pickOrder.slice(current,current+6).map((code,i)=><div key={current+i}><small>Pick {current+i+1}</small>{TEAMS_BY_CODE[code]?.label??code}</div>)}</div><p className="decision-muted">{mode==='fantasy'?'Drafted roster only — grades describe your incomplete roster.':'Your current roster — including your signed players.'}</p><details><summary>Roster needs &amp; unit grades</summary><RosterNeeds roster={roster}/>{units.map(u=><div key={u.key} className="decision-unit"><p>{u.label} · {u.grade}</p><MotionMeter value={u.strength} label={`${u.label} drafted roster strength`}/></div>)}</details></section><section className="decision-context"><h2>Recent picks</h2>{recent.length?[...recent].slice(-5).reverse().map(p=><p key={p.pickNumber}><b>#{p.pickNumber} · {TEAMS_BY_CODE[p.teamCode]?.abbr??p.teamCode}</b><br/>{p.selectedName??'Pick recorded'}</p>):<p className="decision-muted">The first selection is still to come.</p>}</section></>;
}
