// World B — solo power users: individual experts run far more on their own, with reused setups and
// batches. Few new users start through a colleague; each person's use deepens slowly but a long way.
// Numbers: fitted to the sample data in samples/solo-power-users (steady state, after its launches).
import type { WorldSpec } from '../src/index';
import { sampleAccounts } from './accounts';

const world: WorldSpec = {
  firstWeek: -12, lastWeek: 25, accounts: sampleAccounts(),
  funnel: { activation: 0.22, retention: 0.88, atRisk: 0.56, lapsed: 0.2, dormant: 0.2 },
  p: 0.016, q: 0.006, c: 0.031, ceiling: 1, startTeam: 1,
  dMax: 15.3, d0: 0.46, lambda: 0.06,
  kLevel: Math.log(124_600), kTrend: 0.03,
  labelStarts: true,
};
export default world;
