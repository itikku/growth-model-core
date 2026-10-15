// Levers are the model's parameters. A lever value is a change in the "better" direction: 0.1 = 10% better.
// Weekly account probabilities (activation, retention, win-back) improve by cutting failures: +10% means
// 10% fewer accounts stay stuck, go quiet, or stay quiet that week. So a broken step (activation at 3%)
// gets a large lever, as it should. Engineer churn falls by 10%; every other lever grows by 10%.
export type LeverId = 'arrivals' | 'activation' | 'retention' | 'recovery' | 'p' | 'q' | 'c' | 'ceiling' | 'dMax' | 'lambda' | 'k';
export type Levers = Partial<Record<LeverId, number>>;

export type LeverMeta = {
  id: LeverId;
  label: string;
  group: 'accounts' | 'people' | 'depth' | 'intensity';
  /** Scale levers multiply output directly, so their effect is about 1 everywhere. */
  scale: boolean;
  description: string;
};

export const LEVERS: LeverMeta[] = [
  { id: 'arrivals', label: 'New accounts per week', group: 'accounts', scale: false, description: 'More accounts provisioned each week.' },
  { id: 'activation', label: 'Activation', group: 'accounts', scale: false, description: 'Fewer provisioned accounts staying stuck each week before their first use.' },
  { id: 'retention', label: 'Account retention', group: 'accounts', scale: false, description: 'Fewer active accounts going quiet each week (the weekly drop-off rate falls).' },
  { id: 'recovery', label: 'Win-back of quiet accounts', group: 'accounts', scale: false, description: 'Fewer quiet accounts staying quiet each week.' },
  { id: 'p', label: 'Adoption from outreach (p)', group: 'people', scale: false, description: 'Engineers who start because of training, marketing, or sales, independent of colleagues.' },
  { id: 'q', label: 'Adoption from colleagues (q)', group: 'people', scale: false, description: 'Engineers who start because colleagues use it; grows with the share already using it.' },
  { id: 'c', label: 'Engineer retention', group: 'people', scale: false, description: 'Fewer engaged engineers stopping each week.' },
  { id: 'ceiling', label: 'Reachable engineers', group: 'people', scale: false, description: 'More engineers who could use it in each account (new teams, new seats).' },
  { id: 'lambda', label: 'Learning speed', group: 'depth', scale: false, description: 'How fast a new engineer reaches full usage.' },
  { id: 'dMax', label: 'Usage at full experience', group: 'depth', scale: true, description: 'Workflows per week by an experienced engineer.' },
  { id: 'k', label: 'Tokens per workflow', group: 'intensity', scale: true, description: 'Compute per workflow: bigger jobs, batches and sweeps, heavier workloads.' },
];
export const LEVER_BY_ID = Object.fromEntries(LEVERS.map((l) => [l.id, l])) as Record<LeverId, LeverMeta>;

const up = (v: number, x = 0) => v * (1 + x);
const fewerFailures = (v: number, x = 0) => Math.max(0, Math.min(0.995, 1 - (1 - v) * (1 - x)));

/** The lever's effect on one parameter value. */
export const applyLever = {
  arrivals: up,
  activation: (v: number, x = 0) => fewerFailures(v, x),
  retention: (v: number, x = 0) => fewerFailures(v, x),
  recovery: (v: number, x = 0) => fewerFailures(v, x),
  p: up,
  q: up,
  c: (v: number, x = 0) => Math.max(0, v * (1 - x)),
  ceiling: up,
  lambda: up,
  dMax: up,
  k: (lnK: number, x = 0) => lnK + Math.log(1 + x),
};
