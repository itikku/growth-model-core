// Account funnel: weekly transition probabilities, estimated as success / trial ratios (the MLE of a
// Markov chain), with each account shrunk toward the pooled rate.
import { ACT, NA, type PanelIndex } from './panel';
import type { FunnelKey, FunnelRates, Interval } from './types';

export const FUNNEL_KEYS: FunnelKey[] = ['activation', 'retention', 'atRisk', 'lapsed', 'dormant'];
const SHRINK = 8; // pseudo-trials pulling an account toward the pooled rate

/** Which funnel rate a transition out of `state` informs. */
export function rateFor(state: number): FunnelKey {
  if (state === NA) return 'activation';
  if (state === ACT) return 'retention';
  const k = state - 1;
  return k <= 3 ? 'atRisk' : k <= 11 ? 'lapsed' : 'dormant';
}

type Counts = Record<FunnelKey, [number, number]>; // [successes, trials]
const zero = (): Counts => ({ activation: [0, 0], retention: [0, 0], atRisk: [0, 0], lapsed: [0, 0], dormant: [0, 0] });

export function fitFunnel(ix: PanelIndex, window: number) {
  const from = ix.lastWeek - window; // transitions landing after this week
  const pooled = { window: zero(), all: zero() };
  const perAccount = new Map<string, { window: Counts; all: Counts }>();
  for (const s of ix.series) {
    const mine = { window: zero(), all: zero() };
    for (let i = 1; i < s.state.length; i++) {
      const key = rateFor(s.state[i - 1]);
      const hit = s.state[i] === ACT ? 1 : 0;
      for (const c of s.weeks[i] > from ? [mine.window, mine.all] : [mine.all]) {
        c[key][0] += hit;
        c[key][1]++;
      }
    }
    perAccount.set(s.account.id, mine);
    for (const k of FUNNEL_KEYS) {
      for (const scope of ['window', 'all'] as const) {
        pooled[scope][k][0] += mine[scope][k][0];
        pooled[scope][k][1] += mine[scope][k][1];
      }
    }
  }

  // Activation is rare, so it always pools every week; the others use the recent window when it has data.
  const pick = (c: { window: Counts; all: Counts }, k: FunnelKey) => (k !== 'activation' && c.window[k][1] > 0 ? c.window[k] : c.all[k]);
  const warnings: string[] = [];
  const global = {} as FunnelRates;
  const intervals = {} as Record<FunnelKey, Interval>;
  for (const k of FUNNEL_KEYS) {
    const [hits, n] = pick(pooled, k);
    if (n === 0) warnings.push(`No observed transitions for the ${k} rate; it is set to 0.`);
    global[k] = n ? hits / n : 0;
    intervals[k] = { value: global[k], ...wilson(hits, n), n };
  }
  const accounts = new Map<string, FunnelRates>();
  for (const [id, c] of perAccount) {
    const rates = {} as FunnelRates;
    for (const k of FUNNEL_KEYS) {
      const [hits, n] = pick(c, k);
      rates[k] = (hits + SHRINK * global[k]) / (n + SHRINK);
    }
    accounts.set(id, rates);
  }
  return { global, accounts, intervals, warnings };
}

/** Wilson score interval, 95%. */
export function wilson(hits: number, n: number): { lo: number; hi: number } {
  if (!n) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}
