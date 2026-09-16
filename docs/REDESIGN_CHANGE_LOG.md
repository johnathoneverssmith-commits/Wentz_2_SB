# NFL Franchise Simulation Redesign Change Log

**Finalized product changes for the off field franchise circuit**

This document is the source of truth for redesign decisions covering the franchise experience from preseason through the postseason and offseason. A change is added only after its behavior, multiplayer implications, edge cases, and final wording have been clarified and approved.

| **Document status** | Active running specification |
|---------------------|------------------------------|
| **Last updated**    | September 15 2026            |

# Implementation status

All thirteen changes are implemented, on `main`, with 210 online tests
passing. The fifteen failing UI tests predate this work — their fixtures
assume the generated player pool that the authored `pool-2026.json`
replaced — and are unrelated to anything below.

What was built, in one paragraph per idea rather than per change:

**Blocks and reveals.** Football is simulated once, at a checkpoint, and
watched afterwards. A block runs from one checkpoint to the next thing that
could change its inputs, which is why the regular season is two of them
either side of the trade deadline. `state/revealBlocks.ts` is the single
answer to "how far can I watch" and "what happens at the end"; `state/reveal.ts`
holds each GM's own markers, and `visibleGames` / `visibleBracket` are the
filters everything downstream reads. Nothing a GM has not revealed may appear
anywhere, including in a standings table or a bracket header.

**Turn-based events.** The coaching draft, both free-agency periods, the trade
deadline and the rookie draft are all one order, one turn, one thing happening
at a time. The deadline (Change 8) is the sharpest case: one unresolved
negotiation ever, one counter per negotiation, and an order fixed from the
week 1-9 standings that does not move when a trade changes a roster.

**Per-GM position inside a stage.** Changes 12 and 13 put two screens inside
one league stage. The league keeps a single `stage` — it really is all in the
offseason together — and `reveal.step` records which screen each GM is on,
which is also what returns a disconnected GM to the screen they committed to.

**Deliberate illegality.** The trade deadline, the rookie draft and both
free-agency periods all allow a team to break the cap, the roster limit and
positional minimums. Reconciliation is where that gets enforced. A deadline
whose last legal move is blocked by arithmetic is a deadline nobody uses.

**Open optimization bookmarks**, as the spec calls them: CPU training-camp
focus and investment priorities, and CPU trade valuation, contention
assessment and future-value discounting. Both are deterministic and
deliberately simple, pending a season of results to calibrate against.

# Decisions taken during implementation

Four questions were resolved before implementation began. Two of them change
what is written further down; those sections have been amended in place and
the amendments are marked **Amended**.

**Build order.** Implement in document order, Change 1 onward, across
sessions. No reordering by size or visibility.

**Absent GMs (Change 2).** The freeze is intended and is not a bug to be
designed around. There is no commissioner override, no force-advance, and no
deadline fallback: a league waits indefinitely at a checkpoint for every
registered human GM. One GM who never returns ends that league, and that is
the accepted cost of removing every override.

*Implementation consequence:* the existing phase-deadline sweeper currently
auto-commits absent GMs after a timeout, which directly contradicts this. It
must stop applying to checkpoints. See the amendment in Change 2.

**Saved play-by-play (Changes 6, 7, 10, 11).** Precomputed blocks save
scores, statistics, standings, injuries and box scores, but **not** GAMECAST
play-by-play. Play-by-play is regenerated on reveal from the game's saved
seed. It is deterministic — the same seed and the same rosters produce the
same drives every time — so a regenerated sequence is identical to a stored
one.

*Why:* a broadcast is ~44KB and the league document travels whole on every
request. Weeks 1-9 alone is 144 games, about 6MB, on top of a document
already at 1.4MB. The free-tier database transfer quota was exhausted once
already at a fraction of that volume. Storage was not a safe option.

**Roasts (Changes 6, 7, 10).** No language model. A fixed library of roughly
1,000 authored roast lines, selected deterministically from real game data —
record, margin, statistical outliers, injuries, streaks, bye weeks. The
spec's stated fallback becomes the only path. No API key, no latency in a
checkpoint, no failure mode that can block progression, and every GM
provably sees identical commentary.

# Change 1 Predetermined Fantasy Draft Completion

**Decision.** Replace in-draft controls for completing and leaving the fantasy draft with a league setting that determines when automated drafting begins.

## League Setting

- During league creation, the commissioner selects Simulate after each user makes a specified number of picks or Never complete the entire draft manually.

- The commissioner may enter any whole-number threshold from 1 through the roster size.

- The setting becomes locked when the fantasy draft begins.

## Draft Behavior

- Manual drafting continues until every human user has completed the configured number of selections.

- Once the final human user reaches the threshold, the existing automated drafting algorithm immediately completes every remaining selection.

- The automated portion occurs entirely offscreen. Users see only a loading indicator while it is underway.

- Users cannot advance until every remaining selection has been completed and every roster has been successfully saved.

- Once completion and saving succeed, every user automatically advances to the Draft Summary screen.

## Interface Changes

- Remove the Auto Pick Rest button from the fantasy draft screen.

- Remove the Advance to Draft Summary button from the fantasy draft screen.

## Failure Handling

- If automated completion fails, the app retries automatically while users remain on the loading screen.

- The app must never advance users to Draft Summary with incomplete or unsaved rosters.

- If automatic retries fail, display a Simulation failed Retry control.

# Change 2 Single Player Sections and Multiplayer Checkpoints

**Decision.** Restructure the off field circuit as independent single-player sections connected only at dedicated multiplayer checkpoints. This is a system-wide architectural rule.

## System Wide Rule

- Replace every embedded league-readiness or league-advancement control whose state or effect depends on all human GMs.

- Preserve ordinary navigation controls that move one GM between screens within that GM's single-player section.

- At every true phase boundary, provide each GM with an individual Advance to next stage button.

- Do not display other GMs' readiness information within the preceding single-player section.

## Checkpoint Entry

- Clicking Advance to next stage permanently records that GM as ready and moves only that GM to the dedicated checkpoint.

- The commitment is irreversible. The GM cannot return to the preceding section while waiting.

- A GM who disconnects after committing does not block progression because the saved readiness state persists.

## Checkpoint Screen

- Display a loading indicator and the message Waiting for other players.

- Identify the transition with Previous stage followed by the completed stage name and Next stage followed by the upcoming stage name.

- Do not display GM names, readiness counts, or individual readiness statuses.

- Additional checkpoint information may be considered later but is not part of the current specification.

## League Advancement

- The league remains at the checkpoint until every registered human GM has committed.

- There is no commissioner override, force-advance control, or inactive-GM removal flow.

- **Amended.** Nor is there a deadline fallback. The existing phase-deadline
  sweeper auto-commits absent GMs after a timeout; it must no longer apply at
  checkpoints. A checkpoint has no clock. The league waits indefinitely, and a
  GM who never returns ends that league permanently.

- The final required commitment advances the league's saved stage.

- Connected GMs automatically enter the next section without another Continue or confirmation control.

- When a disconnected GM returns, the app reads the saved league stage and routes that GM directly to the correct section.

## Failure Handling

- If the checkpoint cannot retrieve the saved league stage, it remains on Waiting for other players and retries automatically.

- If repeated checks fail, display a Connection failed Retry control.

## First Application

- Remove the embedded Fantasy draft summary readiness panel from the Draft Summary screen, including GM readiness statuses and counts.

- Replace it with an individual Advance to Coaching button.

- After committing, move that GM to a checkpoint displaying Previous stage Draft Summary and Next stage Coaching Fantasy Draft.

- Once every GM commits, advance all connected GMs automatically to the Coaching Fantasy Draft.

# Change 3 Coaching Fantasy Draft

**Decision.** Replace the live coaching negotiation market with a saved, turn-based fantasy draft, add development and medical staff roles, and introduce a dedicated Coaching Draft Summary.

## Phase Transition

- The checkpoint after Player Draft Summary displays Previous stage Draft Summary and Next stage Coaching Fantasy Draft.

- Once every GM reaches the checkpoint, all connected GMs automatically enter the Coaching Fantasy Draft.

## Draft Structure

- Use the successful player fantasy draft's turn-based interface and saved pick behavior.

- Each team manually drafts exactly one person for each of 12 staff roles: Head Coach, Offensive Coordinator, Defensive Coordinator, Quarterbacks Coach, Running Backs Coach, Offensive Line Coach, Wide Receivers Coach, Defensive Line Coach, Linebackers Coach, Defensive Backs Coach, Special Teams Coach, and Medical Training Staff.

- On each turn, a GM may select any available candidate for any role still vacant on that team.

- All 12 selections must be made manually. There is no automation threshold or simulated remainder.

## Draft Order

- Use a snake draft.

- Coaching Round 1 uses the exact reverse of Player Draft Round 1, so the GM who selected first in the player draft selects 32nd in Coaching Round 1.

- Reverse the selection order after every coaching round.

## Staff Pools

- Retain the existing real Head Coaches, Offensive Coordinators, and Defensive Coordinators and preserve their existing gameplay effects.

- Create one fixed fictional database for the nine added staff roles.

- Generate exactly 32 candidates for each added role, requiring every candidate to be drafted.

- Use the same bounded overall-rating distribution for all nine roles: mean 72, standard deviation 15, minimum 35, and maximum 99. Redraw values outside those limits.

## Staff Responsibilities

- Quarterbacks Coach affects QB development and regression.

- Running Backs Coach affects RB and FB development and regression.

- Offensive Line Coach affects C, G, and T development and regression.

- Wide Receivers Coach affects WR and TE development and regression.

- Defensive Line Coach affects DT and EDGE development and regression.

- Linebackers Coach affects all LB classifications' development and regression.

- Defensive Backs Coach affects CB and S development and regression.

- Special Teams Coach affects K and P development and regression.

- Medical Training Staff affects injury recovery duration for all players.

## Effect Rules

- Long snappers do not exist in the league and have no staff mapping.

- Added coaches do not influence individual play outcomes.

- Better coaches accelerate development and slow regression. Worse coaches slow development and accelerate regression.

- Coaches never change when a player transitions from development to regression; they modify only the magnitude of development or decline.

- Medical Training Staff does not affect injury probability. It modifies the recovery duration generated by the existing injury engine and the resulting out-of-game recovery timeline.

## Initial Effect Math

- An overall rating of 72 is neutral.

- Each point above or below 72 changes the relevant rate by 1 percent.

- Apply the modifier in opposite directions to development and regression.

- Apply the same inverse scale to injury recovery duration.

**Optimization bookmark.** Calibrate staff-effect sizes with Claude Code after implementation and simulation testing.

## Player Draft Summary Additions

- Preserve the existing Player Draft Summary interface and its large Every Team comparison table unchanged.

- Add one detailed tab for each human-controlled team, defaulting to the current user's team.

- Add one NFL tab in addition to the human-team tabs and all existing summary content.

- Within the NFL tab, provide one dropdown for selecting any of the 32 teams.

- Display the selected team's complete roster in a conventional, visually appealing football-roster layout organized by position group.

- In the NFL tab, show only each player's position, name, age, and overall rating.

## Coaching Draft Summary

- After the final coaching selection, automatically move every GM into an independent Coaching Draft Summary with no dependency on another GM's actions.

- Provide one detailed tab for each human-controlled team, defaulting to the current user's team.

- Each human-team tab displays that team's complete 12-person staff and all relevant coach characteristics.

- For Head Coach, Offensive Coordinator, and Defensive Coordinator, display name, role, overall rating, and all existing characteristics.

- For added position and Special Teams Coaches, display name, role, overall rating, affected player group, and development and regression modifiers.

- For Medical Training Staff, display name, role, overall rating, and recovery-duration modifier.

- Include a large Every Team coaching comparison table matching the existing Player Draft Summary's visual style.

## Coaching Comparison Table

- Include Team, Staff OVR, HC rank, Offensive coaching rank, Defensive coaching rank, Special Teams rank, Medical rank, and overall coaching-staff grade.

- Calculate the offensive composite from the Offensive Coordinator and the QB, RB, OL, and WR coaches.

- Calculate the defensive composite from the Defensive Coordinator and the DL, LB, and DB coaches.

- Calculate Staff OVR as a weighted average across all 12 staff members.

- Apply the existing summary-screen grading logic to weighted Staff OVR.

## Initial Composite Weighting

- Head Coach receives 3 weight units.

- Offensive Coordinator and Defensive Coordinator each receive 2 weight units.

- Each remaining staff member receives 1 weight unit.

- In the offensive composite, the OC contributes 33.3 percent and the QB, RB, OL, and WR coaches each contribute 16.7 percent.

- In the defensive composite, the DC contributes 40 percent and the DL, LB, and DB coaches each contribute 20 percent.

**Optimization bookmark.** Reassess the composite weighting and grading math with Claude Code after implementation and testing.

## Exit to Free Agency

- Each GM independently clicks an irreversible Advance to Free Agency button.

- The button moves only that GM into the standard multiplayer checkpoint displaying Previous stage Coaching Draft Summary and Next stage Free Agency.

- Once every GM commits, all connected GMs automatically enter Free Agency.

# Change 4 Turn Based Free Agency and Roster Finalization

Decision. Replace the live free-agency market with a saved, five-round turn-based event using the player fantasy draft interface, followed by independent roster reconciliation before Training Camp.

## Free Agency Board

- Use the existing player fantasy draft board styling, organization, and player data for every player not selected during the initial Player Fantasy Draft.

- Add each player’s expected salary, displayed as average salary per year, and exactly one fixed primary value.

- Provide three freely accessible tabs during the event: Unsigned, Roster Needs, and Signed.

- Remove the old Free Agency section from the Team Hub.

## Player Primary Values

- Assign each player one of seven primary values: Salary, Starting Opportunity, Championship Contention, Location, Warm Climate, Position Coach Quality, or Rebuild Leadership Opportunity.

- The primary value reflects the player’s fixed profile, including age, overall rating, career stage, and role, and remains consistent across leagues.

- Salary evaluates the offer’s average annual salary.

- Starting Opportunity evaluates weakness or vacancy at the player’s position.

- Championship Contention evaluates roster strength and projected competitiveness.

- Location evaluates proximity to a fixed preferred region assigned to the player.

- Warm Climate evaluates the team’s climate classification.

- Position Coach Quality evaluates the overall rating of the coach responsible for the player’s position group.

- Rebuild Leadership Opportunity evaluates the combination of a weak roster, veteran status, and an opportunity for a prominent role.

**Optimization bookmark.** Define and calibrate the exact profile-assignment probabilities with Claude Code after implementation and testing.

## Event Structure and Order

- Free Agency lasts five rounds unless the Unsigned pool becomes empty earlier.

- Use one fixed order for every round based on roster ranking at the start of Free Agency: the best-ranked roster acts first and the worst-ranked roster acts last.

- The reverse competitive advantage is intentional because weaker teams act later with knowledge of the existing offers.

- On each turn, a team may submit one offer to one unsigned player or pass.

- An offer or pass becomes irreversible immediately after confirmation.

- Human turns have no timer. The league waits until the active GM submits an offer or passes.

- Human teams receive no simulation, autopick, or automated-completion option.

## Offer Rules

- Every offer includes an average annual salary and a whole-number contract length from one through five years.

- An offer must meet or exceed the player’s expected average annual salary to be eligible for acceptance, regardless of team fit.

- Submitted offers are binding and cannot be edited or withdrawn.

- A team may submit another distinct offer to the same player during a later round using any salary and any permitted term.

- All prior offers remain active and carry into subsequent rounds until the player signs.

- Contract length does not affect the player’s selection among offers.

- The leading offer is determined by the combination of average annual salary and fit with the player’s primary value.

- Beside each unsigned player, display the current leading team, average annual salary, and contract length.

- If adjusted offer scores tie, the higher average annual salary wins. If the salaries are also identical, the earliest submitted offer wins.

**Optimization bookmark.** Define and calibrate the exact salary-and-fit scoring model with Claude Code after implementation and testing.

## Round Resolution

- Players sign only after the final team completes its turn in a round.

- Resolve the entire round offscreen while every user sees only a loading screen.

- Before anyone enters the next round, evaluate all offers, complete every eligible signing, update every roster and board tab, and save the complete result.

- At the end of a round, the best eligible offer for each player is accepted.

- A player without an eligible offer remains unsigned, and all submitted offers for that player carry into the next round.

- Move completed signings to the Signed tab only after the full round has resolved.

- If the Unsigned pool becomes empty before Round 5, end Free Agency immediately and advance every GM to the Free Agency Summary after resolution and saving finish.

## Board Tabs

- Unsigned displays all available players and their current leading offers.

- Roster Needs reuses the existing positional cards showing the number on the roster compared with the minimum legal requirement.

- Move the existing Roster Needs panel from the Team Hub into the Free Agency Board and remove its Return to Team Hub and Roster and Cap buttons.

- Roster Needs is informational and may be opened or closed freely without affecting the active turn or turn order.

- Signed displays the winning team, average annual salary, contract length, and signing round for every completed signing.

## Remaining Free Agents

- After Free Agency ends, preserve every unsigned player and all player data in a persistent league-wide free-agent pool.

- Access to and use of the persistent pool will be defined in a later change.

## CPU Team Behavior

- CPU teams automatically submit an offer or pass when their turns occur.

- Every CPU decision seeks to maximize that team’s probability of winning the Super Bowl during the upcoming season.

- After losing a bid, a CPU team adapts its saved, deterministic rule-based strategy during subsequent rounds and seasons.

**Optimization bookmark.** Define and calibrate CPU offer selection, bidding, adaptation, and roster-value weights with Claude Code after implementation and testing.

## Temporary Free Agency Exceptions

- During the turn-based Free Agency Board, allow every human and CPU team to exceed the salary cap and maximum roster size.

- Do not enforce final positional minimums during bidding.

- Restore and enforce all financial and roster restrictions during the reconciliation stage.

## Free Agency Summary

- After Round 5, or after an early end caused by an empty Unsigned pool, automatically move each GM into an independent Free Agency Summary.

- Your Results displays that GM’s successful signings and winning contracts as well as unsuccessful offers.

- League Signings displays every signed player, signing team, average annual salary, contract length, and signing round.

- Remaining Pool displays the persistent league-wide pool of unsigned players.

- Provide a separate Roster and Budget reconciliation tab.

## Reconciliation Requirements

- Make the Roster and Budget tab glow red whenever the team violates any reconciliation requirement.

- Keep Advance to Training Camp locked until the team is under the salary cap, is at or below the roster maximum, and meets every minimum positional requirement.

- Allow the GM to advance only after all three requirements are satisfied simultaneously.

- Advancing to Training Camp is irreversible. The GM cannot return to the Free Agency Summary or reconciliation tabs.

## Reconciliation Actions

- Allow cuts and releases of eligible players, subject to a current-season salary-cap penalty.

- Use the initial release-penalty formula: the lesser of 20 percent of average annual salary multiplied by years remaining or 80 percent of average annual salary.

- Remove all future salary obligations after an eligible player is released.

- Allow eligible veteran contracts to be restructured or extended only when the new agreement benefits the player.

- For example, extending a contract from two years to five requires an increase in average annual salary.

- Lock players signed during the current Free Agency event from release or restructuring through the upcoming season.

- In later seasons, those free-agent signings may become eligible for modification.

- Lock future rookie-drafted players from contract modification throughout their rookie contracts.

**Optimization bookmark.** Reassess the release penalty and player-benefit acceptance formulas with Claude Code after implementation and testing.

## Emergency Minimum Roster Players

- If a team cannot otherwise meet a minimum positional requirement, generate only the number of emergency players needed to fill the missing slots.

- Each emergency player has a 0 overall rating and a one-year contract with a salary of zero.

- Emergency players count toward the maximum roster size.

- After the season, place each emergency player into the league-wide free-agent pool unless the team retains that player on a new contract.

## CPU Reconciliation

- CPU teams must satisfy the same salary-cap, roster-maximum, and positional-minimum requirements before progression.

- CPU teams preserve their new Free Agency signings during the immediate reconciliation stage.

- CPU teams may use player-beneficial restructures, eligible releases, and emergency 0-overall players to become compliant.

- Every CPU reconciliation action seeks to maximize the team’s probability of winning the Super Bowl during the upcoming season.

**Optimization bookmark.** Define and calibrate CPU reconciliation priorities with Claude Code after implementation and testing.

## Exit to Training Camp

- Once reconciliation is complete, unlock Advance to Training Camp.

- Advancing is irreversible and moves that GM directly into the independent Training Camp stage without a multiplayer checkpoint.

- Training Camp mechanics and the later depth-chart transition are defined in Change 5.

# Change 5 Training Camp

Decision. Add an independent Training Camp stage for player development and regression, coordinator focus choices, and season-long event investments before depth-chart finalization and the Preseason checkpoint.

## Revised Stage Order

- Use the following sequence: Free Agency Summary and reconciliation, Training Camp, Training Camp Results, Re-order Depth Chart, multiplayer checkpoint, and Preseason.

- Do not place a multiplayer checkpoint before Training Camp.

- Do not place Re-order Depth Chart before Training Camp.

- Training Camp and Training Camp Results are entirely independent single-player sections.

## Mandatory Coordinator Focuses

- Require every GM to select exactly one offensive coordinator focus and exactly one defensive coordinator focus before Training Camp can run.

- The offensive options are QB, RB and FB, OL, and WR and TE.

- The defensive options are DL and EDGE, LB, and DB consisting of CB and S.

- Neither focus may be left unselected.

## Training Camp Calculation Order

- Use the existing player development and regression engine to generate each player’s base development, regression, or unchanged result.

- Apply the previously approved position-coach modifier to that base result.

- Apply the relevant coordinator-focus modifier when the player belongs to either selected focus group.

- Save every final overall-rating change before opening Training Camp Results.

## Initial Coordinator Focus Formula

- Calculate focus strength as F equals 10 percent plus 0.5 percent multiplied by Coordinator OVR minus 72, with a minimum of 3 percent and a maximum of 24 percent.

- For a developing player in the selected group, multiply the position-coach-modified development change by 1 plus F.

- For a regressing player in the selected group, multiply the position-coach-modified regression magnitude by 1 minus F.

- Coordinator focus improves development and reduces regression but never changes the career point at which a player transitions from development to regression.

- Even a poor coordinator provides a small positive focus effect because deliberately assigned practice resources never harm the selected group.

**Optimization bookmark.** Reassess the coordinator-focus strength, caps, rounding, and stacking behavior with Claude Code after implementation and testing.

## Seasonal Event Investments

- Provide two separate monetary fields: Investment in increasing positive-event odds and Investment in decreasing negative-event odds.

- Accept nonnegative decimal values entered in millions of dollars and display the dollar-millions unit clearly.

- Default both fields visibly to 0.

- Allow either or both investments to remain at zero.

- Do not allow the combined investments to exceed the team’s remaining cap space.

- When an entry is nonnumeric, negative, or causes combined spending to exceed remaining cap space, display the specific validation error.

- After submission, permanently deduct both investments from the team’s available cap space for that season.

- Investments are irreversible and cannot be edited or recovered after submission.

- Apply their effects throughout the entire upcoming season and expire them before the following season’s Training Camp.

- Training Camp never generates, resolves, or displays random events.

## Initial Event Investment Formula

- For an investment I measured in millions of dollars, calculate the odds multiplier M as 1 plus 0.10 multiplied by the square root of I.

- Multiply baseline positive-event odds by M calculated from the positive-event investment.

- Divide baseline negative-event odds by M calculated from the negative-event investment.

- Use odds rather than directly adding probability points so investment cannot guarantee a positive event or eliminate a negative event.

**Optimization bookmark.** Define the baseline probabilities and event system later, and reassess the investment coefficient and odds conversion with Claude Code after implementation and testing.

## Training Camp Submission

- Keep Advance to End of Training Camp locked until one offensive focus and one defensive focus are selected and both investment fields are valid.

- Submitting Training Camp is irreversible.

- Process all development, regression, cap deductions, and saving entirely offscreen while the GM sees only a loading screen.

- Do not open Training Camp Results until every player update and investment deduction has been successfully saved.

## Failure Handling

- If Training Camp processing or saving fails, remain on the loading screen and retry automatically.

- If repeated attempts fail, display a Training Camp failed Retry control.

## Training Camp Results

- After successful processing, automatically open an independent Training Camp Results screen.

- Display the two saved event-investment amounts for confirmation, but never display or resolve random events.

- Display a compact roster organized by position group.

- For every player, show position, name, previous overall rating, development or regression amount, and new overall rating.

- Display positive development in the interface’s positive color with a plus sign.

- Display regression in the interface’s negative color with a minus sign.

- Display an unchanged result as a neutral-colored 0.

## Exit to Re-order Depth Chart

- Provide each GM with an individual Advance to Re-order Depth Chart control on Training Camp Results.

- Advancing is irreversible. The GM cannot return to Training Camp or Training Camp Results.

- Preserve the existing Re-order Depth Chart interface without modification and make the section fully independent for each GM.

- Finalizing the depth chart is irreversible and immediately sends that GM to the standard multiplayer checkpoint.

## Preseason Checkpoint

- Display Previous stage Re-order Depth Chart and Next stage Preseason.

- After every human GM commits, save and apply all finalized depth charts, generate and save the complete preseason as defined in Change 6, and release connected GMs only after generation succeeds.

## CPU Team Behavior

- CPU teams automatically select exactly one offensive focus, one defensive focus, a positive-event investment, and a negative-event investment.

- Every CPU choice seeks to maximize that team’s probability of winning the Super Bowl during the upcoming season.

- Use deterministic saved logic for all CPU Training Camp decisions.

**Optimization bookmark.** Define and calibrate CPU focus and investment priorities with Claude Code after implementation and testing.

# Change 6 Independent Preseason Hub and Results Reveal

Decision. Precompute one canonical three-week preseason at the entry checkpoint, then let each GM independently reveal those saved results through a simplified single-player Team Hub.

## Preseason Entry and Generation

- The checkpoint after Re-order Depth Chart displays Previous stage Re-order Depth Chart and Next stage Preseason.

- After every human GM commits, generate the entire three-week preseason once for the league.

- Run generation entirely offscreen while users remain on the checkpoint loading screen.

- Save every score, team and player statistic, box score, record, and standing before releasing any GM into Preseason.

- **Amended.** Do not save GAMECAST play-by-play. Save each game's simulation
  seed instead and regenerate the play-by-play when a GM opens it. The engine
  is deterministic, so the regenerated sequence is byte-identical to the one
  that produced the saved score. See "Saved play-by-play" in the decisions
  section above for the size arithmetic behind this.

- Use the same canonical results for every GM, including both sides of every human-versus-human game.

- Never release users into a partially generated preseason.

## Preseason Generation Failure Handling

- If generation or saving fails, remain on the checkpoint loading screen and retry automatically.

- If repeated attempts fail, display a Preseason simulation failed Retry control.

## Independent Results Reveal

- Treat Simulate Game and Simulate Preseason as reveal controls because all preseason games have already been generated.

- Maintain a separate, permanently saved reveal state for each human GM.

- One GM revealing results does not update, advance, or spoil another GM’s screen.

- Restore each GM to the correct private reveal point after a disconnect.

- Revealed results cannot be hidden, rerolled, or changed.

- Display schedules, standings, records, player statistics, and league statistics using only the results that the viewing GM has revealed.

## Preserved Team Hub Interface

- Make the Preseason Team Hub a fully single-player screen.

- Preserve the existing visual design, team header, upcoming matchup, win probability, Team OVR comparison, league rank, preseason record, and other top-level data.

- Preserve the Overview, Matchup, Division Standings, League Standings, GM Standings, and Injuries tabs.

## Around the League Roasts

- Replace generic Around the League commentary with exactly one concise roast for every human-controlled team.

- Label each card with the GM’s name and franchise and show the same complete set to every human GM.

- Favor humorous and sarcastic trash talk over neutral analysis while grounding each joke in actual game data.

- Allow obvious sports hyperbole, historical comparisons, and sparse light profanity for comedic shock.

- Do not use personally sensitive insults or sustained profanity.

**Amended.** Every roast in Changes 6, 7 and 10 is selected from a fixed
authored library of roughly 1,000 lines, chosen deterministically from real
game data. No language model is involved, so generation cannot fail, cannot
add latency to a checkpoint, and cannot differ between GMs.

## Season 1 Roast Source

- Generate each Season 1 roast once from that GM’s completed Player Fantasy Draft.

- Consider positional investment, roster balance, stars, weaknesses, reaches, and projected strength.

- Generate the roast offscreen after the draft and save it permanently for display throughout the first preseason.

## Later Season Roast Source

- For Season 2 and later, generate one new roast from the immediately preceding regular season and postseason.

- Consider record, league rank, statistical strengths and weaknesses, playoff result, and notable overperformance or collapse.

- Save the roast for the entire upcoming preseason.

- If any roast generation fails, substitute a saved deterministic data-based roast and never block progression.

## Unit Rankings

- Preserve the existing Offense, Defense, and Special Teams ranking cards.

- Add a fourth Coaching card displaying the weighted Staff OVR and league rank defined in Change 3.

## Team Hub Navigation

- Remove the Roster and Cap, Coaching Staff, and Free Agency buttons.

- Add Full Schedule, Player Statistics, League Statistics, Latest Box Score, and Watch Simulation Play-by-Play.

- Connect Full Schedule, Player Statistics, and League Statistics to their existing screens.

- Keep Latest Box Score and Watch Simulation Play-by-Play locked until the viewing GM reveals that GM’s first preseason game.

- After unlocking, both controls always open the most recently revealed game involving that GM’s team.

- Use the existing Box Score interface and the preprogrammed GAMECAST engine as fully single-player views.

## Preseason Hub Controls

- Remove the entire Game Day Readiness panel, including GM names, readiness states, readiness counts, and the Ready for Game Day control.

- Replace it with two single-player controls: Simulate Game and Simulate Preseason.

- Both controls irreversibly reveal saved results and never initiate a new simulation.

## Simulate Game

- Reveal the complete next preseason week to that GM.

- Open the existing Game Day Results screen and display that GM’s matchup plus the complete Around the League scoreboard for the revealed week.

- Remove every bottom control except Continue.

- Continue returns the GM to the Team Hub for the next preseason week or to the completed-preseason Team Hub after Week 3.

## Simulate Preseason

- Reveal every remaining preseason week to that GM.

- Open one cumulative Game Day Results screen with tabs for Preseason Weeks 1, 2, and 3, including weeks that the GM previously revealed.

- Each weekly tab displays that GM’s matchup plus the complete Around the League scoreboard for that week.

- Open the cumulative screen on Preseason Week 3 by default.

- Within every selected preseason-week tab, display View Full Box Score and View Play-by-Play for the game involving the viewing GM's team.

- View Full Box Score opens that selected week's existing full Box Score interface, and View Play-by-Play opens that selected week's predesigned GAMECAST feature.

- Keep Continue as the cumulative screen's only progression control at the bottom of the page.

- On both detail screens, remove every navigation and progression control except Return to Game Results.

- Return to Game Results restores the cumulative results screen on the same selected week, scroll position, and expanded-content state from which the GM left.

- Do not add these detail controls to an individual one-week Game Day Results screen; it retains only Continue.

- Provide only one bottom control, Continue, which returns the GM to the completed-preseason Team Hub.

## Completed Preseason Team Hub

- After that GM reveals all three weeks, remove Simulate Game and Simulate Preseason.

- Display one individual, irreversible Advance to Regular Season control.

- Selecting it moves only that GM to the standard multiplayer checkpoint.

## Regular Season Checkpoint

- Display Previous stage Preseason and Next stage Regular Season.

- Keep all preseason data intact while any human GM is still completing or reviewing Preseason.

- Perform the preseason wipe only after every human GM commits.

## Preseason Wipe

- Permanently delete every preseason record, standing, player statistic, league statistic, score, box score, and GAMECAST play-by-play sequence.

- Reset every team and player seasonal record and statistic to zero for the Regular Season.

- After the wipe succeeds, automatically release connected GMs into the Regular Season.

- Relock Latest Box Score and Watch Simulation Play-by-Play for each GM until that GM reveals the first regular-season game.

# Change 7 Independent Regular Season Hub Weeks 1 Through 9

Decision. Precompute one canonical league schedule through Week 9 at the Regular Season entry checkpoint, then let each GM independently reveal those saved results one week at a time or as a complete block before the Trade Deadline.

## Regular Season Entry and Generation

- Apply every relevant Team Hub, results-reveal, navigation, GAMECAST, box-score, saved-state, and failure-handling rule from Change 6.

- At the pre-Regular Season multiplayer checkpoint, generate the complete league schedule for Weeks 1 through 9. Do not generate Week 10.

- Run generation entirely offscreen while users remain on the synchronizing and loading screen.

- Save every score, injury, recovery progression, team and player statistic, standing, and box score before releasing any GM. **Amended:** play-by-play is regenerated on reveal from the saved seed, not stored.

- Use the same canonical results for every GM, including both sides of every human-versus-human game.

- Never release users into a partially generated regular-season block.

## Generation Failure Handling

- If generation or saving fails, remain on the checkpoint loading screen and retry automatically.

- If repeated attempts fail, display a Regular Season simulation failed Retry control.

## Independent Results Reveal

- Treat Simulate Week and Simulate to Week 10 as reveal controls because Weeks 1 through 9 have already been generated.

- Maintain a separate, permanently saved reveal state for each human GM.

- One GM revealing results does not update, advance, or spoil another GM's screen.

- Restore each GM to the correct private reveal point after a disconnect.

- Revealed results cannot be hidden, rerolled, or changed.

- Display schedules, standings, records, injuries, player statistics, and league statistics using only the results that the viewing GM has revealed.

## Locked Weeks 1 Through 9

- Prohibit roster, depth-chart, and coaching changes throughout Weeks 1 through 9 so no later action can conflict with the precomputed results.

- As established in Change 6, do not display Roster and Cap, Coaching Staff, Free Agency, or other roster-management controls on the Team Hub.

- If an injury removes a starter, automatically promote the next eligible player using the finalized depth chart for each subsequent precomputed game.

## Emergency Simulation Placeholders

- If a team has no eligible player remaining at a required position, create the minimum number of temporary 0 OVR placeholders needed to complete that game simulation.

- Use position-specific labels such as Replacement QB 1 and Replacement QB 2 when multiple placeholders are required.

- Allow GAMECAST and the box score to display the placeholder label when necessary for an intelligible game record.

- Keep placeholders confined to the affected simulation. They never enter the roster, depth chart, salary cap, transaction history, or free-agent pool.

- Do not give placeholders persistent statistics, development, injuries, awards, records, or any existence beyond the affected simulation.

## Preserved Regular Season Team Hub

- Make the Regular Season Team Hub a fully single-player screen and preserve the visual design and relevant interface rules established in Change 6.

- Preserve the team header, upcoming matchup, win probability, Team OVR comparison, league rank, record, top-level data, established tabs, four unit-ranking cards, and five navigation controls from Change 6.

- Keep Latest Box Score and Watch Simulation Play-by-Play locked until the viewing GM reveals that GM's first regular-season game.

- After unlocking, both controls open the most recently revealed game involving that GM's team.

## Weekly Around the League Roasts

- Display exactly one concise, saved roast for every human-controlled team on each weekly Team Hub and show the same complete set to every GM.

- Generate the Week 1 comments from each human team's preseason performance.

- Generate the Week 2 through Week 9 comments from each human team's immediately preceding week, emphasizing injuries and notable statistical performances when relevant.

- When a team had a bye in the immediately preceding week, roast or comment on the bye itself rather than reaching back to an earlier game.

- Apply the humorous, sarcastic, data-grounded, historical-comparison, sparse-light-profanity, and safety rules established in Change 6.

- Generate and save every Week 1 through Week 9 roast during the pre-Regular Season synchronizing and loading screen so every GM sees identical commentary.

- If any roast generation fails, substitute a saved deterministic data-based roast and never block progression.

## Regular Season Hub Controls

- Remove the entire Game Day Readiness panel and replace it with Simulate Week and Simulate to Week 10.

- Both controls irreversibly reveal saved results and never initiate a new simulation.

## Simulate Week

- Reveal the complete next league week to that GM, including every game played across the league.

- Open the existing Game Day Results screen and display that GM's matchup plus the complete Around the League scoreboard for the revealed week.

- During that GM's bye, identify the team as on bye while still revealing and displaying the full league week.

- Remove every bottom control except Continue.

- Continue returns the GM to the following week's Team Hub or to the completed-block Team Hub after Week 9.

## Simulate to Week 10

- Reveal every remaining saved result through Week 9 to that GM.

- Open one cumulative Game Day Results screen with separate tabs for every newly revealed week, while also retaining any weeks that GM revealed previously.

- Each weekly tab displays that GM's matchup or bye plus the complete Around the League scoreboard for that week.

- Open the cumulative screen on Week 9 by default.

- Within every selected regular-season week tab, display View Full Box Score and View Play-by-Play for the game involving the viewing GM's team.

- View Full Box Score opens that selected week's existing full Box Score interface, and View Play-by-Play opens that selected week's predesigned GAMECAST feature.

- Hide or disable both detail controls on a bye-week tab because the viewing GM's team did not play.

- Keep Continue as the cumulative screen's only progression control at the bottom of the page.

- On both detail screens, remove every navigation and progression control except Return to Game Results.

- Return to Game Results restores the cumulative results screen on the same selected week, scroll position, and expanded-content state from which the GM left.

- Do not add these detail controls to an individual one-week Game Day Results screen; it retains only Continue.

- Provide only one bottom control, Continue, which returns the GM to the completed-block Team Hub displaying the upcoming Week 10 matchup.

## Trade Deadline Transition

- After that GM reveals Week 9, remove Simulate Week and Simulate to Week 10.

- Display the upcoming Week 10 matchup and one individual, irreversible Advance to Trade Deadline control.

- Selecting it moves only that GM to the standard multiplayer checkpoint.

- Display Previous stage Regular Season Weeks 1 Through 9, Next stage Trade Deadline, and Waiting for other players.

- Do not display a readiness list or additional checkpoint controls.

- After every human GM commits, release all players into the Trade Deadline stage without simulating Week 10.

# Change 8 Turn Based Trade Deadline

Decision. Replace the live Trade Deadline with a saved three-round turn-based event that reuses the fantasy-draft architecture and existing trade-proposal interface.

## Event Structure and Order

- Run exactly three complete rounds.

- Give every NFL team exactly one proposing turn per round, producing a maximum of 96 proposing turns.

- Calculate the order once from the league rankings saved after Week 9: the worst-ranked team acts first and the best-ranked team acts 32nd.

- Preserve that order throughout all three rounds regardless of later trades, roster-strength changes, or ranking changes.

- On its turn, require each team to submit one trade proposal or irreversibly select Skip Turn.

- A denied proposal ends the proposing team's turn immediately. The team cannot submit another initial offer during that turn.

- Complete all three rounds even if every team skips during an earlier round.

## Serialized Trade Processing

- Allow only one unresolved negotiation at a time.

- Do not begin the next proposing turn until the active negotiation has been accepted or denied.

- Responding to an incoming offer does not consume the recipient team's own proposing turn.

- Apply every accepted trade immediately and save both updated rosters before advancing to the next proposing turn.

- Load every new proposal from the current saved rosters so an asset traded earlier no longer appears as selectable.

- Preserve the existing trade-proposal interface and every asset type it currently supports without adding new tradeable asset types.

## Negotiation Paths

- For a CPU-to-CPU proposal, resolve the negotiation immediately without pausing for human input.

- For a CPU-to-human proposal, allow the human recipient to accept, deny, or modify. A modification returns to the CPU proposer for one final accept-or-deny decision.

- For a human-to-CPU proposal, allow the CPU recipient to accept, deny, or modify. A modification returns to the human proposer for one final accept-or-deny decision.

- For a human-to-human proposal, the proposer constructs and submits the offer. The recipient may accept, deny, or modify. A modification returns to the original proposer for one final accept-or-deny decision.

- Permit no more than one modification or counteroffer in any negotiation.

- After a modification, permit only a final acceptance or denial; do not allow another counteroffer.

## Human Turn Persistence

- Do not impose a timer on any human proposal or response. The entire Trade Deadline waits until the required human action is submitted.

- Save every incomplete human proposal and counteroffer as a draft and restore it after disconnection.

- Treat every submitted proposal, modification, acceptance, denial, and Skip Turn selection as irreversible.

## Temporary Trade Deadline Exceptions

- Allow every human and CPU team to exceed the salary cap, maximum roster size, and minimum positional requirements during the Trade Deadline.

- Do not block a valid trade because it creates one or more of these violations.

- Preserve all violations for the later reconciliation stage.

## CPU Strategy

- Make every CPU proposal, response, and modification seek to maximize that franchise's overall probability of winning a Super Bowl across the current and future seasons.

- Make contending teams more willing to exchange future assets for immediate upgrades that address current weaknesses.

- Make poor teams more willing to exchange current stars for draft capital or other future value.

- Use deterministic, saved CPU trade decisions.

Optimization bookmark. Define and calibrate CPU trade valuation, contention assessment, future-value discounting, positional need, and current-versus-future championship weighting with Claude Code after implementation and testing.

## Independent Trade Summary

- After the final proposing turn in Round 3 resolves, automatically move every GM into an independent Trade Summary.

- Provide four tabs: Your Trades, League Trades, Rejected Offers, and Updated Roster.

- Your Trades displays every completed trade involving the viewing GM.

- League Trades displays every accepted trade across the league.

- Rejected Offers displays only unsuccessful negotiations involving the viewing GM.

- Updated Roster displays a compact roster, current salary-cap position, roster count, and positional compliance.

- Highlight salary-cap, roster-size, and positional violations in red.

- Keep these violations informational during Trade Summary and allow unrestricted navigation among all tabs.

- Display Advance to Mid-Season Free Agency regardless of the currently selected tab.

## Mid Season Free Agency Checkpoint

- Make Advance to Mid-Season Free Agency irreversible.

- Selecting it sends only that GM to the standard multiplayer checkpoint.

- Display Previous stage Trade Deadline, Next stage Mid-Season Free Agency, and Waiting for other players.

- Apply every other system-wide checkpoint rule established in Change 2.

# Change 9 Midseason Free Agency and Roster Finalization

Decision. Repeat the approved five-round turn-based free-agency and independent roster-finalization architecture at midseason, then synchronize the league and precompute the remaining regular season before releasing every GM to Week 10.

## Midseason Free Agency Structure

- After the Trade Summary checkpoint releases, move every GM into a multiplayer turn-based Midseason Free Agency period.

- Run exactly five complete rounds with no simulation or autopicking.

- Calculate the fixed order from roster ranking at the beginning of midseason free agency: the best roster offers first and the worst roster offers last.

- Preserve the same order for all five rounds.

- Use the exact fantasy-draft-board presentation and all other offer-processing rules approved for preseason free agency in Change 4.

## Player Pool and Contract Decisions

- Include every player left unsigned after preseason free agency and every player subsequently released into the remembered league-wide free-agent pool.

- Preserve each player's fixed primary preference while recalculating contextual fit from the current starting opportunity, coaching quality, championship contention, location, and team circumstances.

- Require each offer to specify an average annual salary and contract length.

- Make every submitted offer irreversible and nonwithdrawable. A team may submit a separate new offer with any salary and term but may not change an earlier offer.

- Resolve signings only at the end of each round and only when the best offer meets or exceeds the player's expected contract.

- Determine the winning offer from the best combination of salary and player fit. If the final scores tie, award the player to the team that submitted the tied offer first.

- Keep unresolved offers active in later rounds and move signed players from the Unsigned tab to the Signed tab.

- Make every CPU bid deterministic and focused on maximizing that franchise's probability of winning a Super Bowl across the current and future seasons.

## Temporary Free Agency Exceptions

- Allow every human and CPU team to exceed the salary cap, maximum roster size, and minimum positional requirements throughout bidding.

- Do not block a valid signing because it creates or preserves one of these violations.

- Carry forward every unresolved violation from both the Trade Deadline and midseason free agency into roster and budget reconciliation.

## Independent Summary and Reconciliation

- After Round 5, automatically move each GM into an independent Midseason Free Agency Summary and Roster and Budget Reconciliation section.

- Use the same summary, roster-needs display, cap information, management controls, and reconciliation rules approved in Change 4.

- Do not allow newly signed midseason free agents to be cut, released, or restructured.

- Allow eligible existing players to be managed under the previously approved release, restructuring, cap-penalty, and player-acceptance rules.

- Make the reconciliation tab glow red while any requirement remains unmet and identify every specific salary-cap, roster-size, or positional violation.

- Require the team to fall within the salary cap and roster maximum and satisfy every positional minimum before advancement.

- If a team cannot satisfy a positional minimum, supply randomly generated 0 OVR placeholders that do not exist outside the engine and serve only to prevent simulation failure.

- Make advancement into Re-order Depth Chart irreversible.

## Independent Depth Chart Ordering

- Move every reconciled GM into the existing Re-order Depth Chart interface.

- Keep this interface unchanged and fully independent from every other GM's progress.

- Make advancement from Re-order Depth Chart into synchronization irreversible.

## Week 10 Synchronization and Precomputation

- Send each finished GM to the standard multiplayer synchronization and loading screen.

- Display Previous stage Midseason Roster Finalization, Next stage Week 10, and Waiting for other players.

- After every GM arrives, apply all finalized rosters and reordered depth charts before running the simulation.

- Simulate every remaining regular-season game from Week 10 through Week 18 completely offscreen.

- Generate and save the shared canonical scores, outcomes, player and league statistics, injuries and recovery timelines, box scores, GAMECAST play-by-play, and weekly humorous or sarcastic comments.

- Keep every result hidden until its proper chronological reveal. A future injury must neither appear nor influence any earlier displayed week.

- Release every GM to the Week 10 Team Hub only after all simulation and content generation is complete.

## System Wide Reveal Rule

- In every synchronization screen immediately preceding preseason or regular-season play, simulate the applicable game block and generate its saved comments before releasing any GM into that stage.

- Treat every later Simulate Week or Simulate Multiple Weeks control as a reveal command only.

- Never rerun the game engine when a GM selects a reveal control.

- Reveal saved results independently to the viewing GM without advancing or changing another GM's screen.

# Change 10 Independent Regular Season Weeks 10 Through 18

Decision. Preserve the independent regular-season reveal architecture through Week 18, then synchronize all GMs before constructing the Playoffs bracket from the completed canonical standings.

## Preserved Regular Season Architecture

- Apply every relevant single-player Team Hub, navigation, statistics, injury, box-score, GAMECAST, emergency-placeholder, saved-state, and failure-handling rule from Changes 6 and 7.

- Use the canonical Week 10 through Week 18 results already simulated and saved during the synchronization process defined in Change 9.

- Never rerun the simulation engine from a control in this stage.

- Preserve each GM's independent, permanently saved reveal state after disconnection.

## Team Hub Controls

- Provide two independent controls: Simulate Game and Simulate Season.

- Treat both labels as reveal controls even though the interface continues to use the word Simulate.

- Make every reveal irreversible. Revealed results cannot be hidden, rerolled, or changed.

## Simulate Game

- Irreversibly reveal the next complete league week to the viewing GM.

- Open the existing individual Game Day Results screen and show that GM's matchup plus the complete Around the League scoreboard.

- During that GM's bye, identify the team as on bye while still revealing and displaying the complete league week.

- Remove every bottom control except Continue.

- Continue returns the GM to the following week's Team Hub or to the completed regular-season Team Hub after Week 18.

## Simulate Season

- Irreversibly reveal every remaining saved result through Week 18 to the viewing GM.

- Open one cumulative Game Day Results screen containing freely selectable tabs for Weeks 10 through 18, including weeks that GM previously revealed individually.

- Default the cumulative screen to Week 10 so the GM may review the completed block chronologically.

- Make every Week 10 through Week 18 tab revealed, unlocked, and immediately selectable. Do not add a Next Week control.

- Each weekly tab displays that GM's matchup or bye plus the complete Around the League scoreboard for that week.

- For each non-bye tab, display View Full Box Score and View Play-by-Play for the game involving the viewing GM's team.

- Open the selected week's existing full Box Score interface or saved GAMECAST play-by-play from the corresponding control.

- Hide or disable both detail controls on the viewing GM's bye-week tab.

- On both detail screens, remove every navigation and progression control except Return to Game Results.

- Return to Game Results restores the cumulative screen on the same selected week, scroll position, and expanded-content state from which the GM left.

- Make Continue available after the GM reaches the Week 18 tab. Continue returns to the completed regular-season Team Hub.

## Weekly Around the League Commentary

- Generate Week 10 commentary from Week 9 performance and Weeks 11 through 18 commentary from the immediately preceding week.

- When a team remains mathematically capable of qualifying for the Playoffs, discuss its playoff position, remaining schedule, division or Wild Card race, clinching scenarios, relevant injuries, notable performances, and likely path forward.

- Allow playoff-race commentary to remain humorous, sarcastic, or skeptical, but prioritize the competitive situation rather than a pure roast.

- Once a team is mathematically eliminated, return its commentary fully to the roast format established in Change 6.

- Use the canonical saved comments generated during Change 9 synchronization so every GM sees identical commentary when the corresponding week is revealed.

## Exit to Playoffs

- After Week 18 is revealed, remove Simulate Game and Simulate Season from that GM's completed regular-season Team Hub.

- Display one individual irreversible Advance to Playoffs control.

- Selecting it moves only that GM to the standard multiplayer checkpoint.

- Display Previous stage Regular Season, Next stage Playoffs, and Waiting for other players.

- Apply every other system-wide checkpoint rule established in Change 2.

## Playoffs Qualification and Seeding

- After every GM reaches the checkpoint, finalize the shared regular-season standings and Playoffs bracket without simulating a Playoffs game.

- Qualify and seed each conference independently under the real-world NFL structure.

- Qualify seven teams from each conference.

- Reserve seeds 1 through 4 for the four division champions and order those champions using the applicable NFL tiebreaking procedures.

- Award seeds 5 through 7 to the three best remaining teams using the applicable NFL Wild Card and conference tiebreaking procedures.

- Give seed 1 the conference's only first-round bye.

- If a tie survives every applicable statistical tiebreaker, resolve it with one saved deterministic virtual coin toss so every GM receives the same bracket.

- Advance every human GM into the Playoffs section after synchronization, including GMs whose teams did not qualify.

# Change 11 Independent Playoffs and End of Season

Decision. Preserve the existing Playoffs presentation and NFL bracket logic while making the entire postseason an independent, one-round-at-a-time reveal sequence. After the Super Bowl and the existing end-of-season screens, synchronize all GMs before entering the offseason.

## Preserved Playoffs Hub and League Rules

- Preserve the existing Playoffs Hub design, bracket layout, AFC, NFC, and Super Bowl tabs, team status, seed, next-game information, and championship display.

- Preserve the real-world NFL playoff structure, matchup rules, reseeding, and advancement logic without modification.

- Remove Team Hub and Roster and Cap from the Playoffs Hub navigation.

- Keep Player Statistics and add League Statistics as the only Playoffs Hub navigation controls.

## Canonical Postseason Simulation

- During the synchronization checkpoint that releases GMs into the Playoffs, simulate the entire postseason sequentially and offscreen: Wild Card, Divisional, Conference Championships, and Super Bowl.

- Determine each later-round matchup from the saved outcome of the preceding round.

- Before releasing any GM from the checkpoint, save every score, statistic, injury, recovery update, box score, and GAMECAST play-by-play for the entire postseason.

- Hide all future-round outcomes until the viewing GM reveals the corresponding round.

- Do not rerun the postseason simulation engine from any Playoffs control.

## Independent Round Reveal

- Make the entire Playoffs section single-player. No GM's progress, navigation, or reveal timing depends on another GM.

- Remove every playoff readiness panel, multiplayer status indicator, and round-specific readiness control.

- Replace those elements with one independent Simulate Playoff Round control.

- Treat Simulate Playoff Round as an irreversible reveal of the next saved round, despite the use of the word Simulate in the label.

- Permit only one round to be revealed at a time. Do not provide a reveal-all option or a cumulative Playoffs results screen.

- Save each GM's independent reveal state permanently so a disconnection restores that GM to the correct round without exposing future results.

## Playoff Game Results

- Replace the existing sparse playoff-results screen with the standard individual Game Day Results screen adopted for weekly regular-season reveals.

- Show the viewing GM's matchup when that team is active. When the team is eliminated, did not qualify, or has a bye, display that status clearly instead.

- Display the complete scoreboard for every game in the revealed round to every GM.

- On the Wild Card results screen, show both conference No. 1 seeds as Bye - Auto-Advance.

- Place View Full Box Score and View Play-by-Play controls beside every playoff game scoreboard, including CPU-only games and games that do not involve the viewing GM.

- Allow every GM to open the saved full Box Score and GAMECAST play-by-play for every playoff game.

- On each detail screen, remove every navigation and progression control except Return to Game Results.

- Return to Game Results restores the same revealed-round results screen and its prior state.

- Keep Continue as the only progression control at the bottom of the round's Game Day Results screen.

- Continue returns the GM to the independent Playoffs Hub for the next round.

## Bracket Visibility and Continued Participation

- Update the Playoffs bracket for each GM only as that GM reveals rounds. Never expose an unrevealed future result through the bracket or another screen.

- Require eliminated and nonqualifying human GMs to continue revealing every playoff round through the Super Bowl so they can follow the complete league postseason.

- Do not add a special Playoffs commentary system.

## End of Season Screens

- After the Super Bowl result is revealed and the GM continues, automatically open the existing End of 2026 Season splash screen.

- Preserve the splash screen without design or content changes, keep it fully single-player, and use its existing Continue control to open the follow-up screen.

- Preserve the existing End of 2026 Season follow-up screen, including This Season, Score Tracker, Final Bracket, Full League History, and the displayed season outcome and champion.

- Keep the follow-up screen fully single-player and otherwise unchanged.

- Remove the End of season readiness panel, all GM readiness statuses, and the existing shared advancement control.

- Replace them with one irreversible individual Advance to Offseason control.

## Exit to Offseason

- Selecting Advance to Offseason moves only that GM into the standard multiplayer checkpoint.

- Display Previous stage End of Season, Next stage Offseason, and Waiting for other players.

- Apply every other system-wide checkpoint rule established in Change 2.

- Define the Offseason section in the next approved change.

# Change 12 Independent Retirement Review and Draft Preview

**Decision.** Calculate and save all retirement and draft-preparation data at the Offseason checkpoint, then allow each GM to independently review retirements and prepare a private prospect list before rejoining the league for the existing turn-based Draft.

## Offseason Checkpoint

- Preserve the standard multiplayer checkpoint entered after the End of Season screen.

- Display Previous stage End of Season, Next stage Offseason, and Waiting for other players.

- Apply every other system-wide checkpoint rule established in Change 2.

## Offscreen Retirement and Draft Preparation

- After every human GM reaches the checkpoint, calculate all league-wide retirements using the existing retirement logic unchanged, including age, position, and significant injury history.

- Apply every retirement to the canonical league state, including updated rosters, available roster spaces, and salary-cap figures.

- Generate and save the upcoming draft class, draft order, Draft Preview information, scouting data, and all other existing draft-related data.

- Complete all retirement and draft preparation offscreen while GMs remain on the checkpoint loading screen.

- Use one canonical set of retirement outcomes, draft prospects, and draft data for every GM.

- Do not release any GM into the Offseason until every calculation and save operation succeeds.

- Keep the calculated retirement outcomes and generated draft data hidden from each GM until that GM independently reaches the relevant screen.

## Failure Handling

- If retirement or draft-preparation processing fails, keep every GM on the loading screen and retry automatically.

- After repeated failures, display a manual Retry control.

- Never release GMs into a partially processed Offseason.

## Independent Retirement Review

- After successful processing, automatically release connected GMs into their independent Retirement Review screens. Route a returning disconnected GM to the correct saved screen.

- Make Retirement Review fully single-player. One GM's navigation or progression cannot affect another GM.

- Preserve the existing Retirement Review design, metrics, retirement explanation, and Your Team and League-wide tabs.

- Display the same canonical league-wide retirement outcomes to every GM while defaulting to that GM's own-team view.

- Remove Preview Roster and Cap, Free Agency, Propose Trade, the Retirement Review readiness panel, all GM readiness indicators, and the existing shared advancement control.

- Replace those elements with one individual Advance to Draft Preview control that remains visible from either Retirement Review tab.

- Do not require the GM to inspect both retirement tabs before advancing.

- Make Advance to Draft Preview irreversible. Selecting it moves only that GM directly into an independent Draft Preview without a multiplayer checkpoint.

## Independent Draft Preview

- Preserve the existing Draft Preview screen, draft class, projected draft order, player information, scouting information, tabs, navigation, and visual design unchanged.

- Keep Draft Preview informational. It cannot modify rosters, contracts, draft order, prospect ratings, or any shared league state.

- Permit each GM to star or unstar prospects freely during Draft Preview.

- Keep each GM's starred-player list private from every other human GM and all CPU teams.

- Save starred-player selections after every change and restore them after disconnection.

- Carry each GM's starred prospects into the existing turn-based Draft board.

- Allow stars to remain editable during the Draft using the board's existing functionality.

- Do not allow stars to affect draft order, prospect availability, CPU decisions, or any other Draft mechanic.

## Exit to Draft

- Remove the Draft readiness panel, GM readiness information, and existing shared advancement control from Draft Preview.

- Replace them with one individual Advance to Draft control that remains visible from every Draft Preview tab.

- Require an irreversible-action confirmation before accepting Advance to Draft.

- After confirmation, move only that GM to the standard multiplayer checkpoint.

- Display Previous stage Draft Preview, Next stage Draft, and Waiting for other players.

- Apply every other system-wide checkpoint rule established in Change 2.

- Once every human GM commits, automatically release connected GMs into the existing turn-based Draft. Route returning disconnected GMs into the Draft according to the saved league stage.

- Preserve the existing turn-based Draft and its draft-order calculation completely unchanged.

# Change 13 Rookie Draft Completion and Annual Free Agency

**Decision.** Preserve a manual first round of the turn-based Rookie Draft, automate every remaining round offscreen, and then move each GM through independent draft review and rookie signings before the standard multiplayer Free Agency and independent roster-finalization circuit.

## Manual First Round

- Preserve the existing turn-based Rookie Draft interface, draft order, trade logic, player information, and all other established draft mechanics.

- Complete Rookie Draft Round 1 manually in the normal turn-based order.

- Require every human and CPU team to make its normal Round 1 selection.

- Begin automated completion only after the final Round 1 selection has been completed and saved.

## Automated Rounds 2 Through 7

- Automatically complete Rounds 2 through 7 using the existing CPU drafting algorithm.

- Run Rounds 2 through 7 entirely offscreen while users see only a loading indicator.

- Do not provide an autopick button, manual override, simulation threshold, or option to resume manual drafting after Round 1.

- Complete and save every remaining selection before releasing any GM from the loading screen.

- If automated completion or saving fails, remain on the loading screen and retry automatically. After repeated failures, display a manual Retry control.

## Temporary Rookie Draft Exceptions

- Permit every human and CPU team to exceed the salary cap, roster maximum, and positional limits throughout the entire Rookie Draft.

- Do not block or alter a draft selection because of any resulting roster or financial violation.

## Independent Rookie Draft Summary

- After Rounds 2 through 7 are completed and saved, automatically move each GM into an independent Rookie Draft Summary.

- Make Rookie Draft Summary fully single-player, with no dependency on another GM's navigation or progression.

- Mirror the Fantasy Draft Summary structure, including the existing large league-wide comparison table, detailed tabs for every human-controlled team, the NFL roster tab with its team dropdown, and the established summary-screen visual design.

- Display every team's complete rookie class, including round, overall pick number, position, player name, age, and overall rating.

- Remove every readiness panel, GM readiness indicator, and shared advancement control.

- Add one individual irreversible Advance to Rookie Signings control.

- Selecting it moves only that GM directly into the existing Rookie Signings screen without a multiplayer checkpoint.

## Independent Rookie Signings

- Make Rookie Signings fully single-player and preserve its existing design, information, and rookie-contract logic.

- Apply rookie contracts automatically using the existing signing rules. Rookies cannot reject or negotiate their assigned contracts.

- Continue allowing every human and CPU team to exceed the salary cap, roster maximum, and positional limits throughout Rookie Signings.

- Remove all lower navigation controls, the shared readiness panel, GM readiness indicators, and the existing shared advancement button from Rookie Signings.

- Replace them with one individual irreversible Continue to Free Agency control.

- Do not require roster or cap compliance before allowing a GM to continue.

## Free Agency Checkpoint

- Selecting Continue to Free Agency moves only that GM to the standard multiplayer checkpoint.

- Display Previous stage Rookie Signings, Next stage Free Agency, and Waiting for other players.

- Apply every other checkpoint rule established in Change 2.

- Once every human GM commits, release all connected GMs into the multiplayer turn-based Free Agency period.

## Annual Free Agency

- Reuse the complete five-round Free Agency architecture established in Change 4.

- Preserve no turn timers, no simulation or autopicking, one offer or pass per team per round, irreversible submitted offers, salary-and-fit evaluation, end-of-round signings, Signed, Unsigned, and Roster Needs tabs, existing player preferences and contract rules, CPU strategy and adaptation, and saved-state and failure-handling rules.

- Build the Free Agency pool from the persistent league-wide pool, including previously unsigned players and eligible released players.

- Exclude drafted and signed rookies from the Free Agency pool.

- Recalculate Free Agency order from post-draft roster strength. The best-ranked roster acts first and the worst-ranked roster acts last.

- Preserve that order for all five rounds.

- Permit every human and CPU team to exceed the salary cap, roster maximum, and positional limits throughout Free Agency.

- Never block a valid bid or signing because it creates or preserves one of those violations.

## Independent Summary and Reconciliation

- After Round 5, automatically move each GM into the independent Free Agency Summary and Roster and Budget Reconciliation flow established in Change 4.

- Reuse the existing summary tabs, roster-needs display, cap information, management controls, release and restructuring rules, penalties, CPU reconciliation behavior, and emergency-player rules.

- Make the reconciliation tab glow red and identify every specific salary-cap, roster-size, or positional violation while any requirement remains unmet.

- Lock advancement until the team is under the salary cap, at or below the roster maximum, and satisfies every minimum positional requirement simultaneously.

- After compliance, unlock the individual irreversible Advance to Training Camp control.

- Selecting it moves that GM directly into the single-player Training Camp without a multiplayer checkpoint.

## Repeated Annual Circuit

- From Training Camp onward, repeat the approved prior-season circuit from Changes 5 through 12 unchanged unless a later approved change expressly overrides it.
