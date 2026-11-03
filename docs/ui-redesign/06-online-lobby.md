# Group 06: the online lobby

Read `00-brief.md` first. Branch `feat/ui-online-lobby`. Open a draft PR to claim it. **Highest risk, lowest
test coverage**: do it in small PRs by section, and say which section each PR covers.

## Screen

**`screens/OnlineLobby.tsx`**, 1393 lines, route `/online`. It uses `CopyButton`, `ManualPicksInput`,
`TurnClock`. Related: `components/OnlineIntro.tsx`, `WaitingStakes.tsx`, `LeagueWire.tsx`, `TurnAlerts.tsx`,
`CommissionerTakeTurn.tsx`, `state/online.ts`. There is almost no e2e coverage of this screen (`isolation.spec.ts`
only checks the browser cannot reach anything but this run's server), so **your own checking has to be
thorough and you must say exactly what you exercised**.

## Suggested sections (one PR each, in this order)

1. Signed-out view and the intro: sign in, create account, what online play is, the "solo versus online"
   explanation, the "Play single-player" way out.
2. The league list and the lobby: your leagues, open leagues, join by invite code, the invite code and its
   `CopyButton`, GM seats and who holds them.
3. Create a league: every setting (format, GM count, fantasy draft, difficulty, talent impact, manual picks
   via `ManualPicksInput`, universe), validation messages.
4. In-league admin: manage GMs, start, pause and resume (commissioner, from PR #77), archive, delete, take a
   turn for someone (`CommissionerTakeTurn`), turn clocks (`TurnClock`).

## Rules specific to this screen

- **Never change networking, auth, request shapes, polling, or when a request is made.** Presentation only.
- Server errors, rate limits, disconnected and "this league isn't yours" states are real and frequent: design
  each of them, do not leave raw error text in an unstyled block.
- Never put an account name, email, invite code or password into a URL. Never display a password.
- Destructive actions (archive, delete, remove a GM) keep their confirmation and must be visually distinct
  and hard to hit by accident (separate from primary actions, 44px, never the accent colour).
- Copy buttons: copying must still work and give feedback; clipboard failure falls back to selecting the text.
- Test with the app's offline/disconnected state (block the server host) and with an empty account.
- This screen has no team of its own: use a neutral masthead (`GdPage code={undefined}`), or the viewer's
  team colours if they have one.

## Acceptance

All of `00-brief.md` section 8, plus: a written list of every state you exercised (signed out, signed in with
no leagues, with leagues, create-league validation errors, server unreachable, commissioner view, non-commissioner
view) and the ones you could not. The online suite and full UI suite pass in CI.
