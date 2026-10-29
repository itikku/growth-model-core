// Turns a Panel into per-account timelines: funnel states, engaged users with tenure,
// and the adoption and churn events between consecutive active weeks.
import { TENURE_CAP, type Panel, type SimAccount } from './types';

/** Funnel states: 0 = not yet active, 1 = active, 1 + k = k quiet weeks (k = 1…12, 12 = 12 or more). */
export const NA = 0;
export const ACT = 1;
export const QUIET_CAP = 12;
export const STATES = 2 + QUIET_CAP; // 14
export const quiet = (k: number) => 1 + Math.min(QUIET_CAP, k);

/** One transition of the engaged set between two consecutive active weeks of an account. */
/** `colleague` / `outreach`: adoptions whose start was labeled (see EngineerWeekObs.startedVia). */
export type BassPair = { accountId: string; from: number; to: number; n: number; adoptions: number; churns: number; colleague: number; outreach: number };

/** One engaged user-week with that user's tenure (active weeks of experience in the current spell). */
export type TenureObs = { accountId: string; week: number; tenure: number; credited: number };

export type AccountSeries = {
  account: SimAccount;
  start: number; // first week in the panel for this account
  weeks: number[];
  workflows: number[];
  tokens: number[];
  active: boolean[];
  state: number[];
  engaged: number[]; // engaged users per week (0 when inactive)
  /** Engaged users by tenure at the last active week. */
  lastTenure: number[];
  firstActive: number | null;
  lastActive: number | null;
};

export type PanelIndex = {
  firstWeek: number;
  lastWeek: number;
  series: AccountSeries[];
  byId: Map<string, AccountSeries>;
  pairs: BassPair[];
  tenureObs: TenureObs[];
};

export function indexPanel(panel: Panel): PanelIndex {
  const weekly = new Map<string, Map<number, { workflows: number; tokens: number }>>();
  for (const r of panel.accountWeeks) {
    const m = weekly.get(r.accountId) ?? new Map();
    const prev = m.get(r.week);
    m.set(r.week, { workflows: (prev?.workflows ?? 0) + r.workflows, tokens: (prev?.tokens ?? 0) + r.tokens });
    weekly.set(r.accountId, m);
  }
  const engagedBy = new Map<string, Map<number, Map<string, number>>>();
  const startedVia = new Map<string, 'colleague' | 'outreach'>();
  for (const e of panel.engineerWeeks) {
    if (e.startedVia) startedVia.set(`${e.accountId}|${e.week}|${e.engineerId}`, e.startedVia);
    const byWeek = engagedBy.get(e.accountId) ?? new Map<number, Map<string, number>>();
    const set = byWeek.get(e.week) ?? new Map<string, number>();
    set.set(e.engineerId, (set.get(e.engineerId) ?? 0) + e.credited);
    byWeek.set(e.week, set);
    engagedBy.set(e.accountId, byWeek);
  }

  const series: AccountSeries[] = [];
  const pairs: BassPair[] = [];
  const tenureObs: TenureObs[] = [];
  for (const account of panel.accounts) {
    const start = Math.max(panel.firstWeek, account.provisionedWeek);
    if (start > panel.lastWeek) continue;
    const s: AccountSeries = {
      account, start, weeks: [], workflows: [], tokens: [], active: [], state: [], engaged: [],
      lastTenure: Array(TENURE_CAP + 1).fill(0), firstActive: null, lastActive: null,
    };
    const byWeek = engagedBy.get(account.id);
    let quietWeeks = 0;
    let tenure = new Map<string, number>();
    let prevActive: number | null = null;
    for (let w = start; w <= panel.lastWeek; w++) {
      const obs = weekly.get(account.id)?.get(w);
      const active = (obs?.workflows ?? 0) > 0;
      s.weeks.push(w);
      s.workflows.push(obs?.workflows ?? 0);
      s.tokens.push(obs?.tokens ?? 0);
      s.active.push(active);
      if (active) {
        quietWeeks = 0;
        s.state.push(ACT);
        const now = byWeek?.get(w) ?? new Map<string, number>();
        s.engaged.push(now.size);
        const next = new Map<string, number>();
        let adoptions = 0, colleague = 0, outreach = 0;
        for (const id of now.keys()) {
          const t = tenure.get(id);
          if (t === undefined) {
            adoptions++;
            const via = startedVia.get(`${account.id}|${w}|${id}`);
            if (via === 'colleague') colleague++;
            else if (via === 'outreach') outreach++;
          }
          next.set(id, t === undefined ? 0 : Math.min(TENURE_CAP, t + 1));
        }
        if (prevActive !== null) {
          let churns = 0;
          for (const id of tenure.keys()) if (!now.has(id)) churns++;
          pairs.push({ accountId: account.id, from: prevActive, to: w, n: tenure.size, adoptions, churns, colleague, outreach });
        }
        for (const [id, credited] of now) tenureObs.push({ accountId: account.id, week: w, tenure: next.get(id)!, credited });
        tenure = next;
        if (s.firstActive === null) s.firstActive = w;
        s.lastActive = w;
        prevActive = w;
      } else {
        s.engaged.push(0);
        if (s.firstActive === null) s.state.push(NA);
        else s.state.push(quiet(++quietWeeks));
      }
    }
    for (const t of tenure.values()) s.lastTenure[t]++;
    series.push(s);
  }
  return { firstWeek: panel.firstWeek, lastWeek: panel.lastWeek, series, byId: new Map(series.map((s) => [s.account.id, s])), pairs, tenureObs };
}
