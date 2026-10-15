// World A — review networks (like code review): people check each other's work, and each review
// pulls in the next colleague. About half of new users start through a colleague; learning is quick.
// Numbers: fitted to the sample data in samples/review-networks (steady state, after its launches).
import type { WorldSpec } from '../src/index';
import { sampleAccounts } from './accounts';

const world: WorldSpec = {
  firstWeek: -12, lastWeek: 25, accounts: sampleAccounts(),
  funnel: { activation: 0.19, retention: 0.94, atRisk: 0.51, lapsed: 0.06, dormant: 0.03 },
  p: 0.029, q: 0.133, c: 0.073, ceiling: 1, startTeam: 3,
  dMax: 4.2, d0: 0.58, lambda: 0.33,
  kLevel: Math.log(88_600), kTrend: 0.006,
  labelStarts: true,
};
export default world;
