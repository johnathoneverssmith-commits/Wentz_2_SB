import type { LeagueState } from "@/domain";

/**
 * The training camp as one GM may read it: their own plan, results and repeat history, nothing of anyone else's.
 * `prior` is last season's choices by team, which is as private as this season's plans are.
 */
export function redactTrainingCamp(camp: NonNullable<LeagueState["trainingCamp"]>, mine: string | undefined): NonNullable<LeagueState["trainingCamp"]> {
  const { prior, ...rest } = camp;
  return {
    ...rest,
    plans: mine && camp.plans[mine] ? { [mine]: camp.plans[mine]! } : {},
    results: mine && camp.results[mine] ? { [mine]: camp.results[mine]! } : {},
    ...(mine && prior?.[mine] ? { prior: { [mine]: prior[mine]! } } : {}),
  };
}
