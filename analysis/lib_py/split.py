"""§7 data-split & model-selection protocol.

Chronological, never a random play-level split.

  development pass : train 2023      -> validate 2024   (choose features/form/reg)
  locked eval pass : train 2023+2024 -> test 2025       (frozen; do not tune on this)
  production refit : 2023+2024+2025

Kickoff exception (§7): 2023 is a different rule regime, so
  development : train 2024 -> validate 2025   (no separate locked season available)
  production  : 2024+2025
The schema audit also showed 2024 != 2025 sharply; a kickoff model should carry
a season/regime indicator regardless.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Split:
    name: str
    dev_train: tuple[int, ...]
    dev_val: tuple[int, ...]
    locked_train: tuple[int, ...]
    locked_test: tuple[int, ...]
    production: tuple[int, ...]


STANDARD = Split(
    name="standard",
    dev_train=(2023,),
    dev_val=(2024,),
    locked_train=(2023, 2024),
    locked_test=(2025,),
    production=(2023, 2024, 2025),
)

KICKOFF = Split(
    name="kickoff",
    dev_train=(2024,),
    dev_val=(2025,),
    locked_train=(2024,),
    locked_test=(2025,),
    production=(2024, 2025),
)
