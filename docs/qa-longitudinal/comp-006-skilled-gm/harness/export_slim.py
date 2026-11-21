#!/usr/bin/env python3
"""Export the raw per-run JSON files to two small committed CSVs (the raw files are ~150 KB each and regenerable).

  seat_seasons.csv  one row per (arm, mods, talent, seed, season index, SEAT team) with the outcomes the analysis uses
  league_seasons.csv one row per (arm, mods, talent, seed, season index): champion, seat-won flag, CPU-team means
  runs.csv           one row per run: runtime, engine calls, talent scale seen, fingerprint, seat ledger totals

Usage: python3 export_slim.py <results_dir> <out_dir>
"""
import csv, glob, json, os, sys

ROUND = {"none": 0, "WC": 1, "DIV": 2, "CONF": 3, "SB": 4}


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    seat_rows, league_rows, run_rows = [], [], []
    for f in sorted(glob.glob(os.path.join(src, "*.json"))):
        j = json.load(open(f)); sp = j["spec"]; mods = "+".join(sp.get("mods") or []) or "-"
        seats = set(sp["seats"]) if sp["arm"] != "control" else set(sp["seats"])
        cens = {x["team"]: x["censoredFrom"] for x in j["seats"]}
        ledger = {}
        for x in j["seats"]:
            for k, v in x["ledger"].items():
                ledger[k] = ledger.get(k, 0) + v
        run_rows.append(dict(arm=sp["arm"], mods=mods, talent=sp["talent"], seed=sp["seed"], seasons=len(j["rows"]),
                             seats="|".join(sp["seats"]), runtime_s=round(j["runtimeSec"], 1), engine_calls=j["engineCalls"],
                             talent_scales_seen=json.dumps(j["talentScalesSeen"]), fingerprint=j["fingerprint"][:16],
                             **{f"ledger.{k}": round(v, 2) for k, v in sorted(ledger.items())}))
        for i, r in enumerate(j["rows"], 1):
            cpu = [t for c, t in r["teams"].items() if c not in seats]
            league_rows.append(dict(arm=sp["arm"], mods=mods, talent=sp["talent"], seed=sp["seed"], idx=i, season=r["season"],
                                    champion=r["champion"], seat_won=int(r["champion"] in seats),
                                    cpu_unit_start=round(sum(t["start"]["unitScore"] for t in cpu) / len(cpu), 3),
                                    cpu_cap_space=round(sum(t["end"]["capTotal"] - t["end"]["capUsed"] for t in cpu) / len(cpu), 2)))
            for team in sp["seats"]:
                t = r["teams"][team]
                seat_rows.append(dict(arm=sp["arm"], mods=mods, talent=sp["talent"], seed=sp["seed"], idx=i, season=r["season"], team=team,
                                      censored=int(cens.get(team) is not None and i >= cens[team]),
                                      wins=t["w"], losses=t["l"], ties=t["t"], pf=t["pf"], pa=t["pa"], playoffs=int(t["playoffs"]),
                                      po_depth=ROUND[t["round"]], title=int(t["champion"]),
                                      unit_start=round(t["start"]["unitScore"], 3), top24_start=round(t["start"]["top24"], 3),
                                      team_ovr_start=t["start"]["overall"], qb_start=t["start"]["qb"], unit_end=round(t["end"]["unitScore"], 3),
                                      cap_used=t["end"]["capUsed"], cap_total=t["end"]["capTotal"], dead=t["end"]["dead"],
                                      next_commit=round(t["end"]["nextCommit"], 2), age_top24=round(t["end"]["age"], 2), roster_n=t["end"]["rosterN"]))

    def w(name, rows):
        keys = []
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        with open(os.path.join(dst, name), "w", newline="") as fh:
            wr = csv.DictWriter(fh, fieldnames=keys, restval=0); wr.writeheader(); wr.writerows(rows)

    w("seat_seasons.csv", seat_rows); w("league_seasons.csv", league_rows); w("runs.csv", run_rows)
    print(f"{len(seat_rows)} seat-seasons, {len(league_rows)} league-seasons, {len(run_rows)} runs -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
