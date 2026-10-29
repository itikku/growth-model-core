// Deterministic forecast: expected values per account, summed over a scope.
// Each forecast week, per account:
//   funnel:  π ← π·P   (not active yet, active, quiet 1…12+ weeks)
//   people:  adopt = θ(p + q·N/M)(M − N)⁺;  n ← shift(n)·(1 − c) + adopt at tenure 0   (only in active weeks)
//   depth:   workflows = μ · Σ_τ E[n[τ]; active] · g(τ)
//   tokens:  workflows · K,  ln K = level + trend · φ(1 − φ^h)/(1 − φ)
// Users are tracked per funnel state, so activity and team size stay correlated as they are in the data.
// New accounts arrive at the fitted rate.
import { applyLever, type Levers } from './levers';
import { ACT, NA, QUIET_CAP, STATES, quiet } from './panel';
import { TENURE_CAP, type AccountParams, type AccountStart, type FitResult, type FunnelRates, type GlobalParams } from './types';
import { curve } from './fit-depth';

export const FORECAST_WEEKS = 26;

export type ForecastPoint = { week: number; tokens: number; workflows: number; engineers: number; activeAccounts: number };
export type ForecastOutput = { points: ForecastPoint[]; tokens: number; workflows: number };

type Run = {
  funnel: FunnelRates; theta: number; startTeam: number; p: number; q: number; c: number; m: number; mu: number;
  g: number[]; kLevel: number;
};

type Path = { workflows: number[]; engineers: number[]; active: number[] };

const emptyPath = (h: number): Path => ({ workflows: Array(h).fill(0), engineers: Array(h).fill(0), active: Array(h).fill(0) });

/** Weekly transition probabilities out of each funnel state: [to state, probability][]. */
function moves(f: FunnelRates): [number, number][][] {
  const out: [number, number][][] = Array.from({ length: STATES }, () => []);
  out[NA] = [[ACT, f.activation], [NA, 1 - f.activation]];
  out[ACT] = [[ACT, f.retention], [quiet(1), 1 - f.retention]];
  for (let k = 1; k <= QUIET_CAP; k++) {
    const back = k <= 3 ? f.atRisk : k <= 11 ? f.lapsed : f.dormant;
    out[quiet(k)] = [[ACT, back], [quiet(k + 1), 1 - back]];
  }
  return out;
}

/**
 * Path of one account, `h` weeks ahead, from a funnel state and its engaged users by tenure.
 * Users are tracked separately for each funnel state (J[s] = expected histogram × P(state s)),
 * because accounts that stay active also accumulate more users. Users grow only in active weeks;
 * a first activation brings the pilot team (fitted: users engaged in a first active week).
 */
function project(r: Run, state0: number, n0: readonly number[], h: number): Path {
  const B = TENURE_CAP + 1;
  const out = emptyPath(h);
  const mv = moves(r.funnel);
  let pi = new Float64Array(STATES);
  let pi2 = new Float64Array(STATES);
  let J = new Float64Array(STATES * B); // J[s·B + τ]
  let J2 = new Float64Array(STATES * B);
  pi[state0] = 1;
  for (let tau = 0; tau < B; tau++) J[state0 * B + tau] = n0[tau] ?? 0;
  for (let t = 0; t < h; t++) {
    pi2.fill(0);
    J2.fill(0);
    for (let s = 0; s < STATES; s++) {
      const ps = pi[s];
      if (ps <= 1e-15) continue;
      const base = s * B;
      for (const [to, pr] of mv[s]) {
        const mass = ps * pr;
        if (mass <= 0) continue;
        pi2[to] += mass;
        const dst = to * B;
        if (to !== ACT) {
          for (let tau = 0; tau < B; tau++) J2[dst + tau] += pr * J[base + tau]; // frozen while quiet
        } else if (s === NA) {
          J2[dst] += mass * r.startTeam; // first active week: the pilot team
        } else {
          // Bass step on this state's expected users (J / π = the conditional histogram).
          let total = 0;
          for (let tau = 0; tau < B; tau++) total += J[base + tau];
          total /= ps;
          const adopt = r.m > 0 ? r.theta * (r.p + (r.q * total) / r.m) * Math.max(0, r.m - total) : 0;
          J2[dst] += mass * adopt;
          const keep = pr * (1 - r.c);
          for (let tau = 0; tau < B; tau++) J2[dst + Math.min(TENURE_CAP, tau + 1)] += keep * J[base + tau];
        }
      }
    }
    [pi, pi2] = [pi2, pi];
    [J, J2] = [J2, J];
    let work = 0, people = 0;
    const a = ACT * B;
    for (let tau = 0; tau < B; tau++) {
      work += J[a + tau] * r.g[tau];
      people += J[a + tau];
    }
    out.workflows[t] = r.mu * work;
    out.engineers[t] = people;
    out.active[t] = pi[ACT];
  }
  return out;
}

function runFor(g: GlobalParams, a: AccountParams | null, seats: number, levers: Levers): Run {
  const f = a?.funnel ?? g.funnel;
  const dMax = applyLever.dMax(g.dMax, levers.dMax);
  const lambda = applyLever.lambda(g.lambda, levers.lambda);
  return {
    funnel: {
      activation: applyLever.activation(f.activation, levers.activation),
      retention: applyLever.retention(f.retention, levers.retention),
      atRisk: applyLever.recovery(f.atRisk, levers.recovery),
      lapsed: applyLever.recovery(f.lapsed, levers.recovery),
      dormant: applyLever.recovery(f.dormant, levers.recovery),
    },
    theta: a?.theta ?? 1,
    startTeam: g.startTeam,
    p: applyLever.p(g.p, levers.p),
    q: applyLever.q(g.q, levers.q),
    c: applyLever.c(a?.c ?? g.c, levers.c),
    m: applyLever.ceiling(g.ceiling * seats, levers.ceiling),
    mu: a?.depthMult ?? 1,
    g: Array.from({ length: TENURE_CAP + 1 }, (_, tau) => Math.max(0, curve(dMax, g.d0, lambda, tau))),
    kLevel: applyLever.k(a?.kLevel ?? g.kLevel, levers.k),
  };
}

const kAt = (g: GlobalParams, level: number, h: number) =>
  Math.exp(level + (g.kTrend * g.kDamping * (1 - Math.pow(g.kDamping, h))) / (1 - g.kDamping));

/**
 * Forecast the accounts in `accountIds`, plus `arrivalShare` of the fitted new-account arrivals.
 * `levers` are relative changes (0.1 = 10% better); omit them for the baseline.
 */
export function forecast(fit: FitResult, accountIds: readonly string[], arrivalShare: number, levers: Levers = {}, weeks = FORECAST_WEEKS): ForecastOutput {
  const g = fit.global;
  const points: ForecastPoint[] = Array.from({ length: weeks }, (_, t) => ({ week: fit.lastWeek + t + 1, tokens: 0, workflows: 0, engineers: 0, activeAccounts: 0 }));
  const add = (path: Path, level: number, scale = 1) => {
    for (let t = 0; t < weeks; t++) {
      const w = path.workflows[t] * scale;
      points[t].workflows += w;
      points[t].tokens += w * kAt(g, level, t + 1);
      points[t].engineers += path.engineers[t] * scale;
      points[t].activeAccounts += path.active[t] * scale;
    }
  };
  const params = new Map(fit.accounts.map((a) => [a.id, a]));
  const starts = new Map<string, AccountStart>(fit.starts.map((s) => [s.id, s]));
  for (const id of accountIds) {
    const a = params.get(id);
    const s = starts.get(id);
    if (!a || !s) continue;
    const r = runFor(g, a, a.seats, levers);
    const state = s.funnel.kind === 'not_activated' ? NA : s.funnel.kind === 'active' ? ACT : quiet(s.funnel.weeks);
    add(project(r, state, s.tenure, weeks), r.kLevel);
  }
  const rate = applyLever.arrivals(g.arrivalsPerWeek, levers.arrivals) * arrivalShare;
  if (rate > 0) {
    const r = runFor(g, null, g.arrivalSeats, levers);
    const one = project(r, NA, Array(TENURE_CAP + 1).fill(0), weeks); // one account, from the week after it is provisioned
    const arrivals = emptyPath(weeks);
    for (let j = 0; j < weeks; j++) {
      for (let t = j + 1; t < weeks; t++) {
        arrivals.workflows[t] += rate * one.workflows[t - j - 1];
        arrivals.engineers[t] += rate * one.engineers[t - j - 1];
        arrivals.active[t] += rate * one.active[t - j - 1];
      }
    }
    add(arrivals, r.kLevel);
  }
  return {
    points,
    tokens: points.reduce((x, p) => x + p.tokens, 0),
    workflows: points.reduce((x, p) => x + p.workflows, 0),
  };
}
