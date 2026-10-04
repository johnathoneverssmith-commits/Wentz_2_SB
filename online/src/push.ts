/**
 * Web Push: a notification on a GM's phone or desktop when the league needs
 * them — their pick, their free-agency turn, a trade offer, a new stage —
 * whether or not the game is open anywhere.
 *
 * The in-page turn alerts (`TurnAlerts.tsx`) only fired while a tab was open,
 * which in an asynchronous league is exactly when nobody needs one: the GM
 * who left for the day never heard their pick come round, and the league sat
 * on their clock until the autopilot took it.
 *
 * Implemented on Node's own crypto rather than a package: VAPID (RFC 8292)
 * is one ES256-signed JWT, and the payload encryption (RFC 8291, aes128gcm)
 * is an ECDH agreement, two HKDF steps and one AES-GCM call. The server's
 * VAPID key pair is made on first use and kept in the database, so there is
 * nothing to configure; `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url,
 * raw) override it if set.
 */
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from "node:crypto";
import type pg from "pg";

import type { LeagueState } from "@/domain";
import { coachingOnTheClock } from "@/state/coachingDraft.ts";
import { onTheClock as faOnTheClock } from "@/state/freeAgencyEvent.ts";
import { STAGE_LABEL } from "@/state/stageMachine.ts";
import { pendingFor } from "@/state/tradeDeadline.ts";

const b64u = (b: Buffer): string => b.toString("base64url");
const unb64u = (s: string): Buffer => Buffer.from(s, "base64url");

// ---- keys ------------------------------------------------------------------

interface Vapid {
  publicKey: string; // 65-byte uncompressed point, base64url
  privateKey: string; // 32-byte scalar, base64url
}
let vapid: Promise<Vapid> | null = null;

/** The server's key pair: the environment's, else the database's, else a new one saved there. */
export function vapidKeys(pool: pg.Pool): Promise<Vapid> {
  vapid ??= (async () => {
    const envPub = process.env.VAPID_PUBLIC_KEY;
    const envPriv = process.env.VAPID_PRIVATE_KEY;
    if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };
    const got = await pool.query<{ public_key: string; private_key: string }>(
      "SELECT public_key, private_key FROM push_keys WHERE id = 1",
    );
    if (got.rows[0]) return { publicKey: got.rows[0].public_key, privateKey: got.rows[0].private_key };
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const fresh = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
    await pool.query(
      "INSERT INTO push_keys (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING",
      [fresh.publicKey, fresh.privateKey],
    );
    // whichever insert won is the key everyone uses
    const final = await pool.query<{ public_key: string; private_key: string }>(
      "SELECT public_key, private_key FROM push_keys WHERE id = 1",
    );
    return { publicKey: final.rows[0]!.public_key, privateKey: final.rows[0]!.private_key };
  })();
  vapid.catch(() => {
    vapid = null;
  });
  return vapid;
}

/** The ES256 JWT a push service checks the sender against (RFC 8292). */
function vapidAuth(endpoint: string, keys: Vapid): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(
    Buffer.from(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: process.env.VAPID_SUBJECT ?? "mailto:franchise-sim@example.invalid",
      }),
    ),
  );
  const pub = unb64u(keys.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const sig = sign("sha256", Buffer.from(`${header}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---- encryption (RFC 8291) ---------------------------------------------------

const hmac = (key: Buffer, data: Buffer): Buffer => createHmac("sha256", key).update(data).digest();

export function encryptPayload(payload: Buffer, p256dh: string, auth: string): Buffer {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // one record, so the padding delimiter is 0x02 (last record)
  const ct = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

/**
 * Only the browsers' own push services. The server POSTs to whatever endpoint
 * a subscription names, so an arbitrary URL here would let anyone signed in
 * aim the server at any address it can reach.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];
export function isPushService(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send one notification. Resolves to false when the subscription is gone for good. */
export async function sendPush(pool: pg.Pool, sub: Subscription, message: PushMessage): Promise<boolean> {
  const keys = await vapidKeys(pool);
  const body = encryptPayload(Buffer.from(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuth(sub.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "normal",
    },
    body,
  });
  // 404/410: the browser dropped it (uninstalled, permission revoked)
  return !(res.status === 404 || res.status === 410);
}

// ---- who needs a nudge -----------------------------------------------------

export interface PushMessage {
  title: string;
  body: string;
  /** collapses repeats of the same kind into one notification */
  tag: string;
  leagueId: string;
}

/** What each human team is being asked for, right now. */
export interface Attention {
  stage: string;
  turn: Set<string>;
  offers: Map<string, number>;
  waiting: Set<string>;
}

const humanTeams = (s: LeagueState): string[] =>
  s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode!);

export function attentionOf(s: LeagueState): Attention {
  const turn = new Set<string>();
  const humans = humanTeams(s);
  if ((s.stage === "fantasyDraft" || s.stage === "offseasonDraft") && s.draft) {
    const t = s.draft.pickOrder[s.draft.currentPickIndex];
    if (t) turn.add(t);
  } else if (s.stage === "freeAgency" || s.stage === "midseasonFreeAgency") {
    const t = faOnTheClock(s);
    if (t) turn.add(t);
  } else if (s.stage === "coachingDraft") {
    const t = coachingOnTheClock(s);
    if (t) turn.add(t);
  } else if (s.stage === "tradeDeadline") {
    for (const t of humans) if (pendingFor(s, t) != null) turn.add(t);
  }
  const offers = new Map<string, number>();
  for (const t of humans) {
    offers.set(t, s.trades.filter((x) => x.status === "offered" && x.toTeam === t).length);
  }
  const waiting = new Set(s.gms.filter((g) => g.isHuman && g.teamCode && !s.readiness[g.id]).map((g) => g.teamCode!));
  return { stage: s.stage, turn, offers, waiting };
}

/** The notifications a change from `before` to `after` calls for, by team. */
export function nudgesFor(leagueId: string, leagueName: string, before: Attention, after: Attention, s: LeagueState): Map<string, PushMessage> {
  const out = new Map<string, PushMessage>();
  const label = STAGE_LABEL[after.stage as keyof typeof STAGE_LABEL] ?? after.stage;
  for (const t of humanTeams(s)) {
    if (after.turn.has(t) && !before.turn.has(t)) {
      out.set(t, { title: `Your turn — ${leagueName}`, body: `${label}: you're on the clock.`, tag: `turn-${leagueId}`, leagueId });
    } else if ((after.offers.get(t) ?? 0) > (before.offers.get(t) ?? 0)) {
      out.set(t, { title: `New trade offer — ${leagueName}`, body: "Another team made you an offer.", tag: `offer-${leagueId}`, leagueId });
    } else if (after.stage !== before.stage && after.waiting.has(t)) {
      out.set(t, { title: `${leagueName}`, body: `${label} is open and waiting on you.`, tag: `stage-${leagueId}`, leagueId });
    }
  }
  return out;
}

/**
 * After a commit: notify each GM the change just put on the hook, on every
 * device they subscribed. Fire and forget — a push service being slow or down
 * must never touch the action that triggered it.
 */
export async function deliverNudges(pool: pg.Pool, leagueId: string, nudges: Map<string, PushMessage>): Promise<void> {
  if (nudges.size === 0) return;
  const teams = [...nudges.keys()];
  const subs = await pool.query<{ team_code: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT f.team_code, p.endpoint, p.p256dh, p.auth
       FROM franchises f JOIN push_subscriptions p ON p.user_id = f.user_id
      WHERE f.league_id = $1 AND f.team_code = ANY($2)`,
    [leagueId, teams],
  );
  await Promise.all(
    subs.rows.map(async (r) => {
      try {
        const alive = await sendPush(pool, r, nudges.get(r.team_code)!);
        if (!alive) await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [r.endpoint]);
      } catch {
        // a push service hiccup; the next nudge will try again
      }
    }),
  );
}
