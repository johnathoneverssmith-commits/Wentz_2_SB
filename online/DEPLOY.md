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

## Local dev is untouched

`DATABASE_URL` unset (or pointing at `localhost`) skips TLS entirely, and
`NODE_ENV` unset keeps cookies at `SameSite=Lax` — nothing here changes
`npm run online` against a local Postgres.
