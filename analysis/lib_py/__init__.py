"""Phase B empirical-modeling shared library (spec §6–§8, §20).

Windows-on-ARM notes:
  * parquet I/O is via polars (no pyarrow ARM64 wheel); sklearn is fed numpy.
  * scipy-openblas oversubscribes threads badly here — an unconstrained
    multinomial lbfgs fit took 90s for 9 iterations. Pinning BLAS/OpenMP to a
    single thread drops that to 0.03s. These env vars MUST be set before numpy
    is imported, so every `NN_*.py` imports `lib_py` as its first import.
"""

import os as _os

for _v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    _os.environ.setdefault(_v, "1")
