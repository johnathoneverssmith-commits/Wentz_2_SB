-- Durable storage for an online league.
--
-- The shape follows what `ui-source/src/state/store.ts` already holds, because
-- this is a migration of a working data model into a database rather than a
-- redesign. That produces one deliberate asymmetry worth explaining up front:
--
--   * `league_state.state` is the whole `LeagueState` as JSONB.
--   * Everything else — users, franchises, invites, the event log — is a
--     normal relational table.
--
-- The rules that govern a league (`ui-source/src/state/rules.ts`) are pure
-- functions over an entire `LeagueState`. Shredding that object across thirty
-- tables would mean rewriting every one of them against rows, which is the
-- one thing this work is not allowed to do — those functions are the game,
-- and they're unit-tested. So the document stays whole and the columns
-- alongside it exist for the things a database actually has to do: find a
-- league, know who owns a team, serialise contending writes, and answer "what
-- is waiting on me" without deserialising megabytes.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_folded   TEXT NOT NULL UNIQUE,      -- lower-cased, for case-insensitive login
  password_hash TEXT NOT NULL,             -- scrypt, see online/src/auth.ts
  password_salt TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leagues (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  commissioner  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invite_code   TEXT NOT NULL UNIQUE,
  -- How long a phase waits on an absent GM before the AI plays it for them.
  -- Async play is the point: nobody can be allowed to stall a league forever.
  phase_timeout_hours INTEGER NOT NULL DEFAULT 48,
  -- The draft is the one place order matters enough to need its own clock.
  pick_timeout_hours  INTEGER NOT NULL DEFAULT 12,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

-- The league document. One row per league; `version` is the optimistic
-- concurrency token every write checks and bumps.
CREATE TABLE IF NOT EXISTS league_state (
  league_id     TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
  state         JSONB NOT NULL,
  version       BIGINT NOT NULL DEFAULT 1,
  -- Denormalised out of the document so the lobby can list leagues, and the
  -- phase sweeper can find expired ones, without reading every state blob.
  season        INTEGER NOT NULL,
  stage         TEXT NOT NULL,
  week          INTEGER NOT NULL,
  phase_ends_at TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS league_state_deadline_idx
  ON league_state (phase_ends_at) WHERE phase_ends_at IS NOT NULL;

-- One row per team in the league. `user_id` NULL means the AI runs it, which
-- is also what an unclaimed team looks like — there is no third state.
CREATE TABLE IF NOT EXISTS franchises (
  league_id     TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_code     TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  gm_id         TEXT NOT NULL,             -- matches LeagueState.gms[].id
  ready         BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at  TIMESTAMPTZ,
  PRIMARY KEY (league_id, team_code)
);

CREATE INDEX IF NOT EXISTS franchises_user_idx ON franchises (user_id);

-- Append-only. Every accepted action lands here: it is the league's history,
-- the feed a returning GM reads to find out what happened while they were
-- away, and the audit trail when someone disputes a trade.
CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  league_id     TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user    TEXT REFERENCES users(id) ON DELETE SET NULL,
  team_code     TEXT,
  kind          TEXT NOT NULL,             -- 'trade.accepted', 'draft.pick', …
  summary       TEXT NOT NULL,             -- one line, already written for a human
  detail        JSONB
);

CREATE INDEX IF NOT EXISTS events_league_idx ON events (league_id, id DESC);

-- Sessions are signed cookies rather than rows, so there is no table here on
-- purpose; see online/src/auth.ts. Revoking one user everywhere means bumping
-- their password, which is the same thing most small sites do.
