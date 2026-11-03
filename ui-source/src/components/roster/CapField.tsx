import { millions } from "@/util/format";

const YARD_LINES = [10, 20, 30, 40, 50, 40, 30, 20, 10];

/** One decimal, the way yardage is read: "6.4". */
const yards = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/**
 * The salary cap drawn as a football field: the whole cap is 100 yards, the
 * ball sits where spending has reached, and the striped end zone is what is
 * left to sign with. Over the cap, the ball is past the goal line and the
 * headline says by how far.
 *
 * Display only: every figure is the screen's own reported cap number.
 */
export function CapField({ total, used, room, dead }: { total: number; used: number; room: number; dead: number }) {
  if (total <= 0) {
    return (
      <section className="gd-field" aria-label="Salary cap">
        <div className="gd-field-top"><h2>Cap not available</h2></div>
      </section>
    );
  }
  const over = room < 0;
  const freePct = Math.max(0, Math.min(100, (room / total) * 100));
  const ballPct = Math.max(0, Math.min(100, (used / total) * 100));
  const togo = Math.abs((room / total) * 100);
  return (
    <section className="gd-field" aria-label="Salary cap" data-over={over || undefined}>
      <div className="gd-field-top">
        <div>
          <h2>
            {yards(togo)} yards {over ? "over" : "to"} the <em>cap line</em>
          </h2>
          <p>
            The field is your {millions(total)} salary cap. The ball marks what you have spent
            {over ? ", and it is past the goal line." : ", and the striped end zone is what you can still sign."}
          </p>
        </div>
        <dl className="gd-cap-figures">
          <div className="gd-cap-figure"><dt>Cap space</dt><dd className={over ? "bad" : undefined}>{millions(room)}</dd></div>
          <div className="gd-cap-figure"><dt>Cap used</dt><dd>{millions(used)}</dd></div>
          <div className="gd-cap-figure"><dt>Dead money</dt><dd>{millions(dead)}</dd></div>
        </dl>
      </div>
      <div
        className="gd-pitch"
        role="img"
        aria-label={`${millions(used)} of the ${millions(total)} cap used; ${over ? `${millions(-room)} over` : `${millions(room)} free`}`}
      >
        {!over && <div className="gd-endzone" style={{ width: `${freePct}%` }} />}
        <div className="gd-ball" style={{ left: `${ballPct}%` }} />
        <div className={"gd-flag" + (ballPct < 50 ? " right" : "")} style={{ left: `${ballPct}%` }}>{millions(used)} used</div>
      </div>
      <div className="gd-yards" aria-hidden="true">
        {YARD_LINES.map((y, i) => <span key={i}>{y}</span>)}
      </div>
      <p className="gd-field-foot">
        <span><b>{millions(dead)}</b> in dead money</span>
        <span>Every 10 yards is {millions(total / 10)}</span>
      </p>
    </section>
  );
}
