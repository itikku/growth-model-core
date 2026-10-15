// Stochastic reference simulator: draws a Panel from known parameters, engineer by engineer, with
// exactly the model the fitter assumes. Used to test that fitting recovers the truth, and to make
// sample data for a world described only by its parameters (World A, B, or a new World C).
import { curve } from './fit-depth';
import { createRng } from './rng';
import type { AccountWeekObs, EngineerWeekObs, FunnelRates, Panel, SimAccount } from './types';

export type WorldSpec = {
  firstWeek: number;
  lastWeek: number;
  accounts: SimAccount[];
  funnel: FunnelRates;
  p: number; q: number; c: number; ceiling: number;
  startTeam?: number; // engineers who start together in an account's first active week (default 1)
  dMax: number; d0: number; lambda: number;
  kLevel: number; // ln(tokens per workflow) at week 0
  kTrend: number; // weekly change in ln(tokens per workflow)
  tokenNoise?: number; // sd of ln tokens per account-week (default 0.1)
  period?: (week: number) => number; // calendar depth multiplier (default 1)
  theta?: Record<string, number>; // account adoption multipliers (default 1)
  depthMult?: Record<string, number>; // account depth multipliers (default 1)
  labelStarts?: boolean; // record whether each start came from a colleague or from outreach
};

export function simulatePanel(spec: WorldSpec, seed: string): Panel {
  const accountWeeks: AccountWeekObs[] = [];
  const engineerWeeks: EngineerWeekObs[] = [];
  for (const acct of spec.accounts) {
    const rng = createRng(`${seed}|${acct.id}`);
    const reach = Math.max(1, Math.round(spec.ceiling * acct.seats));
    const theta = spec.theta?.[acct.id] ?? 1;
    const mu = spec.depthMult?.[acct.id] ?? 1;
    const tenure = new Map<number, number>(); // engineer index → tenure
    const via = new Map<number, 'colleague' | 'outreach'>(); // how engineers who started this week started
    let everActive = false;
    let quiet = 0;
    for (let w = acct.provisionedWeek; w <= spec.lastWeek; w++) {
      let active: boolean;
      if (!everActive) active = rng.chance(spec.funnel.activation);
      else if (quiet === 0) active = rng.chance(spec.funnel.retention);
      else active = rng.chance(quiet <= 3 ? spec.funnel.atRisk : quiet <= 11 ? spec.funnel.lapsed : spec.funnel.dormant);

      via.clear();
      if (active && !everActive) {
        everActive = true;
        for (let e = 0; e < Math.min(reach, Math.max(1, Math.round(spec.startTeam ?? 1))); e++) tenure.set(e, 0); // the pilot team
      } else if (active) {
        const n = tenure.size;
        const hazard = Math.min(1, theta * (spec.p + (spec.q * n) / reach));
        const next = new Map<number, number>();
        for (const [e, t] of tenure) if (!rng.chance(spec.c)) next.set(e, t + 1);
        const colleagueShare = hazard > 0 ? Math.min(1, theta * (spec.q * n) / reach) / hazard : 0;
        for (let e = 0; e < reach; e++) {
          if (!tenure.has(e) && rng.chance(hazard)) {
            next.set(e, 0);
            via.set(e, rng.chance(colleagueShare) ? 'colleague' : 'outreach');
          }
        }
        if (next.size === 0) {
          // An active account always has someone engaged: one reachable engineer starts (a forced adoption).
          const free = Array.from({ length: reach }, (_, e) => e).filter((e) => !tenure.has(e));
          const e = free.length ? free[Math.floor(rng.next() * free.length)] : 0;
          next.set(e, 0);
          via.set(e, 'outreach');
        }
        tenure.clear();
        for (const [e, t] of next) tenure.set(e, t);
      }
      quiet = active ? 0 : everActive ? quiet + 1 : 0;
      if (!active) continue;

      const m = spec.period?.(w) ?? 1;
      const credits = [...tenure].map(([e, t]) => [e, rng.poisson(mu * m * curve(spec.dMax, spec.d0, spec.lambda, t))] as const);
      if (credits.every(([, k]) => k === 0)) credits[0] = [credits[0][0], 1]; // an active week has at least one workflow
      const workflows = credits.reduce((a, [, k]) => a + k, 0);
      const lnK = spec.kLevel + spec.kTrend * w + rng.normal(0, spec.tokenNoise ?? 0.1);
      if (w < spec.firstWeek) continue;
      accountWeeks.push({ accountId: acct.id, week: w, workflows, tokens: workflows * Math.exp(lnK) });
      for (const [e, k] of credits) {
        const v = spec.labelStarts ? via.get(e) : undefined;
        engineerWeeks.push({ accountId: acct.id, engineerId: `${acct.id}-e${e}`, week: w, credited: k, ...(v ? { startedVia: v } : {}) });
      }
    }
  }
  return { firstWeek: spec.firstWeek, lastWeek: spec.lastWeek, accounts: spec.accounts, accountWeeks, engineerWeeks };
}
