# Alpha tester guide

Thank you for testing. This is an early build of an NFL franchise simulation. Expect rough edges. This guide says what to
use, what is known to be limited, what to try, and how to report a problem so we can reproduce it.

*Draft for the owner to review before it goes to testers. It reflects `docs/alpha/ALPHA_READINESS.md` at master
`6461f4b`; update both together.*

## Supported browsers

| Browser | Status |
|---|---|
| Chrome or Edge (current), desktop | **Supported.** Tested. |
| Chrome on Android | Expected to work. Layout checked in an emulated viewport only. |
| Firefox, Safari (desktop or iPhone) | **Not tested yet.** Try if you like, and say so in your report. |

Use a normal window, not a private one: the game keeps your dynasty in the browser's storage. Phone and desktop are both
welcome; narrow screens down to 320 px wide were checked.

## Two ways to play

- **Online league (recommended for this alpha).** Sign in under **Online leagues**, start a league or join one with an invite
  code, and claim a team. Games are simulated on the server with the real engine, and the league moves forward when every
  GM has checked in. Turns have deadlines, so agree a pace with the group.
- **Solo dynasty.** Everything stays on your device. **Solo uses a simplified simulator, not the real engine**, unless
  you run the engine yourself. The hub says "Mock simulation (not the real engine)". It has no play-by-play, ignores game
  plans, and can produce odd scores. Judge decisions and screens in solo, not football realism.

## Known limitations

- **Online playoffs can stall** if none of the human teams is still alive in the bracket. Players see "Waiting for other
  players" and no button. Tell the commissioner; do not keep retrying. (Tracked as alpha blocker B1.)
- **Reloading during the online draft** can drop you on League Setup. Click the current stage in the left menu to return.
- Stadium photos may be missing on the online site and show a skyline instead.
- Your solo dynasty lives in this browser on this address. Clearing site data deletes it. Use **Download backup** on the setup
  screen before you experiment, and again after a big session.
- Starting a **New solo dynasty** replaces the one you have. A recovery copy is kept, but do not rely on it.
- The first load of a free-tier server can take a minute.
- Online scouting and the browser-side real engine are not part of this alpha.

## Focused test goals

Pick one per session and tell us which. Say which mode you used.

1. **Start a league.** Online: create, invite, join, claim. Solo: create and pick a team. Is every step clear?
2. **The draft.** Can you tell whose turn it is, how long you have, and what each button does? Reload once and see where you land.
3. **A season, week by week.** Play preseason, the regular season, the trade deadline and free agency. Do the screens agree with each other?
4. **Playoffs.** Follow your team through the bracket. Does the app tell you what it is waiting for?
5. **Offseason and year two.** Retirements, rookie draft, re-signing. Does year two start cleanly, with the right schedule and roster?
6. **Leave and come back.** Close the tab mid-stage, or lose your connection, then return. Is anything lost or repeated?
7. **Phone.** Setup, one game week, the roster screen. Can you read and tap everything?

## Reporting a bug

Open a GitHub issue titled `[alpha] <short description>` with this template. Screenshots help; a short screen recording of
the steps helps more.

```markdown
**Mode:** online league / solo dynasty
**Build or date:** (the commit shown on the site if any, otherwise the date and time you played)
**Browser and device:** (e.g. Chrome 153 on Windows, or Safari on iPhone 15)
**Window size:** desktop / phone, and whether you reloaded or went offline

**Where were you?** (season, stage and screen, e.g. "2027 regular season, Weekly Team Hub, week 4")
**What did you do?** (numbered steps, starting from a screen anyone can reach)
1.
2.
3.
**What did you expect?**
**What happened instead?**
**How often?** once / every time / sometimes

**League details (online only):** league name, your team, other GMs' teams, turn length
**Seed (solo only):** shown under League Settings, if you set one
**Did the page keep working after?** yes / no, and what you did to recover
**Backup:** (solo only) attach a "Download backup" file if the bug involves your save
```

Do not post passwords, session cookies or anyone's email in a report.
