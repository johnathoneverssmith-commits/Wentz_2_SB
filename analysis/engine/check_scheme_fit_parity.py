"""TS/Python parity check for the scheme-fit shifts (run by test/engine-scheme-fit-parity.test.ts).

    python3 analysis/engine/check_scheme_fit_parity.py <fixture.json>

Loads the TypeScript baselines into ``staff_fit``'s caches, recomputes every
shift from the same units, and requires agreement to 1e-9.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import staff_fit as sf  # noqa: E402
from engine.staff import DEF_SCHEME_TAGS, OFF_SCHEME_TAGS  # noqa: E402

fx = json.loads(Path(sys.argv[1]).read_text())
sf._baseline = fx["baseline"]
sf._slot = fx["slots"]
worst = 0.0
n = 0


def close(a: dict, b: dict) -> None:
    global worst, n
    for k in ("complete", "rush"):
        d = abs(a[k] - b[k])
        worst = max(worst, d)
        n += 1
        assert d < 1e-9, (k, a, b)


for unit, expect in zip(fx["units"], fx["shifts"]):
    off = dict(zip(sf._OFF_SLOTS, unit["off"]))
    dfn = dict(zip(sf._DEF_SLOTS, unit["def"]))
    for sc in OFF_SCHEME_TAGS:
        close(sf.off_scheme_fit_shift(sc, off), expect["off"][sc]["legacy"])
        close(sf.off_scheme_fit_shift_derived(sc, off), expect["off"][sc]["derived"])
    for sc in DEF_SCHEME_TAGS:
        close(sf.def_scheme_fit_shift(sc, dfn), expect["def"][sc]["legacy"])
        close(sf.def_scheme_fit_shift_derived(sc, dfn), expect["def"][sc]["derived"])
print(f"parity ok: {n} values, max abs diff {worst:.2e}")
