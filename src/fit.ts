// Fits every model part from a Panel. Uses only the panel: no hidden truth.
import { fitBass } from './fit-bass';
import { fitDepth } from './fit-depth';
import { fitFunnel } from './fit-funnel';
import { fitK, K_DAMPING } from './fit-k';
import { ACT, NA, indexPanel, type PanelIndex } from './panel';
import type { AccountParams, AccountStart, FitOptions, FitResult, Panel } from './types';

export function fitModel(panel: Panel, opts: FitOptions = {}): FitResult {
  return fitIndexed(indexPanel(panel), opts);
}

export function fitIndexed(ix: PanelIndex, opts: FitOptions = {}): FitResult {
  const window = opts.window ?? 12;
  const funnel = fitFunnel(ix, window);
  const bass = fitBass(ix, window);
  const depth = fitDepth(ix);
  const k = fitK(ix, opts.kWindow ?? 8);

  const span = Math.max(1, Math.min(opts.arrivalWindow ?? 26, ix.lastWeek - ix.firstWeek));
  const arrived = ix.series.filter((s) => s.account.provisionedWeek > ix.lastWeek - span && s.account.provisionedWeek > ix.firstWeek);
  const seatPool = arrived.length ? arrived : ix.series;
  const arrivalSeats = seatPool.reduce((a, s) => a + s.account.seats, 0) / Math.max(1, seatPool.length);

  // Pilot team: users engaged in the first active week, for accounts whose start we observed.
  const firsts = ix.series.filter((s) => s.firstActive !== null && s.firstActive > ix.firstWeek).map((s) => s.engaged[s.weeks.indexOf(s.firstActive!)]);
  const startTeam = firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : 1;

  const accounts: AccountParams[] = ix.series.map((s) => ({
    id: s.account.id,
    seats: s.account.seats,
    funnel: funnel.accounts.get(s.account.id)!,
    theta: bass.theta.get(s.account.id) ?? 1,
    c: bass.churn.get(s.account.id) ?? bass.c,
    depthMult: depth.mu.get(s.account.id) ?? 1,
    kLevel: k.accounts.get(s.account.id) ?? k.level,
  }));
  const starts: AccountStart[] = ix.series.map((s) => {
    const state = s.state[s.state.length - 1];
    return {
      id: s.account.id,
      funnel: state === NA ? { kind: 'not_activated', age: s.weeks.length } : state === ACT ? { kind: 'active' } : { kind: 'inactive', weeks: state - 1 },
      tenure: s.lastTenure,
    };
  });

  return {
    firstWeek: ix.firstWeek,
    lastWeek: ix.lastWeek,
    global: {
      arrivalsPerWeek: arrived.length / span,
      arrivalSeats,
      startTeam,
      funnel: funnel.global,
      p: bass.p, q: bass.q, c: bass.c, ceiling: bass.ceiling,
      dMax: depth.dMax, d0: depth.d0, lambda: depth.lambda,
      kLevel: k.level, kTrend: k.trend, kDamping: K_DAMPING,
    },
    accounts,
    starts,
    periodDepth: [...depth.m.entries()].sort((a, b) => a[0] - b[0]).map(([week, m]) => ({ week, m })),
    diagnostics: {
      funnel: funnel.intervals,
      bass: {
        pairs: bass.pairs, adoptions: bass.adoptions, churns: bass.churns, pSE: bass.pSE, qSE: bass.qSE, corrPQ: bass.corrPQ,
        ceilingIdentified: bass.ceilingIdentified, ceilingInterval: bass.ceilingInterval, ceilingCensored: bass.ceilingCensored, colleagueShare: bass.colleagueShare,
        colleagueShareInterval: bass.colleagueShareInterval, colleagueShareSource: bass.colleagueShareSource,
      },
      depth: { cells: depth.cells, engineerWeeks: depth.engineerWeeks, logLik: depth.logLik },
      k: { accountWeeks: k.accountWeeks },
      warnings: [...funnel.warnings, ...bass.warnings, ...depth.warnings],
    },
  };
}
