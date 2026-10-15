// World C — your own thesis. Copy this file, change the numbers, and run:
//   npx tsx cli/simulate.ts worlds/my-world.ts out/my-world && npx tsx cli/fit.ts out/my-world
// Each number is a weekly rate or a level the fit can recover (see MODEL.md). Ideas:
//   - Top-down rollouts: high activation and a big pilot team (startTeam), low q.
//   - Champion-led: low p, high q, but high churn c (use fades when the champion leaves).
//   - Heavy-compute: few people (low p and q), steep learning (high dMax, low lambda), rising tokens per workflow.
import type { WorldSpec } from '../src/index';
import { sampleAccounts } from './accounts';

const world: WorldSpec = {
  firstWeek: -12, lastWeek: 25, accounts: sampleAccounts(),
  funnel: { activation: 0.2, retention: 0.9, atRisk: 0.5, lapsed: 0.1, dormant: 0.05 }, // account funnel
  p: 0.01, q: 0.05, c: 0.05, ceiling: 0.8, startTeam: 2, // adoption inside each account
  dMax: 3, d0: 0.3, lambda: 0.15, // learning curve: workflows per engineer-week
  kLevel: Math.log(10_000), kTrend: 0.01, // tokens per workflow
  labelStarts: true, // record how each person started
};
export default world;
