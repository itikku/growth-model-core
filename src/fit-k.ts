// Token intensity K = tokens per workflow. ln K per account = level + trend · week, with the trend
// pooled within accounts over recent weeks (weighted by workflows) and each level shrunk toward the pool.
// The forecast damps the trend, because step changes (a new feature) look like trends in a short window.
import type { PanelIndex } from './panel';

const LEVEL_SHRINK = 20; // pseudo-workflows
export const K_DAMPING = 0.8;

export type KFit = { level: number; trend: number; accounts: Map<string, number>; accountWeeks: number };

export function fitK(ix: PanelIndex, window: number): KFit {
  const from = ix.lastWeek - window;
  type Obs = { w: number; y: number; wt: number };
  const byAccount = new Map<string, Obs[]>();
  for (const s of ix.series) {
    const obs: Obs[] = [];
    s.weeks.forEach((w, i) => {
      if (w > from && s.workflows[i] > 0 && s.tokens[i] > 0) obs.push({ w, y: Math.log(s.tokens[i] / s.workflows[i]), wt: s.workflows[i] });
    });
    if (obs.length) byAccount.set(s.account.id, obs);
  }
  // Pooled within-account slope.
  let sxy = 0, sxx = 0, n = 0;
  const means = new Map<string, { w: number; y: number; wt: number }>();
  for (const [id, obs] of byAccount) {
    const wt = obs.reduce((a, o) => a + o.wt, 0);
    const mw = obs.reduce((a, o) => a + o.wt * o.w, 0) / wt;
    const my = obs.reduce((a, o) => a + o.wt * o.y, 0) / wt;
    means.set(id, { w: mw, y: my, wt });
    for (const o of obs) {
      sxy += o.wt * (o.w - mw) * (o.y - my);
      sxx += o.wt * (o.w - mw) ** 2;
    }
    n += obs.length;
  }
  const trend = sxx > 0 ? sxy / sxx : 0;
  // Each account's level at the last week, then shrink toward the workflow-weighted pool.
  const raw = new Map<string, { level: number; wt: number }>();
  let pw = 0, pl = 0;
  for (const [id, mm] of means) {
    const level = mm.y + trend * (ix.lastWeek - mm.w);
    raw.set(id, { level, wt: mm.wt });
    pw += mm.wt;
    pl += mm.wt * level;
  }
  const level = pw > 0 ? pl / pw : 0;
  const accounts = new Map<string, number>();
  for (const s of ix.series) {
    const r = raw.get(s.account.id);
    accounts.set(s.account.id, r ? (r.wt * r.level + LEVEL_SHRINK * level) / (r.wt + LEVEL_SHRINK) : level);
  }
  return { level, trend, accounts, accountWeeks: n };
}
