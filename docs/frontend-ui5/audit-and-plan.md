# UI-5 journey audit and implementation plan



Baseline: master 017f3030c87d9dadf85765732236e71795e44271. PR #66 merged during development; normally synchronized to master 2a68b04c4573915a22ebf6ca84eeaf4ea18c7424. Preserve its fictional-pool/scouting work. Setup reuses its qualitative ScoutingBrief without generating or inferring extra player information.



## Real journey and rule sources



`state/stageMachine.ts`, `reveal.ts`, `revealBlocks.ts`, screen actions and `ReadinessGate` are authoritative. Setup -> optional fantasy draft -> summary -> coaching draft -> summary -> training camp (fantasy rosters) OR five-round FA -> reconciliation summary -> camp -> personal results -> optional eligible event -> depth chart -> preseason -> optional developments -> regular season. At the league-shaped deadline: trading -> summary -> midseason FA -> reconciliation -> depth chart -> remaining regular season -> playoffs -> awards/season review -> hot seat -> retirements/draft preview -> rookie draft -> personal signings -> annual FA -> camp -> depth chart/rollover -> preseason. Older saves retain legacy signings/FA stages. Online games are precomputed blocks with per-GM reveals; raw saved scores, bracket champions and state.week cannot be used to announce progress.



## Findings



| Priority | Finding / evidence | Response |

|---|---|---|

| P1 | Setup without fantasy draft promises the season, but resolveTransition enters coachingDraft. | Correct immediate-next-stage copy and explain both starts. Coaching summary ALREADY has the correct config-dependent label; preserve it. |

| P1 | Reference navigation leaves a new player without an obvious return to the current personal step. Rail labels alone are insufficient on narrow screens. | One compact phase/next-step guide, canonical return link, collapsed decision explanation. No duplicate advance action. |

| P1 | Camp chains stepForward(...).then(nav) regardless of result and drops busy before the nested operation completes. A rejected follow-up can show an uncommitted next screen. | Await/check existing actions, retain error and retry results without rerunning submitted camp. Single-flight UI only. |

| P1 | How It Works has no setup/schedule/history/journey explanations; many topics open with long technical prose. | Concise route-specific Start here, retain detailed rules, add journey topic. |

| P1 | Help tablist lacks roving keyboard navigation and associated labelled panels. | Reuse shared accessible Tabs, focus trap and Escape; close stale help on navigation. |

| P2 | Setup settings' flex rows can squeeze long controls on phones; grouped labels do not directly name selects. | Scoped stacked phone rows, native labels/descriptions and touch targets. |

| P2 | Seed is supported by newLeague(seed,config) but cannot be chosen in setup. | Optional solo-only restart-setup seed disclosure; explicit reset confirmation; no reseeding running/detached/online leagues. |

| P2 | Disabled progression sometimes communicates its reason only inside its button. | Persist the existing disabled hint as described text; keep actual guards unchanged. |



No confirmed P0 gameplay defect in the source audit. Existing turn, checkpoint, disconnected-copy, saving-failure and reveal protections are substantial: preserve them rather than replace them. Do not promise online turn availability while reconnecting. Do not read hidden development values, other GM preferences or unrevealed results.



## Design and boundaries



Retain UI-1–4 fonts, sports colors, shell, panels and motion tokens. Guide: current phase/season at left, next step at right on desktop; compact stacked header and disclosure on phones. Help remains optional. No mandatory tutorial, persistent tutorial save flags, new game features, dependencies or workflows. New guidance belongs in presentation components, not simulation/state machinery. Seed control calls the existing creation action only while setup is local. PR #66 owns fictional generation/profile implementation; do not duplicate it or advertise unmerged functionality.



## Verification



Pure presentation tests cover every stage, fantasy/nonfantasy start, personal steps, disconnected/ready/wrong-turn states, non-NFL season shapes, and throwing hidden-result getters. Browser tests use real setup/draft/coaching/camp actions and deterministic genuine stage fixtures, with controlled HTTP only for online waiting/refusal/reconnection. Existing complete season/postseason/offseason browser oracles remain intact. Capture actual desktop/mobile setup, camp, guidance and help. Run all typechecks, UI build/suite, relevant engine/online coverage and full Chromium; PostgreSQL coverage is CI-only ephemeral data. Record skips honestly. No deployment or merge.


## Internal review corrections

Opening already-submitted camp results is read-only outside the current camp stage (and when its results marker is already saved), preserving newer rookie-signing markers. Successful camp plus a refused personal-step update gives retry-results guidance, not another camp submission. Optional seeded setup blocks team/settings/readiness interaction while generation is pending; its focused loading dialog offers reloading the last saved setup after a slow operation. Trading help explicitly describes offseason reopening. The help tablist points to real labelled panels, including hidden panels.

The old fixture builder advances past camp without submitting the human plan. UI-5 does not change that established fixture progression: its new camp snapshot is first arrival, and browser tests actually submit camp through its real controls. The retained-camp legacy regression combines that genuine completed browser snapshot with a genuine offseason snapshot in a controlled server view; it is not claimed as a newly generated current-save state or server integration test.

### Initialization lifetime ruling

A route-local creation lock was insufficient: browser Back can unmount setup while its generation promise remains active. A tiny transient observer now brackets the existing `newLeague` operation with try/finally; no generation statement, return/error behavior, LeagueState field or save schema changes. App-level feedback and setup eligibility subscribe to that operation lifetime, including initial creation and sidebar creation. This is UI loading instrumentation, not a game rule. A delayed-adapter browser regression navigates away/back before completion and requires the lock to remain active. A pure observer test covers multiple pending operations, idempotent completion and subscriber replacement.

Final visual QA reproduced mobile help’s close control being obscured by the navigation stacking context. The drawer now uses a body portal; a browser hit-test requires its close control to be topmost, alongside keyboard focus/Escape checks.
