# Portrait integration guide (PR #72 <-> PR #70)

PR #70 adds `ui-source/src/components/PlayerPortrait.tsx` (`PlayerPortrait`, `PlayerThumb`) and `state/portrait.ts`.
PR #72 adds `ui-source/src/visual/PortraitSlot.tsx`, used by the scouting dossier. A trial merge of each branch
with this branch (`git merge-tree`, at head 85bd486) is textually clean, but #70 and #72 both edit `AppShell.tsx`,
`App.tsx`, `DraftRoom.tsx`, `domain/league.ts` and `howItWorks.ts`, so they are left independent rather than
cross-wired here: wiring them needs #70's files, and doing it in #72 would duplicate that work.

## After #70 is on master (one small change, in `visual/PortraitSlot.tsx`)
```tsx
import { PlayerThumb } from "@/components/PlayerPortrait";
// keep the 3:4 slot box; PlayerPortrait is 1:1.2, so size it to the slot width and let the slot crop
function DefaultPortrait({ player }: { player: Pick<Player, "id" | "name" | "nfl_team"> }) {
  return <PlayerThumb player={player as never} size={size} className="portrait-fill" />;
}
```
- `PortraitSlot` already receives `player` (`id`, `name`, `position`); add `nfl_team` to its prop type and to the call in
  `components/PlayerDossier.tsx` (the dossier has the whole `Player`).
- Delete the silhouette `DefaultPortrait` svg and its `.portrait-default` CSS in `components/player-dossier.css`.
- The slot's `role="img"` + `aria-label` stays (the portrait itself is decorative), so do not also pass `label`.
- A drafted-but-unsigned player has `nfl_team: "FA"`: `PlayerThumb` falls back to a neutral jersey, which is correct.
- Never feed the portrait anything hidden (it depends only on id and league seed, so this holds).

## Merge order
1. #70 (portraits), 2. #71, 3. #72 and then the change above; or #72 first and the change above lands with #70.
Expected textual conflicts: none found by trial merge. Semantic overlap to re-check after each merge:
`howItWorks.ts` (this PR renames the user-facing label to "Methodology"; any new #70/#71 text that says
"How it works" should say "Methodology"), and e2e specs `decision-workflows` / `decision-online-ui` (this PR changed
the fantasy-draft "Compare" step to opening the dossier; #71 also edits them).
