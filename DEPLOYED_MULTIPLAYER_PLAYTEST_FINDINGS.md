# Deployed Multiplayer Playtest Findings

## Test context

- Deployed website: <https://wentz-2-sb-2.onrender.com/#/online>
- Primary focus: multiplayer progression, interface behavior, AI decision making, and commissioner controls
- Human playtest findings take precedence wherever they conflict with automated or AI-assisted observations.
- Global requirement: fix both the local and online versions, and ensure every committed change is reflected in each UI.

## Findings and requested changes

### 1. Fantasy Draft automation and completion

The automatic completion of the Fantasy Draft after all human-controlled picks are made now works well.

#### 1a. Add an explicit advance button

After the automated picks finish and the Fantasy Draft is complete, provide a button that advances users to the Fantasy Draft Summary. The intended design should not rely on the side column for progression.

#### 1b. Remove the Projected Pick column

The **Projected Pick** column should not automatically label the highest-overall available players as first, second, and third. Remove this column because its ranking is based on overall rating rather than position-adjusted value.

#### 1c. Add a commissioner-controlled manual-pick limit

Add a dropdown in League Settings that lets the commissioner specify how many Fantasy Draft picks human users will make before the game simulates the remainder of the draft.

### 2. Expandable coach and player details

In the Coaching Draft, clicking a coach or player name should open an inline dropdown containing specific and relative attributes. Examples include throwing strength of 67 or tackling of 99.

### 3. Add an advance button after the Coaching Draft

After all Coaching Draft selections are complete, provide a button that advances users to the Coaching Draft Summary.

### 4. Make multiplayer checkpoints true gate screens

Every **Advance** button should take the user to the next intended screen. These transitions currently occur around multiplayer synchronization checkpoints.

Create dedicated gate screens for multiplayer checkpoints. When an Advance button leads to a synchronized checkpoint, it should take the user to that gate screen and clearly show the current progression state.

### 5. Place Free Agency offers beneath the selected player

The **Offer** button currently opens the offer controls at the bottom of the page. The controls should instead expand directly beneath the selected player's name.

### 6. Rework Free Agency contract and bidding logic

Free Agency contract acceptance and AI bidding need further tuning. Josh Allen, the best player in the league, accepted the first and smallest offer submitted by the testing user. This suggests that no other team bid or that no AI team offered more.

Required changes:

1. Improve the logic used by AI teams to value players and submit competitive offers.
2. If multiple teams bid on a player, keep that player in Free Agency for the next round.
3. Continue the bidding process until only one team remains in the bidding war for a full round.
4. If the Free Agency period ends while multiple bidders remain, award the player to the team with the highest offer.

### 7. Add an advance button from Free Agency to its summary

Provide an explicit button that advances users from Free Agency to the Free Agency Summary.

### 8. Preserve the Roster and Cap Reconciliation page

The Roster and Cap Reconciliation page works well and should be retained. In the deployed QA league, it correctly confirmed a legal **53/53 roster**, positive cap space, and coverage at every required position.

### 9. Fix advancement into Training Camp

Clicking **Advance to Training Camp** should immediately take the user to Training Camp or to the appropriate multiplayer gate screen.

### 10. Remove obsolete random-event and investment controls

When the hooded-figure design was implemented, the Random Events and Season Investments options should have been removed from League Settings and Training Camp. Remove those obsolete controls.

### 11. Preserve the Training Camp Results section

The Training Camp Results section works well and should be retained.

### 12. Fix advancement into depth-chart reordering

Clicking **Advance to Re-order Depth Chart** should take the player to the depth-chart reordering screen or to the appropriate multiplayer gate screen.

### 13. Remove implementation-facing interface text

Remove text that explains internal mechanics or exposes implementation details to players. Examples include:

- “Nobody waits on you until you press this.”
- “These were already played.”

Replace these messages with concise language that describes the player's next action and the league's current state.

### 14. Value first-round picks using projected draft position

Teams should value first-round picks according to the offering team's current record and resulting projected draft position. For example, a first-round pick from an 0–9 team should be worth substantially more than one from a 9–0 team. A 9–0 team should generally accept the favorable exchange, while the 0–9 team should reject the reverse.

### 15. Increase AI-generated trade diversity

Every AI-generated offer observed consisted of two lower-overall players for one higher-overall player. AI proposals need more variety. Most offers should be able to include:

- Draft picks for a player
- Draft picks plus players for a player
- Pick-for-pick exchanges
- Other packages that fit team needs, strategy, cap constraints, and competitive timeline

### 16. Add a way to advance past the trade deadline

Provide a button that lets players advance beyond the trade deadline. The tested playthrough became stuck at this stage.

## Additional deployed observations

### 17. Make interrupted stage transitions recover clearly and safely

During deployed testing, some stage changes remained on **Simulating…**, temporarily returned to cached pending controls after reload, or left the Online Leagues page at **Looking for the league server…**. In at least one case, the server later showed that the requested transition had succeeded.

The client should:

- Distinguish a pending request from a failed request.
- Reconcile cached state with authoritative server state after reconnecting.
- Prevent duplicate submissions while a transition outcome is unknown.
- Explain whether the user should wait, retry, or take another action.
- Preserve the correct destination when a completed transition is recovered.

### 18. Correct two progression display defects

Two text errors appeared during deployed testing:

- The Coaching Draft briefly displayed **Round 13 of 12**.
- The Coaching Draft Summary displayed **Offense 2th** instead of **Offense 2nd**.

### 19. Keep deployed and local test evidence separate

The current browser findings come from the deployed online workflow. Local headless simulation results should not be presented as proof that the deployed multiplayer workflow works.

The completed browser testing was a workflow smoke test. It was not a completed multi-season telemetry, balance, or determinism run against the deployed service.

## Acceptance criteria

- Every completed stage has a visible and functional Advance button.
- Each Advance button opens the correct next screen or a dedicated multiplayer gate screen.
- Reloading or reconnecting cannot send the user backward or expose stale actionable controls.
- Ambiguous requests are idempotent and cannot duplicate picks, bids, simulations, or phase changes.
- Commissioner settings visibly affect the behavior they describe.
- Fantasy Draft and Coaching Draft summaries are reachable without relying on a side column.
- Free Agency bidding produces competitive multi-team behavior and resolves deterministically under the approved rules.
- Trade valuation accounts for projected draft position, roster needs, player value, cap impact, and team strategy.
- Local and online interfaces contain the same committed features and fixes.
