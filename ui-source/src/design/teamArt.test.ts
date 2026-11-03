import { describe, expect, it } from "vitest";
import { contrastRatio, TEAMS } from "@/data/teams";
import {
  mastheadPalette,
  skylineSvg,
  STADIUM_PHOTO_CREDITS,
  stadiumPhotoUrl,
  TEAM_SKYLINE,
} from "./teamArt";

describe("team skyline", () => {
  it("draws every team, and the same drawing every time", () => {
    for (const t of TEAMS) {
      const a = skylineSvg(t.code);
      expect(a.length, t.code).toBeGreaterThan(500);
      expect(a).toContain("<ellipse");
      expect(skylineSvg(t.code)).toBe(a);
    }
  });

  it("gives every real team its own landmark entry and its own drawing", () => {
    for (const t of TEAMS) expect(TEAM_SKYLINE[t.code], t.code).toBeDefined();
    const drawings = new Set(TEAMS.map((t) => skylineSvg(t.code)));
    expect(drawings.size).toBe(TEAMS.length);
  });

  it("does not throw for a code it has never heard of", () => {
    expect(() => skylineSvg("ZZZ")).not.toThrow();
    expect(() => skylineSvg("")).not.toThrow();
    expect(() => mastheadPalette("ZZZ")).not.toThrow();
  });

  it("keeps gradient ids unique per team, so two skylines on a page don't share one", () => {
    expect(skylineSvg("CAR")).toContain('id="sky-CAR-sg"');
    expect(skylineSvg("CHI")).not.toContain("sky-CAR");
  });
});

describe("masthead palette", () => {
  it("keeps the masthead text readable on every team colour", () => {
    for (const t of TEAMS) {
      const p = mastheadPalette(t.code);
      expect(contrastRatio(p.ink, p.bg), t.code).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.onAccent, p.accent), t.code).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accentText, "#ffffff"), t.code).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lifts near-black team colours off black", () => {
    expect(mastheadPalette("LV").bg).not.toBe("#000000");
    expect(mastheadPalette("CHI").bg.toLowerCase()).not.toBe("#0b162a");
  });

  it("swaps the orange accent for yellow on a red or orange team", () => {
    expect(mastheadPalette("CIN").accent).not.toBe(mastheadPalette("CAR").accent);
    expect(mastheadPalette("KC").accent).toBe(mastheadPalette("CIN").accent);
  });
});

describe("stadium photos", () => {
  it("credits every shipped photo with an author, a licence and a source page", () => {
    for (const [code, c] of Object.entries(STADIUM_PHOTO_CREDITS)) {
      expect(c.author, code).not.toBe("");
      expect(c.license, code).toMatch(/CC|Public domain/);
      expect(c.source, code).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it("asks for any team's photo by code, under the build's own base", () => {
    expect(stadiumPhotoUrl("NYG")).toBe(`${import.meta.env.BASE_URL}art/stadiums/NYG.webp`);
  });
});
