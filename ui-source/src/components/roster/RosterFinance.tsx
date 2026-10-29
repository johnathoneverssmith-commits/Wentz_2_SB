import type { Contract } from "@/domain";
import { AnimatedNumber } from "@/motion/AnimatedNumber";
import { MotionSurface } from "@/motion/MotionSurface";
import { millions } from "@/util/format";
import { m } from "framer-motion";
import { useMotion } from "@/motion/tokens";
import { SportsIcon } from "./SportsPresentation";

/** Passive display: these are the roster screen's existing reported values. */
export function RosterFinance({ total, used, room, dead }: {
  total: number; used: number; room: number; dead: number;
}) {
  const motion = useMotion();
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
  const circumference = 2 * Math.PI * 74;
  return <div role="region" aria-label="Player cap overview">
    <MotionSurface className="sports-panel roster-finance-summary">
      <div className="ui-section-heading"><div><h2>Salary cap overview</h2><p>Total player cap · {millions(total)}</p></div></div>
      <div className="cap-overview-body">
      {total > 0 ? <div className="cap-ring" role="meter" aria-label="Reported player cap used" aria-valuenow={Math.min(total, Math.max(0, used))} aria-valuetext={`${used} of ${total}`} aria-valuemin={0} aria-valuemax={total}>
        <svg viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r="74" fill="none" stroke="var(--cap-ring-track)" strokeWidth="17"/><g transform="rotate(-90 90 90)"><m.circle cx="90" cy="90" r="74" fill="none" stroke="var(--sports-teal)" strokeWidth="17" strokeLinecap="round" strokeDasharray={circumference} initial={motion.off ? false : { strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - ratio) }} transition={{ ...motion.enter, duration: motion.dur * 2 }}/></g></svg>
        <div><strong>{Math.round(used / total * 100)}%</strong><b><AnimatedNumber value={used} format={millions}/></b><small>of {millions(total)}</small></div>
      </div> : <p>Cap not available</p>}
      <dl className="roster-money-facts">
        <div><dt><i className="legend-dot teal"/>Used</dt><dd>{millions(used)}</dd></div>
        <div><dt><i className="legend-dot blue"/>Available</dt><dd className={room < 0 ? "bad" : "good"}>{millions(room)}</dd></div>
        <div><dt><i className="legend-dot red"/>Dead money</dt><dd>{millions(dead)}</dd></div>
        <div><dt>Cap total</dt><dd>{millions(total)}</dd></div>
      </dl>
      </div>
    </MotionSurface>
  </div>;
}

export function StaffCost({ value }: { value: number }) {
  return <div className="roster-staff-cost"><SportsIcon name="roster"/><span>Coaching staff<small>Outside the player cap</small></span><strong>{millions(value)}<small>/ year</small></strong></div>;
}

/** No pricing/projection rules: render exactly the terms supplied on the player. */
export function ContractFacts({ contract }: { contract: Contract | null | undefined }) {
  if (!contract) return <p className="emptystate">No contract on record.</p>;
  return <section className="roster-contract-facts" aria-label="Contract details">
    <div className="ui-section-heading"><h3>Contract details</h3><span>{contract.years_remaining} {contract.years_remaining === 1 ? "year" : "years"} remaining</span></div>
    <dl className="roster-deal-totals">
      <div><dt>Cap hit</dt><dd>{contract.cap_hit_by_year[0] === undefined ? "—" : millions(contract.cap_hit_by_year[0])}</dd></div>
      <div><dt>Total value</dt><dd>{millions(contract.total_value)}</dd></div>
      <div><dt>Guaranteed</dt><dd>{millions(contract.guaranteed)}</dd></div>
      <div><dt>Signing bonus</dt><dd>{millions(contract.signing_bonus)}</dd></div>
    </dl>
    <p className="roster-money-label">Scheduled cap hits</p>
    {contract.cap_hit_by_year.length ? <dl className="roster-deal-years">
      {contract.cap_hit_by_year.map((hit, i) => <div key={i}><dt>Remaining year {i + 1}</dt><dd>{millions(hit)}</dd></div>)}
    </dl> : <p className="ui-caption">No cap schedule on record.</p>}
  </section>;
}
