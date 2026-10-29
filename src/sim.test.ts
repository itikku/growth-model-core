import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curve, fitDepth } from './fit-depth';
import { fitFunnel } from './fit-funnel';
import { forecast } from './forecast';
import { elasticities } from './impact';
import { applyLever, LEVERS } from './levers';
import { indexPanel } from './panel';
import { poissonEM } from './poisson-em';
import { simulatePanel, type WorldSpec } from './reference';
import { classifyStages } from './stage';
import { decompose } from './decompose';
import { resolveScope } from './scope';
import { fitModel } from './fit';
import { TENURE_CAP, type FitResult, type Panel } from './types';

const sizes = [...Array(12).fill(275), ...Array(18).fill(60), ...Array(10).fill(5), ...Array(8).fill(27)];
const TRUTH: WorldSpec = {
  firstWeek: -12, lastWeek: 25,
  accounts: sizes.map((seats, i) => ({ id: `a${i}`, seats, provisionedWeek: i % 3 === 0 ? -12 + (i % 20) : -12 })),
  funnel: { activation: 0.3, retention: 0.85, atRisk: 0.35, lapsed: 0.12, dormant: 0.05 },
  p: 0.004, q: 0.15, c: 0.05, ceiling: 0.8, dMax: 2.5, d0: 0.2, lambda: 0.15, kLevel: Math.log(12000), kTrend: 0.02,
};
const near = (x: number, truth: number, rel: number) => expect(Math.abs(x / truth - 1)).toBeLessThan(rel);

describe('estimators are exact on noiseless data', () => {
  it('Poisson EM recovers identity-link coefficients', () => {
    const x = Array.from({ length: 60 }, (_, j) => [1 + (j % 7), (j % 5) * 0.3 + 0.1]);
    const y = x.map(([a, b]) => 0.02 * a + 0.4 * b);
    const fit = poissonEM(y, x, [1, 1], 5000, 1e-14);
    near(fit.beta[0], 0.02, 1e-4);
    near(fit.beta[1], 0.4, 1e-4);
  });

  it('the learning curve recovers Dmax, D0, and λ', () => {
    const obs = [];
    for (let tau = 0; tau <= 30; tau++) for (let w = 0; w < 4; w++) obs.push({ accountId: 'a', week: w, tenure: tau, credited: 20 * curve(3, 0.5, 0.2, tau) });
    const ix = { firstWeek: 0, lastWeek: 3, series: [{ account: { id: 'a', seats: 50, provisionedWeek: 0 } }], byId: new Map(), pairs: [], tenureObs: obs };
    // Each cell holds 20 user-weeks' worth of credit in one observation; scale back.
    const fit = fitDepth(ix as never);
    near(fit.dMax / 20, 3, 1e-3);
    near(fit.d0 / 20, 0.5, 1e-3);
    near(fit.lambda, 0.2, 1e-3);
  });

  it('funnel rates are success / trial ratios, and short histories shrink toward the pool', () => {
    // Account x: active, active, quiet, active. Account y: active for 20 weeks.
    const accountWeeks = [
      ...[0, 1, 3].map((week) => ({ accountId: 'x', week, workflows: 1, tokens: 1 })),
      ...Array.from({ length: 20 }, (_, week) => ({ accountId: 'y', week, workflows: 1, tokens: 1 })),
    ];
    const panel: Panel = { firstWeek: 0, lastWeek: 19, accounts: [{ id: 'x', seats: 5, provisionedWeek: 0 }, { id: 'y', seats: 5, provisionedWeek: 0 }], accountWeeks, engineerWeeks: [] };
    const f = fitFunnel(indexPanel(panel), 40);
    // Retention: x 1/2 (then quiet weeks onward), y 19/19 → (1 + 19) / (2 + 19) after x's later weeks; x stays quiet after week 3.
    const xs = indexPanel(panel).byId.get('x')!;
    expect(xs.state.slice(0, 5)).toEqual([1, 1, 2, 1, 2]);
    expect(f.global.retention).toBeCloseTo((1 + 0 + 19) / (2 + 1 + 19), 10);
    expect(f.accounts.get('x')!.retention).toBeGreaterThan(1 / 3);
    expect(f.accounts.get('x')!.retention).toBeLessThan(f.global.retention);
  });
});

describe('fitting recovers known parameters from simulated users', () => {
  const fits = [1, 2, 3, 4, 5].map((s) => fitModel(simulatePanel(TRUTH, `rt${s}`), { window: 40 }));
  const mean = (f: (r: FitResult) => number) => fits.reduce((a, r) => a + f(r), 0) / fits.length;

  // Tolerances are at least 3 standard deviations plus bias, measured over 20 seeds. D0 runs ~11% high
  // because an active week always has at least one workflow; λ runs ~5% low.
  it('recovers each parameter in every seed, loosely', () => {
    for (const { global: g } of fits) {
      near(g.p, TRUTH.p, 0.45);
      near(g.q, TRUTH.q, 0.2);
      near(g.c, TRUTH.c, 0.16);
      near(g.dMax, TRUTH.dMax, 0.11);
      near(g.d0, TRUTH.d0, 0.3);
      near(g.lambda, TRUTH.lambda, 0.22);
      expect(Math.abs(g.funnel.retention - TRUTH.funnel.retention)).toBeLessThan(0.05);
      expect(Math.abs(g.funnel.activation - TRUTH.funnel.activation)).toBeLessThan(0.12);
      expect(Math.abs(g.ceiling - TRUTH.ceiling)).toBeLessThan(0.2);
      expect(Math.abs(g.kTrend - TRUTH.kTrend)).toBeLessThan(0.02);
    }
  });

  it('recovers each parameter on average, tightly', () => {
    near(mean((r) => r.global.p), TRUTH.p, 0.25);
    near(mean((r) => r.global.q), TRUTH.q, 0.08);
    near(mean((r) => r.global.c), TRUTH.c, 0.09);
    near(mean((r) => r.global.dMax), TRUTH.dMax, 0.06);
    near(mean((r) => r.global.lambda), TRUTH.lambda, 0.12);
  });

  it('counts the colleague share directly, and pins down p and q, when starts are labeled', () => {
    for (const seed of ['lab1', 'lab2', 'lab3']) {
      const f = fitModel(simulatePanel({ ...TRUTH, labelStarts: true }, seed), { window: 40 });
      expect(f.diagnostics.bass.colleagueShareSource).toBe('labels');
      expect(f.diagnostics.bass.corrPQ).toBe(0);
      near(f.global.p, TRUTH.p, 0.25);
      near(f.global.q, TRUTH.q, 0.12);
      const [lo, hi] = f.diagnostics.bass.colleagueShareInterval;
      expect(lo).toBeLessThanOrEqual(f.diagnostics.bass.colleagueShare);
      expect(hi).toBeGreaterThanOrEqual(f.diagnostics.bass.colleagueShare);
      expect(hi - lo).toBeLessThan(0.15);
    }
  });

  it('attributes most adoptions to colleagues when q dominates', () => {
    for (const f of fits) expect(f.diagnostics.bass.colleagueShare).toBeGreaterThan(0.5);
  });
});

/** A fit built straight from the truth, with every account about to be provisioned. */
function truthFit(spec: WorldSpec): FitResult {
  return {
    firstWeek: 0, lastWeek: 0,
    global: { arrivalsPerWeek: 0, arrivalSeats: 0, startTeam: 1, funnel: spec.funnel, p: spec.p, q: spec.q, c: spec.c, ceiling: spec.ceiling, dMax: spec.dMax, d0: spec.d0, lambda: spec.lambda, kLevel: spec.kLevel, kTrend: 0, kDamping: 0.8 },
    accounts: spec.accounts.map((a) => ({ id: a.id, seats: a.seats, funnel: spec.funnel, theta: 1, c: spec.c, depthMult: 1, kLevel: spec.kLevel })),
    starts: spec.accounts.map((a) => ({ id: a.id, funnel: { kind: 'not_activated', age: 0 }, tenure: Array(TENURE_CAP + 1).fill(0) })),
    periodDepth: [],
    diagnostics: {} as never,
  };
}

describe('forecast', () => {
  // d0 = 1: a new user already runs about one workflow a week, so the data's "an active week has a workflow" floor rarely binds.
  const spec: WorldSpec = { ...TRUTH, d0: 1, firstWeek: 1, lastWeek: 26, kTrend: 0, tokenNoise: 0, accounts: TRUTH.accounts.map((a) => ({ ...a, provisionedWeek: 1 })) };
  const fit = truthFit(spec);
  const ids = spec.accounts.map((a) => a.id);

  it('matches the mean of many stochastic runs (the mean-field approximation is close)', () => {
    const base = forecast(fit, ids, 0);
    const runs = 120;
    let tokens = 0, workflows = 0;
    for (let s = 0; s < runs; s++) {
      const p = simulatePanel(spec, `mc${s}`);
      for (const r of p.accountWeeks) {
        tokens += r.tokens / runs;
        workflows += r.workflows / runs;
      }
    }
    near(base.workflows, workflows, 0.1);
    near(base.tokens, tokens, 0.1);
  });

  it('conserves accounts, stays within reach, and is deterministic', () => {
    const f = forecast(fit, ids, 0);
    const reach = spec.accounts.reduce((a, x) => a + spec.ceiling * x.seats, 0);
    for (const p of f.points) {
      expect(p.activeAccounts).toBeLessThanOrEqual(ids.length + 1e-9);
      expect(p.engineers).toBeLessThanOrEqual(reach + 1e-9);
      for (const v of [p.tokens, p.workflows, p.engineers, p.activeAccounts]) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(forecast(fit, ids, 0)).toEqual(f);
  });

  it('never loses output from a 10% improvement, and tokens per workflow scales tokens exactly', () => {
    const e = elasticities(fit, ids, 0);
    for (const r of e) expect(r.tokens).toBeGreaterThanOrEqual(-1e-9);
    const k = e.find((r) => r.lever === 'k')!;
    expect(k.tokens).toBeCloseTo(1, 6);
    expect(k.workflows).toBeCloseTo(0, 9);
    expect(e.map((r) => r.lever).sort()).toEqual(LEVERS.map((l) => l.id).sort());
  });

  it('ranks levers by where the account stands', () => {
    // Not active yet, and slow to start: activation matters far more than keeping or winning back accounts.
    const slow = truthFit({ ...spec, funnel: { ...spec.funnel, activation: 0.03 } });
    const fresh = Object.fromEntries(elasticities(slow, ['a0'], 0).map((r) => [r.lever, r.tokens]));
    expect(fresh.activation).toBeGreaterThan(3 * fresh.retention);
    expect(fresh.activation).toBeGreaterThan(3 * fresh.recovery);
    // Saturated: users already fill the reachable seats, so more reach beats more outreach.
    const full = truthFit({ ...spec, accounts: [{ id: 'z', seats: 100, provisionedWeek: 1 }] });
    full.starts = [{ id: 'z', funnel: { kind: 'active' }, tenure: Object.assign(Array(TENURE_CAP + 1).fill(0), { 20: 78 }) }];
    const sat = Object.fromEntries(elasticities(full, ['z'], 0).map((r) => [r.lever, r.tokens]));
    expect(sat.ceiling).toBeGreaterThan(sat.p);
    expect(sat.activation).toBeCloseTo(0, 6);
  });

  it('runs elasticities for 48 accounts plus arrivals fast enough for a browser', () => {
    const f = { ...fit, global: { ...fit.global, arrivalsPerWeek: 1, arrivalSeats: 60 } };
    // Fastest of three runs, so other test files running in parallel do not make this flaky.
    const times = [0, 1, 2].map(() => {
      const t0 = performance.now();
      elasticities(f, ids, 1);
      return performance.now() - t0;
    });
    expect(Math.min(...times)).toBeLessThan(250);
  });
});

describe('stages and growth decomposition', () => {
  const panel = simulatePanel(TRUTH, 'stages');
  const ix = indexPanel(panel);
  const fit = fitModel(panel, { window: 40 });

  it('puts every account in exactly one stage, and each rule fires on a matching account', () => {
    const extra: Panel = {
      ...panel,
      accounts: [...panel.accounts, { id: 'new', seats: 10, provisionedWeek: 22 }, { id: 'old', seats: 10, provisionedWeek: -12 }],
    };
    const stages = classifyStages(indexPanel(extra), fitModel(extra, { window: 40 }));
    expect(stages.size).toBe(extra.accounts.length);
    expect(stages.get('new')!.stage).toBe('nascent');
    expect(stages.get('old')!.stage).toBe('stalled');
    const seen = new Set([...stages.values()].map((s) => s.stage));
    expect(seen.has('compounding') || seen.has('linear')).toBe(true);
  });

  it('splits log growth exactly into accounts, people, depth, and tokens per workflow', () => {
    const d = decompose(ix, panel.accounts.map((a) => a.id), [0, 1, 2], [23, 24, 25]);
    const sum = d.log10.accounts + d.log10.people + d.log10.depth + d.log10.intensity;
    expect(sum).toBeCloseTo(d.log10.tokens, 9);
    expect(d.start.accounts * d.start.people * d.start.depth * d.start.intensity).toBeCloseTo(d.start.tokens, 6);
    expect(fit.global.q).toBeGreaterThan(0);
  });
});

describe('levers', () => {
  it('a worse dial lowers a rate smoothly and never to zero', () => {
    // Activation fails 81% of the time: "25% worse" must not push failures past 100%.
    expect(applyLever.activation(0.188, -0.25)).toBeCloseTo(0.141, 3);
    expect(applyLever.activation(0.188, -0.5)).toBeCloseTo(0.094, 3);
    // A high rate keeps the failure reading: retention 93.6% at 50% worse = 50% more failures.
    expect(applyLever.retention(0.936, -0.5)).toBeCloseTo(0.904, 3);
    for (const v of [0.05, 0.188, 0.5, 0.936]) {
      const ys = [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1].map((x) => applyLever.activation(v, x));
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
      expect(ys[0]).toBeGreaterThan(0);
    }
  });
});

describe('scope', () => {
  const accounts = ['a', 'b', 'c', 'd'].map((id) => ({ id, seats: 10, provisionedWeek: 0 }));
  const stages = new Map(Object.entries({ a: 'nascent', b: 'stalled', c: 'linear', d: 'compounding' } as const)
    .map(([id, stage]) => [id, { stage, reason: '', weeklyGrowth: null, reproduction: null }]));

  it('keeps every account in any of the picked stages, and all accounts when none are picked', () => {
    expect(resolveScope(accounts, stages, { stages: ['stalled', 'linear'] }).accountIds).toEqual(['b', 'c']);
    expect(resolveScope(accounts, stages, { stages: [] }).accountIds).toEqual(['a', 'b', 'c', 'd']);
    expect(resolveScope(accounts, stages, {}).accountIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('counts new accounts only when the picked stages include nascent', () => {
    expect(resolveScope(accounts, stages, { stages: ['stalled', 'linear'] }).arrivalShare).toBe(0);
    expect(resolveScope(accounts, stages, { stages: ['nascent', 'stalled'] }).arrivalShare).toBe(1);
  });
});

describe('package boundary', () => {
  it('imports nothing outside src/sim', () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1];
        expect(spec.startsWith('./'), `${f} imports ${spec}`).toBe(true);
      }
    }
  });
});
