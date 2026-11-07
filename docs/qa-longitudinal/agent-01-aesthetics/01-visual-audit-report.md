# 01 · Visual Audit Report

Commit `3abcfff`, BAL, Chromium. See README for scope and limits.

## Verdict
The redesign has landed: the roster/cap screen, schedule, stats, game history, box score, coaching draft and bracket read as one editorial, sports-broadcast language — big condensed display type, hard 2px borders, a stadium-photo masthead in team colours, light paper body, orange primary action. At 390px it holds up unusually well: no horizontal overflow on 23 routes at four widths, readable hierarchy, sensible stacking, strong keyboard focus, reduced motion respected.

What stops it feeling finished is a small set of **leftovers and flat moments**, not a lack of style:
1. **Unconverted dark panels** (TAFI-001, 002): the draft/FA/deadline stat strips and the Fantasy Draft Summary page are near-illegible or off-system.
2. **Peak moments are the weakest screens**: draft grade (dark, unstyled), season complete (champion as a subtitle), on-the-clock overlay (clipped), bracket (a mostly-empty card).
3. **Repetition**: the same stadium photo heads every screen and takes a third of the first viewport, including pages with nothing to say.
4. **Length**: hub 4,190px, mid-season FA 10,460px; important information is below several screens of scrolling.
5. **Chrome**: two floating buttons cover content; the rail's footer is cut off at 900px; shell buttons are 40px.

## Typography & layout
- Strengths: Big Shoulders display for titles and numerals is distinctive and legible at scale; Hanken for body is clean. Stat tiles ("6.3 YARDS TO THE CAP LINE", "37%") are the best-looking element in the product.
- Gaps: many dense tables use sub-11px text (TAFI-013); uppercase condensed tab labels are inconsistent in size between screens (Bracket tabs vs Roster tabs); the masthead title wraps to two lines for team names on every team-named page, which spends 180px on a name the player already knows (TAFI-006).

## Consistency
Light page + hard borders + orange CTA is applied almost everywhere. Exceptions: Fantasy Draft Summary (dark), stat strips (dark), Season Complete (teal masthead, dark card), purple CTAs on Retirement/Rookie Signings, and the dashed "empty" box with no illustration on four screens.

## Responsive & accessibility
- 0 px horizontal overflow at 1024/768/390/320 on all 23 sampled routes.
- Targets: shell controls 40px; draft board ~105 undersized controls on a phone.
- Focus: visible, high-contrast, tab order starts at "Skip to content" then the rail in visual order.
- Reduced motion: no running animations.
- Fonts blocked: no breakage, but identity lost (TAFI-016).

## Team identity
Baltimore's photo is high quality; masthead tinting in team purple works. 15 teams use only the drawn skyline (see 04). Photo credit is present and linked but long.

## Emotional impact
The product *tells* rather than *celebrates*: the draft grade, the Super Bowl champion, a signing, a trade, a playoff clinch are all text rows. Proposals in 06.
