// Depth: workflows credited to an engaged user in a week.
//   E[credited] = μ_i · m_t · g(τ),   g(τ) = Dmax − (Dmax − D0) · e^(−λτ)
// τ = the user's tenure (active weeks of experience), μ_i = account multiplier,
// m_t = calendar-week multiplier (launches, seasons), normalized to 1 over the last 4 weeks.
// Fit by block-coordinate ascent on the Poisson likelihood.
import type { PanelIndex } from './panel';
import { poissonEM, poissonLogLik } from './poisson-em';
import { TENURE_CAP } from './types';

const ROUNDS = 20;
const MU_SHRINK = 20; // pseudo-workflows pulling an account toward the pool
const LAMBDA_GRID = Array.from({ length: 40 }, (_, i) => 0.01 * Math.pow(300, i / 39)); // 0.01 … 3

export type DepthFit = {
  dMax: number; d0: number; lambda: number;
  mu: Map<string, number>; m: Map<number, number>;
  logLik: number; cells: number; engineerWeeks: number; warnings: string[];
};

export const curve = (dMax: number, d0: number, lambda: number, tau: number) => dMax - (dMax - d0) * Math.exp(-lambda * tau);

export function fitDepth(ix: PanelIndex): DepthFit {
  const warnings: string[] = [];
  // Cells (account, week, tenure) with total credited Y and user-weeks n.
  const key = (a: string, w: number, t: number) => `${a}|${w}|${t}`;
  const cellMap = new Map<string, { a: string; w: number; t: number; y: number; n: number }>();
  for (const o of ix.tenureObs) {
    const t = Math.min(TENURE_CAP, o.tenure);
    const k = key(o.accountId, o.week, t);
    const c = cellMap.get(k) ?? { a: o.accountId, w: o.week, t, y: 0, n: 0 };
    c.y += o.credited;
    c.n++;
    cellMap.set(k, c);
  }
  const cells = [...cellMap.values()];
  const mu = new Map<string, number>(ix.series.map((s) => [s.account.id, 1]));
  const m = new Map<number, number>();
  for (const c of cells) m.set(c.w, 1);
  if (!cells.length) {
    warnings.push('No engaged user-weeks; depth cannot be fit.');
    return { dMax: 0, d0: 0, lambda: 0.3, mu, m, logLik: 0, cells: 0, engineerWeeks: 0, warnings };
  }
  if (cells.every((c) => c.t === 0)) warnings.push('No user stayed engaged twice; the learning rate is a placeholder.');

  let dMax = 1, d0 = 1, lambda = 0.3;
  const g = (t: number) => curve(dMax, d0, lambda, t);
  for (let round = 0; round < ROUNDS; round++) {
    // (a) Curve given μ and m: sufficient statistics by tenure.
    const yT = Array(TENURE_CAP + 1).fill(0);
    const wT = Array(TENURE_CAP + 1).fill(0);
    for (const c of cells) {
      yT[c.t] += c.y;
      wT[c.t] += c.n * mu.get(c.a)! * m.get(c.w)!;
    }
    const fitAt = (lam: number) => {
      const x = wT.map((w, t) => [w * (1 - Math.exp(-lam * t)), w * Math.exp(-lam * t)]);
      const f = poissonEM(yT, x, [Math.max(dMax, 1e-3), Math.max(d0, 1e-3)], 300, 1e-10);
      return { lam, dMax: f.beta[0], d0: f.beta[1], ll: f.logLik };
    };
    let best = LAMBDA_GRID.map(fitAt).reduce((a, b) => (b.ll > a.ll ? b : a));
    // Golden-section refinement on log λ between the neighbouring grid points.
    let lo = Math.log(best.lam / 1.16), hi = Math.log(best.lam * 1.16);
    const phi = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 30; i++) {
      const x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
      if (fitAt(Math.exp(x1)).ll > fitAt(Math.exp(x2)).ll) hi = x2;
      else lo = x1;
    }
    const refined = fitAt(Math.exp((lo + hi) / 2));
    if (refined.ll > best.ll) best = refined;
    ({ dMax, d0 } = best);
    lambda = best.lam;

    // (b) Calendar multipliers given the curve and μ.
    const yW = new Map<number, number>(), eW = new Map<number, number>();
    for (const c of cells) {
      yW.set(c.w, (yW.get(c.w) ?? 0) + c.y);
      eW.set(c.w, (eW.get(c.w) ?? 0) + c.n * mu.get(c.a)! * g(c.t));
    }
    for (const w of m.keys()) m.set(w, eW.get(w)! > 0 ? yW.get(w)! / eW.get(w)! : 1);

    // (c) Account multipliers given the curve and m, shrunk toward 1.
    const yA = new Map<string, number>(), eA = new Map<string, number>();
    for (const c of cells) {
      yA.set(c.a, (yA.get(c.a) ?? 0) + c.y);
      eA.set(c.a, (eA.get(c.a) ?? 0) + c.n * m.get(c.w)! * g(c.t));
    }
    let wsum = 0, wmu = 0;
    for (const id of mu.keys()) {
      const v = ((yA.get(id) ?? 0) + MU_SHRINK) / ((eA.get(id) ?? 0) + MU_SHRINK);
      mu.set(id, v);
      wsum += eA.get(id) ?? 0;
      wmu += (eA.get(id) ?? 0) * v;
    }
    // Normalize: μ averages 1 (weighted), m averages 1 over the last 4 weeks with data. The curve absorbs both.
    const muMean = wsum > 0 ? wmu / wsum : 1;
    for (const [id, v] of mu) mu.set(id, v / muMean);
    const recent = [...m.keys()].sort((a, b) => b - a).slice(0, 4);
    const mMean = recent.reduce((a, w) => a + m.get(w)!, 0) / recent.length || 1;
    for (const [w, v] of m) m.set(w, v / mMean);
    dMax *= muMean * mMean;
    d0 *= muMean * mMean;
  }

  if (lambda <= LAMBDA_GRID[0] * 1.2 || lambda >= LAMBDA_GRID[LAMBDA_GRID.length - 1] / 1.2) {
    warnings.push(`The learning rate sits at the edge of its range (${lambda.toFixed(3)}); usage barely follows tenure, so read Dmax and λ together.`);
  }
  const y = cells.map((c) => c.y);
  const x = cells.map((c) => {
    const w = c.n * mu.get(c.a)! * m.get(c.w)!;
    return [w * (1 - Math.exp(-lambda * c.t)), w * Math.exp(-lambda * c.t)];
  });
  return {
    dMax, d0, lambda, mu, m, logLik: poissonLogLik(y, x, [dMax, d0]),
    cells: cells.length, engineerWeeks: cells.reduce((a, c) => a + c.n, 0), warnings,
  };
}
