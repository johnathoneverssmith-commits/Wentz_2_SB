# Deploying the online server

Two services, two free tiers, no credit card. ~20 minutes if the signups go
smoothly.

- **Neon** — Postgres. Free, permanent (not a trial), no card.
- **Render** — one free *web service* for `online/`, one free *static site*
  for the built UI. No card. (Fly.io no longer has a free tier as of late
  2024 — it now requires a card — which is why this isn't a Fly guide.)

The one thing worth knowing going in: Render's free web service spins down
after 15 minutes idle and takes ~30-60s to wake on the next request. For a
private test with a few people that's a minor "first click of the night is
slow" quirk, not a real problem — it's an artifact of the free tier, not a
bug.

## 1. Neon — the database

1. [neon.com](https://neon.com) → sign up (GitHub or email, no card) → New
   Project.
2. Copy the connection string it gives you (starts `postgresql://...`,
   includes `?sslmode=require`). Keep it — you'll paste it into Render in
   step 3.

## 2. Render — the server

1. [render.com](https://render.com) → sign up (no card) → connect your
   GitHub account.
2. **New → Web Service** → pick this repo.
3. Settings:
   - **Root Directory:** leave blank (repo root)
   - **Build Command:** `npm install`
   - **Start Command:** `npm run online:start`
4. **Environment** → add:
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `SESSION_SECRET` | a long random string — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `CLIENT_ORIGIN` | leave blank for now; comes back in step 4 |
5. Deploy. Note the URL Render gives this service
   (`https://<something>.onrender.com`) — the schema applies itself on
   first boot, no separate migration step needed.

## 3. Render — the UI

1. **New → Static Site** → same repo.
2. Settings:
   - **Root Directory:** `ui-source`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
3. **Environment** → add `VITE_LEAGUE_API` = the server URL from step 2.5
   (Vite bakes this in at build time, so it has to be set *before* the
   first deploy — or you trigger a rebuild after adding it.)
4. Deploy. Note *this* URL too.

## 4. Wire the two together

Back on the **web service** (step 2) → Environment → set `CLIENT_ORIGIN` to
the static site's exact URL from step 3 (no trailing slash) → save, which
redeploys it.

That's it — cookies won't flow and CORS will refuse the UI until this step
is done, so if sign-in fails with a CORS error, this is almost always why.

## Sanity check

Open the static site URL, register an account, create a league, get the
invite code, hand it to whoever's joining. If a request hangs for the first
~45 seconds, that's the free tier waking up — not broken.

## Make deploys verifiable

This repository publishes the Render commit in both artifacts:

- The static site's HTML contains `franchise-commit` and `franchise-api` meta tags.
- The online server exposes `GET /version` with its Render commit.

After both services deploy, verify that they are serving the same expected
commit:

```bash
npm run deploy:verify -- --ui https://wentz-2-sb-2.onrender.com --api https://YOUR-API.onrender.com
```

The command exits nonzero if either service is stale or if the UI and API are
on different commits.

For automatic deployments, add these GitHub repository settings and keep the
included `.github/workflows/deploy-render.yml` workflow enabled:

- Secret `RENDER_UI_DEPLOY_HOOK`: the static site's secret Render deploy hook.
- Secret `RENDER_API_DEPLOY_HOOK`: the web service's secret Render deploy hook.
- Variable `DEPLOY_UI_URL`: `https://wentz-2-sb-2.onrender.com`.
- Variable `DEPLOY_API_URL`: the online API's public Render URL.

The workflow tests the exact pushed commit, sends that SHA to both Render
deploy hooks, and waits until both public services report the same SHA. This
turns a missing or stale deployment into a visible failed GitHub check instead
of leaving the live game silently behind the repository.

## Local dev is untouched

`DATABASE_URL` unset (or pointing at `localhost`) skips TLS entirely, and
`NODE_ENV` unset keeps cookies at `SameSite=Lax` — nothing here changes
`npm run online` against a local Postgres.

## Test the online game locally before you push

The workflow runs every suite — engine, UI and `npm run online:test`, the
league server's own — so a change that works in the dynasty and breaks the
online league fails the check instead of reaching the live game. To see it
end to end first, with no Postgres install:

```bash
npm run online:db       # PGlite on :5433, in memory
npm run online:local    # the real server on :8788 against it
npm --prefix ui-source run dev   # the UI on :5173, which calls :8788
```

Then drive whole seasons over HTTP, as real GMs would, with checks for the
things that have gone wrong online before (spoilers from unwatched weeks,
events skipped by a ready click, records and awards not written):

```bash
npx tsx --tsconfig online/tsconfig.json online/dev/e2e-http.ts --seasons 2 --humans 2
npx tsx --tsconfig online/tsconfig.json online/dev/e2e-http.ts --seasons 2 --humans 2 --fantasy
npx tsx --tsconfig online/tsconfig.json online/dev/e2e-http.ts --seasons 2 --humans 3 --format humansOnly
```

`--browser` leaves the first GM to you in the UI (it prints the sign-in
name) and plays the rest; `--resume <leagueId> --users a,b` picks a league
back up after a server restart. If you kill the server mid-request and every
query then fails with "Connection terminated unexpectedly", restart
`online:db` too — PGlite is one session behind every socket.
