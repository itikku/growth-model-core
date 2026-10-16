// Engineers inside an account follow discrete Bass diffusion with churn:
//   expected adoptions between active weeks = θ_i · (p + q · N/M) · (M − N),   M = ceiling · seats
//   expected churn                           = c_i · N
// p: adoption from outreach. q: adoption from colleagues. Fit (p, q) by Poisson EM, the ceiling by
// profile likelihood, c as a ratio, and θ_i, c_i with Poisson–gamma shrinkage toward the pool.
import type { BassPair, PanelIndex } from './panel';
import { wilson } from './fit-funnel';
import { poissonEM, rate } from './poisson-em';

const THETA_SHRINK = 5; // pseudo-adoptions
const CHURN_SHRINK = 5; // pseudo-churns
const CEILING_STEP = 0.05;

export type BassFit = {
  p: number; q: number; c: number; ceiling: number;
  theta: Map<string, number>; churn: Map<string, number>;
  pSE: number; qSE: number; corrPQ: number;
  ceilingIdentified: boolean; ceilingInterval: [number, number];
  /** The best fit sits on the top of the search (all seats): the true ceiling may be higher. */
  ceilingCensored: boolean;
  colleagueShare: number; colleagueShareInterval: [number, number]; colleagueShareSource: 'labels' | 'inferred';
  pairs: number; adoptions: number; churns: number;
  warnings: string[];
};

type Row = { pair: BassPair; a: number; b: number };

function design(pairs: BassPair[], seats: Map<string, number>, ceiling: number): Row[] {
  const rows: Row[] = [];
  for (const pair of pairs) {
    const m = ceiling * (seats.get(pair.accountId) ?? 0);
    const room = m - pair.n;
    if (room <= 0 || m <= 0) continue;
    rows.push({ pair, a: room, b: (pair.n / m) * room });
  }
  return rows;
}

/**
 * Without start labels: one Poisson count per pair, E = p·a + q·b, fit by EM.
 * With labels: outreach starts ~ Poisson(p·a) and colleague starts ~ Poisson(q·b) separately, so
 * p and q have closed forms. Unlabeled starts are split in the labeled proportion.
 */
function fitPQ(rows: Row[], labeled: boolean) {
  if (labeled) {
    let col = 0, out = 0, all = 0, sa = 0, sb = 0;
    for (const r of rows) {
      col += r.pair.colleague;
      out += r.pair.outreach;
      all += r.pair.adoptions;
      sa += r.a;
      sb += r.b;
    }
    const scale = col + out > 0 ? all / (col + out) : 1;
    const p = sa > 0 ? (out * scale) / sa : 0, q = sb > 0 ? (col * scale) / sb : 0;
    let ll = 0;
    for (const r of rows) {
      const lp = p * r.a, lq = q * r.b;
      ll += (lp > 0 ? r.pair.outreach * Math.log(lp) : 0) - lp + (lq > 0 ? r.pair.colleague * Math.log(lq) : 0) - lq;
    }
    return { p, q, logLik: ll };
  }
  const y = rows.map((r) => r.pair.adoptions);
  const x = rows.map((r) => [r.a, r.b]);
  const fit = poissonEM(y, x, [1e-3, 1e-2]);
  return { p: fit.beta[0], q: fit.beta[1], logLik: fit.logLik };
}

export function fitBass(ix: PanelIndex, window: number): BassFit {
  const warnings: string[] = [];
  const recent = ix.pairs.filter((p) => p.to > ix.lastWeek - window);
  const pairs = recent.reduce((a, p) => a + p.adoptions, 0) >= 30 ? recent : ix.pairs;
  if (pairs !== recent) warnings.push('Too few recent adoptions; the Bass fit uses every week.');
  const seats = new Map(ix.series.map((s) => [s.account.id, s.account.seats]));
  const total = pairs.reduce((a, p) => a + p.adoptions, 0);
  const tagged = pairs.reduce((a, p) => a + p.colleague + p.outreach, 0);
  const labeled = total > 0 && tagged / total >= 0.8;

  // The ceiling must leave room for every engineer observed engaged.
  let minCeiling = CEILING_STEP;
  for (const s of ix.series) for (const n of s.engaged) minCeiling = Math.max(minCeiling, n / Math.max(1, s.account.seats));
  const grid: number[] = [];
  for (let s = Math.min(1, Math.ceil(minCeiling / CEILING_STEP) * CEILING_STEP); s <= 1 + 1e-9; s += CEILING_STEP) grid.push(Math.round(s * 100) / 100);
  if (!grid.length) grid.push(1);
  const profile = grid.map((ceiling) => ({ ceiling, ...fitPQ(design(pairs, seats, ceiling), labeled) }));
  const best = profile.reduce((a, b) => (b.logLik > a.logLik ? b : a));
  const inside = profile.filter((r) => best.logLik - r.logLik <= 1.92).map((r) => r.ceiling);
  const interval: [number, number] = [Math.min(...inside), Math.max(...inside)];
  const censored = grid.length > 1 && best.ceiling >= grid[grid.length - 1] - 1e-9;
  const identified = !censored && interval[1] - interval[0] <= 0.3;
  if (censored) warnings.push('The best ceiling is all seats, the top of the search, so the true ceiling may be higher.');
  else if (!identified) warnings.push('The data do not pin down the ceiling; it is set to all seats, so ceiling effects are an upper bound.');
  const chosen = identified ? best : profile[profile.length - 1];
  const ceiling = chosen.ceiling;
  const rows = design(pairs, seats, ceiling);
  const { p, q } = chosen;

  // Fisher information of (p, q): Σ [a², ab; ab, b²] / λ.
  let iaa = 0, iab = 0, ibb = 0;
  let fromColleagues = 0, adoptions = 0;
  const expected = new Map<string, number>();
  for (const r of rows) {
    const lam = rate([p, q], [r.a, r.b]);
    if (lam > 0) {
      iaa += (r.a * r.a) / lam;
      iab += (r.a * r.b) / lam;
      ibb += (r.b * r.b) / lam;
      fromColleagues += (r.pair.adoptions * q * r.b) / lam;
    }
    adoptions += r.pair.adoptions;
    expected.set(r.pair.accountId, (expected.get(r.pair.accountId) ?? 0) + lam);
  }
  let pSE: number, qSE: number, corrPQ: number;
  let colleagueShare: number, colleagueShareInterval: [number, number];
  if (labeled) {
    // Separate Poisson counts: independent estimates, and the share is counted, not inferred.
    const sa = rows.reduce((x, r) => x + r.a, 0), sb = rows.reduce((x, r) => x + r.b, 0);
    pSE = sa > 0 ? Math.sqrt(p / sa) : NaN;
    qSE = sb > 0 ? Math.sqrt(q / sb) : NaN;
    corrPQ = 0;
    const col = rows.reduce((x, r) => x + r.pair.colleague, 0), out = rows.reduce((x, r) => x + r.pair.outreach, 0);
    colleagueShare = col + out > 0 ? col / (col + out) : 0;
    const w = wilson(col, col + out);
    colleagueShareInterval = [w.lo, w.hi];
  } else {
    const det = iaa * ibb - iab * iab;
    pSE = det > 0 ? Math.sqrt(ibb / det) : NaN;
    qSE = det > 0 ? Math.sqrt(iaa / det) : NaN;
    corrPQ = det > 0 ? -iab / Math.sqrt(iaa * ibb) : NaN;
    if (Math.abs(corrPQ) > 0.9) warnings.push('Outreach (p) and colleague (q) effects are hard to separate in these data; read them together, or record how each person started.');
    colleagueShare = adoptions ? fromColleagues / adoptions : 0;
    // Range: the share implied by p and q at ±2 standard errors, holding the other at its estimate.
    const shareAt = (pp: number, qq: number) => {
      let c = 0, all = 0;
      for (const r of rows) {
        const lam = pp * r.a + qq * r.b;
        if (lam > 0) { c += (r.pair.adoptions * qq * r.b) / lam; all += r.pair.adoptions; }
      }
      return all ? c / all : 0;
    };
    const lo = shareAt(p + 2 * (pSE || 0), Math.max(0, q - 2 * (qSE || 0)));
    const hi = shareAt(Math.max(0, p - 2 * (pSE || 0)), q + 2 * (qSE || 0));
    colleagueShareInterval = [Math.min(lo, colleagueShare), Math.max(hi, colleagueShare)];
  }

  const totals = new Map<string, { a: number; churn: number; n: number }>();
  let churns = 0, exposure = 0;
  for (const pair of pairs) {
    const t = totals.get(pair.accountId) ?? { a: 0, churn: 0, n: 0 };
    t.a += pair.adoptions;
    t.churn += pair.churns;
    t.n += pair.n;
    totals.set(pair.accountId, t);
    churns += pair.churns;
    exposure += pair.n;
  }
  const c = exposure ? churns / exposure : 0;
  const theta = new Map<string, number>();
  const churn = new Map<string, number>();
  for (const s of ix.series) {
    const t = totals.get(s.account.id);
    const e = expected.get(s.account.id) ?? 0;
    theta.set(s.account.id, ((t?.a ?? 0) + THETA_SHRINK) / (e + THETA_SHRINK));
    churn.set(s.account.id, c > 0 ? (c * ((t?.churn ?? 0) + CHURN_SHRINK)) / (c * (t?.n ?? 0) + CHURN_SHRINK) : 0);
  }
  return {
    p, q, c, ceiling, theta, churn, pSE, qSE, corrPQ, ceilingIdentified: identified, ceilingInterval: interval, ceilingCensored: censored,
    colleagueShare, colleagueShareInterval, colleagueShareSource: labeled ? 'labels' : 'inferred', pairs: rows.length, adoptions, churns, warnings,
  };
}
