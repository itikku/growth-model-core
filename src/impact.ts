// Which lever matters most for a scope: elasticity of 26-week output to a 10% improvement in each lever.
// Elasticity = (% change in output) / 10%. Because every account starts where the data leave it,
// the ranking depends on the scope: activation dominates where accounts are not live yet, and so on.
import { forecast, FORECAST_WEEKS } from './forecast';
import { LEVERS, type LeverId } from './levers';
import type { FitResult } from './types';

export const STEP = 0.1;
export type ElasticityRow = { lever: LeverId; tokens: number; workflows: number };

export function elasticities(fit: FitResult, accountIds: readonly string[], arrivalShare: number, weeks = FORECAST_WEEKS): ElasticityRow[] {
  const base = forecast(fit, accountIds, arrivalShare, {}, weeks);
  const rel = (x: number, b: number) => (b > 0 ? (x / b - 1) / STEP : 0);
  return LEVERS.map(({ id }) => {
    const f = forecast(fit, accountIds, arrivalShare, { [id]: STEP }, weeks);
    return { lever: id, tokens: rel(f.tokens, base.tokens), workflows: rel(f.workflows, base.workflows) };
  }).sort((a, b) => b.tokens - a.tokens);
}
