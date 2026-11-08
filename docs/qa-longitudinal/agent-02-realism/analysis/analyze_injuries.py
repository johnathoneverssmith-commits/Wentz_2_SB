import json, sys, collections, numpy as np
sys.path.insert(0, 'analysis')
from analyze_longrun import load
res = {}
for tag, f in (('A1', '7001_amplified'), ('A2', '7002_amplified'), ('R1', '7003_realistic')):
    cfg, S, sn = load(f'/tmp/a02/run_{f}.jsonl')
    S = S[1:]  # drop burn-in season
    inj = [e for s in S for e in s['inj'] if e[0] == 'REG']
    ntg = sum(2 * sum(1 for g in s['games'] if g[0] == 'REG') for s in S)
    r = {'events_per_team_game': len(inj) / ntg, 'by_severity': dict(collections.Counter(e[5] for e in inj))}
    pos = collections.Counter(e[4] for e in inj); r['by_pos_share'] = {k: round(v / len(inj), 3) for k, v in pos.most_common()}
    dur = collections.defaultdict(list)
    for e in inj: dur[e[5]].append(sum(e[6]) / 2)
    r['mean_proj_weeks'] = {k: round(float(np.mean(v)), 2) for k, v in dur.items()}
    # per-player-position rate: injuries per 100 player-seasons (using stats rows, gamesPlayed>=1)
    cnt = collections.Counter(); 
    for s in S:
        for p in s['stats']: cnt[p[1]] += 1
    r['inj_per_100_player_seasons'] = {k: round(100 * pos[k] / cnt[k], 1) for k in cnt if cnt[k] > 200}
    # consistency: gamesPlayed vs injury min weeks (season-ending) -> players injured wk<=10 with min>=8 weeks yet gamesPlayed >= 14
    viol = n = 0
    for s in S:
        ge = {}
        for e in s['inj']:
            if e[0] == 'REG' and e[6][0] >= 8 and e[1] <= 9: ge[e[3]] = e
        for p in s['stats']:
            if p[0] in ge:
                n += 1; viol += p[5]['gamesPlayed'] > 17 - ge[p[0]][6][0] + 1
    r['long_injury_gamesPlayed_check'] = {'n': n, 'violations': viol}
    # share of team-seasons with a QB1 injury (qualified QBs <14 games)
    q = [p for s in S for p in s['stats'] if p[1] == 'QB' and p[5]['passAtt'] >= 200]
    r['qualified_QB_games_lt14_share'] = float(np.mean([p[5]['gamesPlayed'] < 14 for p in q]))
    r['games_played_mean_RB_over100car'] = float(np.mean([p[5]['gamesPlayed'] for s in S for p in s['stats'] if p[1] == 'RB' and p[5]['rushAtt'] >= 100]))
    res[tag] = r
json.dump(res, open('data/injuries.json', 'w'), indent=1); print(json.dumps(res, indent=1))
