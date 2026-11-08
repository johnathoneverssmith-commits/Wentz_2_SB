#!/bin/bash
# Resume: arms not already in unit_swap.jsonl, 20 reps (640 pairs) to fit the time budget; staff sweep follows.
cd "$(dirname "$0")"
done_has(){ grep -q "\"unit\":\"$1\",\"delta\":\"$2\",\"talent\":$3," ../data/unit_swap.jsonl; }
arms=()
for U in WRTE RB FRONT LB SECONDARY K P; do for D in -10 10; do done_has $U $D 1 || arms+=("$U $D 1"); done; done
for a in "QB abs:72 1.5" "QB abs:95 1.5" "OL -10 1.5" "OL 10 1.5"; do set -- $a; done_has $1 $2 $3 || arms+=("$a"); done
printf '%s\n' "${arms[@]}" | xargs -P4 -I{} sh -c 'set -- {}; npx tsx unit_swap.ts $1 $2 20 $3 >> ../data/unit_swap.jsonl'
printf '%s\n' "HC,OC,DC 95" "HC,OC,DC 20" "HC 95" "OC 95" "DC 95" "OC 20" "DC 20" "HC 20" | xargs -P4 -I{} sh -c 'set -- {}; npx tsx staff_swap.ts $1 $2 20 1.5 >> ../data/staff_swap.jsonl'
