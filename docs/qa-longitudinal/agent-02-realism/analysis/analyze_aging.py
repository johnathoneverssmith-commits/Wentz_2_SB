"""Player development / aging / retirement / elite-talent analysis from the jsonl 'players' snapshots."""
import json, sys, collections
import numpy as np
from analyze_longrun import load, slope

def tabulate(path, tag):
    cfg, S, snaps = load(path)
    pre = {o["season"]: o for o in snaps if o["tag"] == "preseason"}
    post = {o["season"]: o for o in snaps if o["tag"] == "post-playoffs"}
    def idx(o): return {r[0]: r for r in o["rows"]}
    yrs = sorted(pre)
    out = {"tag": tag, "years": yrs}
    PRE = {y: idx(pre[y]) for y in yrs}; POST = {y: idx(post[y]) for y in post}
    # roster-relevant = on a team, not retired, not FA
    def active(r): return r[5] == 0 and r[6] == 0 and r[4] not in (None, "", "FA") and not str(r[4]).startswith("PS:")
    # --- delta by age & pos group (preseason y -> preseason y+1), for players active (any status not retired) in both
    G = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "OT": "OL", "OG": "OL", "C": "OL", "EDGE": "DL", "DT": "DL", "ILB": "LB", "OLB": "LB", "CB": "DB", "S": "DB", "K": "K", "P": "K", "LS": "LS", "FB": "RB", "DE": "DL", "LB": "LB"}
    d = collections.defaultdict(lambda: collections.defaultdict(list))
    dall = collections.defaultdict(list)
    for y in yrs[:-1]:
        for pid, r in PRE[y].items():
            r2 = PRE[y + 1].get(pid)
            if not r2 or r2[5] == 1 or r[5] == 1: continue
            if r[3] < 50: continue  # skip fringe/placeholder
            g = G.get(r[1], r[1]); ag = min(max(r[2], 21), 36)
            d[g][ag].append(r2[3] - r[3]); dall[ag].append(r2[3] - r[3])
    out["delta_by_age_all"] = {str(a): [len(v), float(np.mean(v)), float(np.std(v))] for a, v in sorted(dall.items())}
    out["delta_by_age_pos"] = {g: {str(a): [len(v), round(float(np.mean(v)), 2)] for a, v in sorted(dd.items()) if len(v) >= 8} for g, dd in d.items()}
    # peak age per group = age at which cumulative mean ovr (given by integrating mean deltas from 21) is max
    peaks = {}
    for g, dd in d.items():
        cum, best, ba = 0, -1e9, None
        for a in range(21, 37):
            if a in dd and len(dd[a]) >= 8: cum += np.mean(dd[a])
            if cum > best: best, ba = cum, a + 1
        peaks[g] = ba
    out["integrated_peak_age"] = peaks
    # mean ovr by age (rostered, ovr>=50) averaged over years
    mo = collections.defaultdict(list)
    for y in yrs:
        for r in PRE[y].values():
            if active(r) and r[3] >= 50: mo[min(r[2], 38)].append(r[3])
    out["mean_ovr_by_age"] = {str(a): [len(v), round(float(np.mean(v)), 1)] for a, v in sorted(mo.items()) if len(v) > 20}
    # retirement from post-playoffs y -> preseason y+1
    ret = collections.defaultdict(lambda: [0, 0]); retpos = collections.defaultdict(lambda: [0, 0]); retovr = collections.defaultdict(lambda: [0, 0])
    for y in yrs[:-1]:
        for pid, r in POST[y].items():
            if r[5] == 1 or r[3] < 40: continue
            r2 = PRE[y + 1].get(pid)
            gone = 1 if (r2 is None or r2[5] == 1) else 0
            a = min(max(r[2], 22), 40); ret[a][0] += 1; ret[a][1] += gone
            if r[2] >= 30: g = G.get(r[1], r[1]); retpos[g][0] += 1; retpos[g][1] += gone
            retovr[(r[3] // 10) * 10][0] += 1; retovr[(r[3] // 10) * 10][1] += gone
    out["retire_rate_by_age"] = {str(a): [v[0], round(v[1] / v[0], 3)] for a, v in sorted(ret.items()) if v[0] >= 10}
    out["retire_rate_age30plus_by_pos"] = {g: [v[0], round(v[1] / v[0], 3)] for g, v in retpos.items()}
    out["retire_rate_by_ovr_band"] = {str(a): [v[0], round(v[1] / v[0], 3)] for a, v in sorted(retovr.items())}
    # note: 'gone' includes cut/unsigned + retired flag; separate: retired flag explicitly
    rr = collections.defaultdict(lambda: [0, 0])
    for y in yrs[:-1]:
        for pid, r in POST[y].items():
            if r[5] == 1 or r[3] < 40: continue
            r2 = PRE[y + 1].get(pid)
            if r2 is None: rr[min(max(r[2], 22), 40)][1] += 1
            else: rr[min(max(r[2], 22), 40)][0] += 1
    out["pruned_from_state_or_present_by_age"] = {str(a): v for a, v in sorted(rr.items())}
    # retired starters (ovr>=75): how many per year and ages
    rs = collections.defaultdict(list)
    for y in yrs[:-1]:
        for pid, r in POST[y].items():
            if r[5] == 0 and r[3] >= 75:
                r2 = PRE[y + 1].get(pid)
                if r2 is None or r2[5] == 1: rs[y].append(r[2])
    out["retiring_75plus_per_year"] = float(np.mean([len(v) for v in rs.values()])) if rs else 0
    out["retiring_75plus_mean_age"] = float(np.mean(sum(rs.values(), []))) if rs else None
    # rookies: players new in preseason y+1 (not in y)
    rk = collections.defaultdict(list); rk_pos = collections.defaultdict(list); first_ids = {}
    for y in yrs[1:]:
        for pid, r in PRE[y].items():
            if pid not in PRE[y - 1] and pid not in first_ids:
                first_ids[pid] = (y, r)
    ent = [(y, r) for y, r in first_ids.values()]
    out["rookie_n_per_year"] = len(ent) / (len(yrs) - 1)
    out["rookie_age"] = {"mean": float(np.mean([r[2] for y, r in ent])), "p10": float(np.percentile([r[2] for y, r in ent], 10)), "p90": float(np.percentile([r[2] for y, r in ent], 90))}
    out["rookie_ovr"] = {"mean": float(np.mean([r[3] for y, r in ent])), "p90": float(np.percentile([r[3] for y, r in ent], 90)), "p99": float(np.percentile([r[3] for y, r in ent], 99)), "max": int(max(r[3] for y, r in ent))}
    out["rookie_ovr_by_year"] = {str(y): round(float(np.mean([r[3] for yy, r in ent if yy == y])), 2) for y in yrs[1:]}
    # rookie trajectories: ovr at entry vs +1, +2, +3, +4 for rookies (age<=23)
    traj = collections.defaultdict(list)
    for pid, (y0, r0) in first_ids.items():
        if r0[2] > 24: continue
        for k in (1, 2, 3, 4):
            r = PRE.get(y0 + k, {}).get(pid)
            if r and r[5] == 0: traj[k].append(r[3] - r0[3])
    out["rookie_growth"] = {str(k): [len(v), round(float(np.mean(v)), 2), round(float(np.std(v)), 2), round(float(np.percentile(v, 90)), 1)] for k, v in traj.items()}
    # late-round breakout: entry ovr<=60 reaching >=78 within 4 years (of rookies with >=4yr observed)
    bo = [0, 0]
    for pid, (y0, r0) in first_ids.items():
        if r0[2] > 24 or r0[3] > 62 or y0 + 4 > yrs[-1]: continue
        bo[1] += 1; mx = max([PRE.get(y0 + k, {}).get(pid, [0] * 9)[3] for k in range(1, 5)] or [0]); bo[0] += mx >= 78
    out["breakout_entry_le62_to_78plus_within4"] = bo
    # rookies who start as 80+
    out["rookies_80plus_per_year"] = float(np.mean([sum(1 for yy, r in ent if yy == y and r[3] >= 80) for y in yrs[1:]]))
    out["rookies_70plus_per_year"] = float(np.mean([sum(1 for yy, r in ent if yy == y and r[3] >= 70) for y in yrs[1:]]))
    # potential vs outcome
    pv = [(r0[7], max([PRE.get(y0 + k, {}).get(pid, [0] * 9)[3] for k in range(1, 6)] or [0])) for pid, (y0, r0) in first_ids.items() if r0[7] is not None and y0 + 5 <= yrs[-1]]
    if pv: out["potential_vs_peak5y"] = {"n": len(pv), "corr": float(np.corrcoef([a for a, b in pv], [b for a, b in pv])[0, 1]), "mean_peak_minus_pot": float(np.mean([b - a for a, b in pv])), "share_exceed_pot": float(np.mean([b > a for a, b in pv]))}
    # elite counts per year (rostered)
    el = {}
    for y in yrs:
        rs_ = [r for r in PRE[y].values() if active(r)]
        el[y] = {"n_active": len(rs_), "n85": sum(r[3] >= 85 for r in rs_), "n90": sum(r[3] >= 90 for r in rs_), "n95": sum(r[3] >= 95 for r in rs_), "n75": sum(r[3] >= 75 for r in rs_), "mean_age": float(np.mean([r[2] for r in rs_])), "share32plus": float(np.mean([r[2] >= 32 for r in rs_])), "mean_ovr": float(np.mean([r[3] for r in rs_])),
                 "mean_ovr_top_per_pos": {p: round(float(np.mean(sorted([r[3] for r in rs_ if r[1] == p], reverse=True)[:32])), 1) for p in ("QB", "RB", "WR", "TE", "OT", "EDGE", "DT", "ILB", "CB", "S", "K")},
                 "n85_by_pos": dict(collections.Counter(r[1] for r in rs_ if r[3] >= 85))}
    out["elite_by_year"] = {str(y): v for y, v in el.items()}
    for k in ("n85", "n90", "n75", "mean_age", "mean_ovr", "share32plus"):
        ys = [el[y][k] for y in yrs]; out[f"trend_{k}"] = {"first3": float(np.mean(ys[:3])), "last3": float(np.mean(ys[-3:])), "slope": slope(ys)[0], "se": slope(ys)[1]}
    # max ages
    out["max_active_age"] = {p: int(max([r[2] for y in yrs for r in PRE[y].values() if active(r) and r[1] == p] or [0])) for p in ("QB", "RB", "WR", "TE", "OT", "EDGE", "DT", "ILB", "CB", "S", "K")}
    out["n_age_36plus_active_per_year"] = float(np.mean([sum(1 for r in PRE[y].values() if active(r) and r[2] >= 36) for y in yrs]))
    # career length of retired (by first-seen..last-seen) skipped
    # rating-year stability: share of players with |delta|>=8 in one year (age<30)
    big = [x for a, v in dall.items() if a < 30 for x in v]
    out["abs_delta_ge8_share_u30"] = float(np.mean(np.abs(big) >= 8)); out["delta_sd_u30"] = float(np.std(big))
    big = [x for a, v in dall.items() if a >= 33 for x in v]; out["delta_mean_33plus"] = float(np.mean(big)); out["delta_sd_33plus"] = float(np.std(big))
    return out

if __name__ == "__main__":
    o = tabulate(sys.argv[1], sys.argv[2])
    json.dump(o, open(f"data/aging_{sys.argv[2]}.json", "w"), indent=1, default=lambda x: float(x) if isinstance(x, (np.floating, np.integer)) else str(x))
    print(json.dumps({k: v for k, v in o.items() if k not in ("elite_by_year", "delta_by_age_pos")}, indent=0, default=str)[:5500])
