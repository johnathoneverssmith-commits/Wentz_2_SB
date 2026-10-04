import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { attentionOf, encryptPayload, isPushService, nudgesFor } from "../src/push.js";

/**
 * Web Push (`online/src/push.ts`). The push services can't be reached from a
 * test, so these check the two halves that have to be exactly right — the
 * RFC 8291 encryption, by decrypting it the way a browser does — and the
 * decision about who to notify.
 */

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** The receiving side of RFC 8291, as a browser implements it. */
function decrypt(body: Buffer, uaPrivate: ReturnType<typeof createECDH>, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = uaPrivate.computeSecret(asPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPrivate.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  // strip the record's padding delimiter
  return plain.subarray(0, plain.lastIndexOf(2));
}

describe("web push", () => {
  it("encrypts a payload the browser can read (RFC 8291)", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const msg = Buffer.from(JSON.stringify({ title: "Your turn", body: "Rookie draft: you're on the clock." }));
    const body = encryptPayload(msg, ua.getPublicKey().toString("base64url"), auth.toString("base64url"));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, ua, auth).toString()).toBe(msg.toString());
  });

  it("only sends to the browsers' own push services", () => {
    expect(isPushService("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushService("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushService("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushService("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushService("https://169.254.169.254/latest")).toBe(false);
    expect(isPushService("https://evil.example/fcm.googleapis.com")).toBe(false);
  });

  it("nudges the GM a change puts on the clock, and nobody else", () => {
    const base = {
      stage: "offseasonDraft",
      readiness: {},
      gms: [
        { id: "g1", isHuman: true, teamCode: "BUF" },
        { id: "g2", isHuman: true, teamCode: "KC" },
        { id: "g3", isHuman: false, teamCode: "MIA" },
      ],
      trades: [],
      draft: { pickOrder: ["MIA", "BUF", "KC"], currentPickIndex: 0 },
    };
    const before = attentionOf(base as never);
    const after = { ...base, draft: { ...base.draft, currentPickIndex: 1 } };
    const n = nudgesFor("L1", "Test League", before, attentionOf(after as never), after as never);
    expect([...n.keys()]).toEqual(["BUF"]);
    expect(n.get("BUF")!.body).toMatch(/on the clock/);

    // a trade offer to KC
    const offered = { ...after, trades: [{ status: "offered", toTeam: "KC" }] };
    const n2 = nudgesFor("L1", "Test League", attentionOf(after as never), attentionOf(offered as never), offered as never);
    expect([...n2.keys()]).toEqual(["KC"]);
  });
});
