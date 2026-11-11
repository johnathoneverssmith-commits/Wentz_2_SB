# 04 · 32-team stadium image inventory

Source of truth: `ui-source/public/art/stadiums/*.webp` and `STADIUM_PHOTO_CREDITS` in `ui-source/src/design/teamArt.ts` at `3abcfff`. Teams without a file fall back to the drawn `StadiumScene` skyline (`TEAM_SKYLINE`).

**Wave 2 update — verified by rendering:** all 32 franchise mastheads were rendered with the real component (viewer team swapped in a real save; `evidence/wave2/masthead_32_teams_A/B.webp`). **Confirmed working in-app (photo loaded, 1600px wide, credit line printed): ARI, ATL, BAL, BUF, CAR, CHI, CLE, DAL, DEN, HOU, JAX, LV, NO, PIT, SEA, TB, TEN (17).** **Confirmed skyline fallback (no photo file): CIN, DET, GB, IND, KC, LAC, LAR, MIA, MIN, NE, NYG, NYJ, PHI, SF, WAS (15).** No broken image. Visual notes: ARI's very wide crop works; the NO photo is washed out by the tan tint; eight skylines share one composition and LAC/LAR are near-identical (A1-036). Licences were still not checked online. The text below is the wave-1 inventory (source inspection plus BAL rendered); where it says 'unverified', the paragraph above supersedes it for loading and crop.

**What I looked at in wave 1:** BAL's photo, rendered on ~30 screens, and the drawn skyline on the setup screen. For the other 16 photos I verified the file exists, its pixel size and its credit entry in code; I did **not** render them in the app, so crop quality and visual consistency for those are *unverified*. I did not check licence pages online; every file needs its Commons page re-checked before more are added.

## A. Teams with a stadium photo (17)
| Team | File | Size | Credit in code | Notes |
|---|---|---|---|---|
| ARI | ARI.webp | 1600×593 | G. Skidmore, CC BY-SA 3.0 | **2.7:1, far wider than the rest** — likely a heavy crop; check at 390px portrait (focus 50% 70%) |
| ATL | ATL.webp | 1600×1200 | BullDawg2021, CC BY 4.0 | |
| BAL | BAL.webp | 1600×1200 | Q. Soloviev, CC BY 4.0 | **Viewed.** Aerial; reads well, purple tint works; 362 KB |
| BUF | BUF.webp | 1600×1152 | Q. Soloviev, CC BY-SA 4.0 | |
| CAR | CAR.webp | 1600×1200 | Q. Soloviev, CC BY 4.0 | 365 KB |
| CHI | CHI.webp | 1600×1200 | Moses8910, CC BY-SA 4.0 | 352 KB |
| CLE | CLE.webp | 1600×1067 | M. Barera, CC BY-SA 4.0 | |
| DAL | DAL.webp | 1600×1067 | M. Barera, CC BY-SA 4.0 | |
| DEN | DEN.webp | 1600×900 | MhcL947, CC BY 4.0 | |
| HOU | HOU.webp | 1600×1200 | US CBP, public domain | |
| JAX | JAX.webp | 1600×1080 | Q. Soloviev, CC BY 4.0 | 378 KB, largest |
| LV | LV.webp | 1600×1067 | US CBP, public domain | |
| NO | NO.webp | 1600×1200 | ajay_suresh, CC BY 4.0 | |
| PIT | PIT.webp | 1600×900 | Cbaile19, CC0 | |
| SEA | SEA.webp | 1600×1046 | SounderBruce, CC BY-SA 4.0 | |
| TB | TB.webp | 1600×1067 | US CBP, public domain | |
| TEN | TEN.webp | 1600×1067 | Antony-22, CC BY-SA 4.0 | |

Attribution: all 17 have a credit entry, rendered in the masthead as a linked line (long; wraps to two lines at 1440 and is overlaid on the photo — TAFI-006). No file lacks a credit. Two entries have 2026-dated titles; verify they are real Commons file names.

## B. Teams using the drawn skyline (15)
CIN, DET, GB, IND, KC, LAC, LAR, MIA, MIN, NE, NYG, NYJ, PHI, SF, WAS. (The setup screen's drawn skyline — generic city + floodlights — was viewed; the per-team variants for these 15 were not.)

## C. Broken / inconsistent
- No broken image found in code (a failed load falls back to the skyline by design).
- Possible inconsistency: aerial vs. street-level vs. dusk shots mix across teams (from file credits/names); ARI's aspect ratio. Needs a render pass.

## D. Prioritised photos still needed
Priority = brand recognition + how distinct the drawn fallback is not.
| # | Team | Venue | Suggested shot | Where to look |
|---|---|---|---|---|
| 1 | GB | Lambeau Field | Dusk exterior or aerial with the bowl | Wikimedia Commons "Lambeau Field" |
| 2 | KC | Arrowhead (GEHA Field) | Aerial/gameday, red | Commons "Arrowhead Stadium" |
| 3 | SF | Levi's Stadium | Aerial, Santa Clara hills | Commons "Levi's Stadium" |
| 4 | PHI | Lincoln Financial Field | Exterior, city skyline | Commons |
| 5 | NE | Gillette Stadium | Lighthouse/bridge exterior | Commons |
| 6 | MIA | Hard Rock Stadium | Canopy aerial | Commons |
| 7 | DET | Ford Field | Skyline exterior | Commons |
| 8 | MIN | U.S. Bank Stadium | Glass-roof exterior | Commons |
| 9 | IND | Lucas Oil Stadium | Downtown aerial | Commons |
| 10 | CIN | Paycor Stadium | Riverfront/skyline | Commons |
| 11 | NYG / 12 NYJ | MetLife Stadium (shared) | One neutral photo, two team tints and crops | Commons; CBP |
| 13 | LAR / 14 LAC | SoFi Stadium (shared) | One photo, two tints/crops | Commons; CBP |
| 15 | WAS | Commanders Field | Exterior | Commons |

Licensing: prefer **public domain** (U.S. Customs & Border Protection and other federal photos — already used for HOU, LV, TB), **CC0**, then **CC BY / CC BY-SA** from Wikimedia Commons (attribution already supported). Avoid unlicensed press/team/NFL photos. Each photo must be added to `STADIUM_PHOTO_CREDITS` with its file page. Shared venues (MetLife, SoFi) should reuse one file with different focus/tint so the two teams' mastheads are not identical.

Not replaced, nothing changed — proposals only.
