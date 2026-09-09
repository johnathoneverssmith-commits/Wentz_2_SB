"""Phase B empirical-modeling shared library (spec §6–§8, §20).

Windows-on-ARM note: parquet I/O is via polars (no pyarrow ARM64 wheel).
sklearn is fed numpy arrays / pandas frames built from polars.
"""
