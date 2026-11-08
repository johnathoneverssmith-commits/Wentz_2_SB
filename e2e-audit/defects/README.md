# Defect register

`manual.json` holds the entries a probe cannot measure. Each:

```json
{
  "id": "M-001",
  "title": "short, specific",
  "severity": "S1 | S2 | S3 | S4",
  "screens": ["hub-week-9"],
  "teams": ["PIT"],
  "viewports": ["320"],
  "repro": ["numbered steps starting from a fixture: team, stage, route, width"],
  "expected": "what the design reference says",
  "actual": "what is rendered",
  "proposedFix": "the smallest presentation-only change",
  "evidence": ["PIT/hub-week-9__320__baseline.png"],
  "status": "open | fixed-in-pr | wont-fix | needs-design",
  "pr": "link, required when fixed-in-pr"
}
```

The generated `DEFECT_REGISTER.md` and `defect-register.json` land in the run's output directory (git-ignored); the final
report copies the relevant ones with their screenshots.
