// Growth stage of each account at the last observed week, from its last 8 weeks. Rules, in order:
//   nascent:     not active yet and provisioned under 8 weeks ago, or first active in the last 6 weeks
//   stalled:     never active (older), quiet 4+ weeks, active under 4 of the last 8 weeks, or workflows growing < 2%/week
//   compounding: growing, and each engaged user brings in more than one replacement before stopping (R ≥ 1)
//   linear:      growing, but R < 1: growth comes from outreach and learning, which level off
//   R = θ · q · (1 − N/M) / c
import type { PanelIndex } from './panel';
import type { FitResult } from './types';

export type GrowthStage = 'nascent' | 'stalled' | 'linear' | 'compounding';
export const STAGES: GrowthStage[] = ['nascent', 'stalled', 'linear', 'compounding'];
export type StageResult = { stage: GrowthStage; reason: string; weeklyGrowth: number | null; reproduction: number | null };

const WINDOW = 8;
const MIN_GROWTH = 0.02;

export function classifyStages(ix: PanelIndex, fit: FitResult): Map<string, StageResult> {
  const T = ix.lastWeek;
  const params = new Map(fit.accounts.map((a) => [a.id, a]));
  const out = new Map<string, StageResult>();
  for (const s of ix.series) {
    const id = s.account.id;
    const a = params.get(id)!;
    const engaged = s.lastTenure.reduce((x, y) => x + y, 0);
    const reach = fit.global.ceiling * s.account.seats;
    const reproduction = a.c > 0 ? (a.theta * fit.global.q * Math.max(0, 1 - engaged / Math.max(reach, 1e-9))) / a.c : Infinity;
    const res = (stage: GrowthStage, reason: string, weeklyGrowth: number | null = null): StageResult => ({ stage, reason, weeklyGrowth, reproduction: s.firstActive === null ? null : reproduction });
    if (s.firstActive === null) {
      out.set(id, T - s.account.provisionedWeek < WINDOW ? res('nascent', 'Provisioned recently; not active yet.') : res('stalled', 'Provisioned 8+ weeks ago and never active.'));
      continue;
    }
    if (s.firstActive > T - 6) {
      out.set(id, res('nascent', 'First active in the last 6 weeks.'));
      continue;
    }
    const last = s.state[s.state.length - 1];
    if (last - 1 >= 4) {
      out.set(id, res('stalled', `Quiet for ${last - 1 >= 12 ? '12+' : last - 1} weeks.`));
      continue;
    }
    const recent: { w: number; y: number; wt: number }[] = [];
    s.weeks.forEach((w, i) => {
      if (w > T - WINDOW && s.workflows[i] > 0) recent.push({ w, y: Math.log(s.workflows[i]), wt: s.workflows[i] });
    });
    if (recent.length < 4) {
      out.set(id, res('stalled', `Active in only ${recent.length} of the last 8 weeks.`));
      continue;
    }
    const wt = recent.reduce((x, o) => x + o.wt, 0);
    const mw = recent.reduce((x, o) => x + o.wt * o.w, 0) / wt;
    const my = recent.reduce((x, o) => x + o.wt * o.y, 0) / wt;
    const sxx = recent.reduce((x, o) => x + o.wt * (o.w - mw) ** 2, 0);
    const slope = sxx > 0 ? recent.reduce((x, o) => x + o.wt * (o.w - mw) * (o.y - my), 0) / sxx : 0;
    const growth = Math.exp(slope) - 1;
    if (growth < MIN_GROWTH) out.set(id, res('stalled', `Workflows changing ${(growth * 100).toFixed(1)}%/week.`, growth));
    else if (reproduction >= 1) out.set(id, res('compounding', `Growing ${(growth * 100).toFixed(1)}%/week; each user brings in ${reproduction.toFixed(1)} more.`, growth));
    else out.set(id, res('linear', `Growing ${(growth * 100).toFixed(1)}%/week, but each user brings in only ${reproduction.toFixed(1)} more.`, growth));
  }
  return out;
}
