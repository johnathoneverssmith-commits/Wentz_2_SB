import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Contract } from "@/domain";
import { ContractFacts, RosterFinance, StaffCost } from "./RosterFinance";

vi.mock("@/motion/level", () => ({ useMotionLevel: () => "off" }));

describe("roster financial presentation", () => {
  it("binds the reported player cap and keeps staff costs separate", () => {
    const html = renderToStaticMarkup(createElement(RosterFinance, { total: 255, used: 238.6, room: 16.4, dead: 3.2 }));
    expect(html).toContain('aria-valuenow="238.6"');
    expect(html).toContain('aria-valuemax="255"');
    for (const amount of ["$255.0M", "$238.6M", "$16.4M", "$3.2M"]) expect(html).toContain(amount);
    const staff = renderToStaticMarkup(createElement(StaffCost, { value: 12.1 }));
    expect(staff).toContain("$12.1M");
    expect(staff).toContain("Outside the player cap");
  });

  it("does not turn an over-cap amount into available room", () => {
    const html = renderToStaticMarkup(createElement(RosterFinance, { total: 255, used: 260, room: -5, dead: 0 }));
    expect(html).toContain("-$5.0M");
    expect(html).toContain("102%");
    expect(html).toContain('aria-valuetext="260 of 255"');
    expect(html).toContain('aria-valuenow="255"');
  });

  it("does not invent a cap scale when no cap is reported", () => {
    const html = renderToStaticMarkup(createElement(RosterFinance, { total: 0, used: 0, room: 0, dead: 0 }));
    expect(html).toContain("Cap not available");
    expect(html).not.toContain('role="meter"');
  });
});

describe("contract facts", () => {
  const deal: Contract = { team_id: "BAL", years_remaining: 3, total_value: 60, guaranteed: 27, signing_bonus: 10, cap_hit_by_year: [12, 17, 21] };
  it("shows each supplied contract term and cap hit without projecting new terms", () => {
    const html = renderToStaticMarkup(createElement(ContractFacts, { contract: deal }));
    for (const amount of ["$60.0M", "$27.0M", "$10.0M", "$12.0M", "$17.0M", "$21.0M"]) expect(html).toContain(amount);
    expect(html).toContain("3 years remaining");
    expect(html).toContain("Remaining year 3");
    expect(html).not.toContain("Remaining year 4");
  });
  it("names missing contract data rather than showing a zero-dollar deal", () => {
    const html = renderToStaticMarkup(createElement(ContractFacts, { contract: null }));
    expect(html).toContain("No contract on record");
    expect(html).not.toContain("$0.0M");
  });
});
