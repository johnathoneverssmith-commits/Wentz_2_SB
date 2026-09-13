import { describe, it } from "vitest";
import { DEFAULT_CONFIG } from "@/state/seed.ts";
import { useStore } from "@/state/store.ts";

describe("soak", () => {
  it("five seasons", async () => {
    const S = () => useStore.getState();
    const viewer = () => S().gms.find((g) => g.id === S().viewerGmId)?.teamCode ?? "";
    await S().newLeague(404, { ...DEFAULT_CONFIG, humanGmCount: 1 });

    const report = (tag: string) => {
      const s = S();
      const rostered = Object.values(s.players).filter((p) => !p.retired && !p.free_agent && p.nfl_team !== "FA");
      const fa = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
      const sizes = Object.keys(s.teams).map((c) => rostered.filter((p) => p.nfl_team === c).length);
      const ovr = rostered.map((p) => p.overall).sort((a, b) => b - a);
      const ages = rostered.map((p) => p.age);
      const rooms = Object.keys(s.teams).map((c) => +(s.teams[c]!.cap.total - s.teams[c]!.cap.used).toFixed(1));
      const retired = Object.values(s.players).filter((p) => p.retired).length;
      const ghosts = Object.values(s.players).filter((p) => !p.retired && p.free_agent && p.nfl_team !== "FA").length;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} season=${s.season} n=${rostered.length} sizes=${Math.min(...sizes)}-${Math.max(...sizes)}` +
          ` ovr top/med/low=${ovr[0]}/${ovr[Math.floor(ovr.length / 2)]}/${ovr[ovr.length - 1]}` +
          ` age=${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)}` +
          ` fa=${fa.length} retired=${retired} rooms=${Math.min(...rooms)}..${Math.max(...rooms)} ghosts=${ghosts}` +
          ` players=${Object.keys(s.players).length}`,
      );
    };

    let guard = 700;
    let years = 0;
    while (years < 5 && guard-- > 0) {
      const stage = S().stage;
      if (stage === "setup") {
        for (const g of S().gms) if (g.isHuman && !g.teamCode) S().pickTeam(g.id, Object.keys(S().teams)[0]!);
      } else if (stage === "fantasyDraft") { S().startDraft("fantasy"); S().autopickRemaining(); }
      else if (stage === "offseasonDraft") { S().startDraft("rookie"); S().autopickRemaining(); }
      else if (stage === "offseasonSignings") {
        const m = viewer();
        for (const r of S().draft?.results ?? []) if (r.teamCode === m && r.selectedId) S().signRookie(r.selectedId, m);
      } else if (stage === "coachingHiring" || stage === "offseasonFreeAgency") {
        const subj = stage === "coachingHiring" ? "coaches" : "players";
        S().startBidding(subj);
        for (let d = 0; d < 6; d++) S().advanceBiddingDay(subj);
      } else if (stage === "preseason" || stage === "regularSeason" || stage === "playoffs") {
        await S().simulateGameDay();
      }
      S().autoReadyNonViewers(); S().setReady(S().viewerGmId, true);
      if (stage === "preseason" || stage === "regularSeason" || stage === "playoffs") await S().finishGameDay();
      else await S().tryAdvance();
      if (stage === "offseasonDepthChart" && S().stage === "preseason") { years++; report(`Y${years}`); }
    }
  }, 900000);
});
