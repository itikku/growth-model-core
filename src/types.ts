// The data contract and the model's parameters.
//
// Governing identity, exact for every account-week:
//   tokens = A (account active) × N (engaged users) × D (workflows per user) × K (tokens per workflow)
// A follows a weekly account funnel, N follows Bass diffusion inside the account,
// D follows a learning curve over each user's tenure, and K follows a damped trend.

/** One customer account. `seats` = users the product could reach there. */
export type SimAccount = {
  id: string;
  name?: string;
  seats: number;
  provisionedWeek: number; // first week the account could use the product
  segment?: string;
  theatre?: string; // e.g. AMER, EMEA, APAC
  country?: string;
  chains?: string[]; // groups the account belongs to (e.g. supply chains); may overlap
};

/** Weekly totals for one provisioned account. Active ⇔ workflows > 0. */
export type AccountWeekObs = { accountId: string; week: number; workflows: number; tokens: number };

/**
 * One engaged user in one week, with the workflows credited to them. Omit weeks they were not engaged.
 * `startedVia` (optional, on the week a person starts or restarts): what brought them in. When most starts carry
 * it, the model counts adoption from colleagues vs. outreach directly instead of inferring the split.
 */
export type EngineerWeekObs = { accountId: string; engineerId: string; week: number; credited: number; startedVia?: 'colleague' | 'outreach' };

/** Everything the model fits from. Weeks are consecutive integers. */
export type Panel = {
  firstWeek: number;
  lastWeek: number;
  accounts: SimAccount[];
  accountWeeks: AccountWeekObs[];
  engineerWeeks: EngineerWeekObs[];
};

/** Weekly probabilities of the account funnel. */
export type FunnelRates = {
  activation: number; // not yet active → first active week
  retention: number; // active → active next week
  atRisk: number; // 1–3 quiet weeks → active
  lapsed: number; // 4–11 quiet weeks → active
  dormant: number; // 12+ quiet weeks → active
};
export type FunnelKey = keyof FunnelRates;

export type GlobalParams = {
  arrivalsPerWeek: number; // new accounts provisioned per week
  arrivalSeats: number; // mean seats of a new account
  startTeam: number; // users engaged in an account's first active week (the pilot team)
  funnel: FunnelRates;
  p: number; // weekly adoption from outreach, per reachable non-user
  q: number; // weekly adoption from colleagues, per reachable non-user, scaled by the share already using it
  c: number; // weekly chance an engaged user stops
  ceiling: number; // share of seats that can be reached
  dMax: number; // workflows per user-week at full experience
  d0: number; // workflows per user-week in the first week
  lambda: number; // learning rate: experience gap closes by 1 − e^(−λ) each week
  kLevel: number; // ln(tokens per workflow), pooled, at the last week
  kTrend: number; // weekly change in ln(tokens per workflow)
  kDamping: number; // trend damping per forecast week (φ)
};

export type AccountParams = {
  id: string;
  seats: number;
  funnel: FunnelRates; // shrunk toward the global rates
  theta: number; // adoption multiplier vs. the global p and q
  c: number; // churn, shrunk toward the global c
  depthMult: number; // workflows multiplier vs. the global learning curve
  kLevel: number; // ln(tokens per workflow) at the last week
};

/** Where each account stands at the last observed week. */
export type AccountStart = {
  id: string;
  funnel: { kind: 'not_activated'; age: number } | { kind: 'active' } | { kind: 'inactive'; weeks: number };
  /** Engaged users at the last active week, by tenure (index = active weeks of experience, capped). */
  tenure: number[];
};

export type Interval = { value: number; lo: number; hi: number; n: number };

export type FitDiagnostics = {
  funnel: Record<FunnelKey, Interval>;
  bass: {
    pairs: number;
    adoptions: number;
    churns: number;
    pSE: number;
    qSE: number;
    corrPQ: number;
    ceilingIdentified: boolean;
    ceilingInterval: [number, number];
    ceilingCensored: boolean; // best fit at all seats, the top of the search: the true ceiling may be higher
    colleagueShare: number; // share of new users who started through a colleague
    colleagueShareInterval: [number, number]; // 95% range
    colleagueShareSource: 'labels' | 'inferred'; // counted from start labels, or inferred from adoption counts
  };
  depth: { cells: number; engineerWeeks: number; logLik: number };
  k: { accountWeeks: number };
  warnings: string[];
};

export type FitResult = {
  firstWeek: number;
  lastWeek: number;
  global: GlobalParams;
  accounts: AccountParams[];
  starts: AccountStart[];
  /** Depth multiplier by calendar week (the effect of everything that changed over time), 1 = recent level. */
  periodDepth: { week: number; m: number }[];
  diagnostics: FitDiagnostics;
};

export type FitOptions = {
  window?: number; // trailing weeks for funnel and Bass rates (default 12)
  kWindow?: number; // trailing weeks for tokens per workflow (default 8)
  arrivalWindow?: number; // trailing weeks for the arrival rate (default 26)
};

export const TENURE_CAP = 52;
