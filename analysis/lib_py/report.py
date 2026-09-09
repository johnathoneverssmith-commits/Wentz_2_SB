"""§20 per-resolver report scaffold.

Every resolver produces `artifacts/models/<name>.report.md` + `.json` with the
§20-mandated structure and the required no-ratings statement.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"

REQUIRED_STATEMENT = "No current game player ratings were used to fit the nflverse baseline."

# §20 mandated section order.
_SECTIONS = [
    "model name",
    "target definition",
    "eligible population",
    "row count by season",
    "missingness",
    "class distribution / target distribution",
    "predictor list",
    "forbidden-variable check",
    "baseline model",
    "challenger models",
    "2024 validation metrics",
    "2025 locked test metrics",
    "calibration plots",
    "important conditional diagnostics",
    "historical residual variance estimates",
    "final chosen model",
    "production refit metadata",
]


class ModelReport:
    def __init__(self, model_id: str, name: str) -> None:
        self.model_id = model_id
        self.name = name
        self.generated = date.today().isoformat()
        self._sections: dict[str, str] = {}
        self._data: dict[str, object] = {}
        self.set("model name", f"{model_id} — {name}")

    def set(self, section: str, markdown: str) -> "ModelReport":
        if section not in _SECTIONS:
            raise KeyError(f"unknown §20 section: {section!r}")
        self._sections[section] = markdown.rstrip()
        return self

    def data(self, key: str, value: object) -> "ModelReport":
        self._data[key] = value
        return self

    def write(self) -> tuple[Path, Path]:
        missing = [s for s in _SECTIONS if s not in self._sections]
        if missing:
            raise ValueError(f"{self.model_id}: report missing §20 sections: {missing}")

        md = [f"# {self.model_id} — {self.name}", "", f"Generated {self.generated}.",
              "", f"> {REQUIRED_STATEMENT}", ""]
        for s in _SECTIONS:
            md.append(f"## {s}")
            md.append("")
            md.append(self._sections[s])
            md.append("")

        models_dir = ARTIFACTS / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        md_path = models_dir / f"{self.model_id.lower()}.report.md"
        json_path = models_dir / f"{self.model_id.lower()}.report.json"
        md_path.write_text("\n".join(md), encoding="utf-8")
        json_path.write_text(
            json.dumps(
                {
                    "model_id": self.model_id,
                    "name": self.name,
                    "generated": self.generated,
                    "required_statement": REQUIRED_STATEMENT,
                    **self._data,
                },
                indent=2,
                default=str,
            )
            + "\n",
            encoding="utf-8",
        )
        return md_path, json_path


def rows_by_season_table(counts: dict[int, int]) -> str:
    head = "| season | rows |\n| --- | ---: |\n"
    body = "\n".join(f"| {s} | {n:,} |" for s, n in sorted(counts.items()))
    return head + body


def metrics_table(metrics: dict, keys: list[str]) -> str:
    head = "| metric | value |\n| --- | ---: |\n"
    rows = []
    for k in keys:
        v = metrics.get(k)
        rows.append(f"| {k} | {v:.5f} |" if isinstance(v, float) else f"| {k} | {v} |")
    return head + "\n".join(rows)
