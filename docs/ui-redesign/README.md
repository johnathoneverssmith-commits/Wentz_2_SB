# UI redesign: complete

The gameday redesign of the franchise UI is finished. Every screen runs on one
design system, and the group prompts (01 to 08) that drove the work are retired.
They lived on the branch `docs/ui-redesign-prompts` (PR #83, never merged) and
are not needed again.

Read the **"UI design system (gameday)"** section of the root `CLAUDE.md` for the
current rules: where the tokens and blocks live, the `GdPage` shell, the shared-file
rule, the verification matrix, the photo credit, and the pinned data files.

Known leftovers (not part of the redesign; see `docs/qa-longitudinal/GROUP-08-REPORT.md`):
the navy sidebar and the dialogs/overlays are still dark and still use the old
page tokens.
