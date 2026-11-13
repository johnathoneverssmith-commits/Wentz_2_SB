#!/usr/bin/env bash
# COMP-006 orchestrator. Fans single league-runs out over N parallel workers; skips runs whose output exists (resumable).
#   ./run.sh <outdir> "<seeds>" "<talents>" "<arms>" <seasons> [seats=4] [workers=4] [mods=] [tag_suffix=]
# e.g. ./run.sh out "101 102 103" "1 1.5" "control skilled" 10
set -euo pipefail
cd "$(dirname "$0")"
OUT=${1:?outdir}; SEEDS=${2:?seeds}; TALENTS=${3:?talents}; ARMS=${4:?arms}; SEASONS=${5:?seasons}
SEATS=${6:-4}; WORKERS=${7:-4}; MODS=${8:-}; SUFFIX=${9:-}
export NFL_POOL_PATH="$(cd ../.. && pwd)/ui-source/src/data/pool-2026.json"
mkdir -p "$OUT/logs"
jobs=()
for sd in $SEEDS; do for t in $TALENTS; do for arm in $ARMS; do
  tag="${arm}_s${sd}_t${t}${SUFFIX}"
  [ -f "$OUT/$tag.json" ] || jobs+=("$sd $t $arm $tag")
done; done; done
echo "${#jobs[@]} runs to do, $WORKERS workers"
printf '%s\n' "${jobs[@]}" | xargs -P "$WORKERS" -L1 bash -c '
  sd=$0; t=$1; arm=$2; tag=$3
  C6=1 C6_SEED=$sd C6_TALENT=$t C6_ARM=$arm C6_SEASONS='"$SEASONS"' C6_SEATS='"$SEATS"' C6_MODS='"$MODS"' C6_OUT='"$OUT"' C6_TAG=$tag \
    npx --prefix ../.. vitest run -c vitest.config.ts run.test.ts > '"$OUT"'/logs/$tag.log 2>&1 \
    && echo "done $tag" || echo "FAILED $tag (see logs)"
'
