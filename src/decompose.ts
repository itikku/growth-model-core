// Where growth came from. For a set of weeks S:
//   A = active account-weeks / |S|,  N = engaged / active account-weeks,  D = workflows / engaged,  K = tokens / workflows
// A · N · D · K = tokens per week, exactly, so log10 growth splits exactly into the four factors.
import type { PanelIndex } from './panel';

export type Factors = { accounts: number; people: number; depth: number; intensity: number; tokens: number };
export type Decomposition = { start: Factors; end: Factors; log10: Factors; weekly: ({ week: number } & Factors)[] };

function factorsFor(ix: PanelIndex, ids: Set<string>, weeks: readonly number[]): Factors {
  let active = 0, engaged = 0, workflows = 0, tokens = 0;
  const want = new Set(weeks);
  for (const s of ix.series) {
    if (!ids.has(s.account.id)) continue;
    s.weeks.forEach((w, i) => {
      if (!want.has(w) || !s.active[i]) return;
      active++;
      engaged += s.engaged[i];
      workflows += s.workflows[i];
      tokens += s.tokens[i];
    });
  }
  const n = weeks.length || 1;
  return {
    accounts: active / n,
    people: active ? engaged / active : 0,
    depth: engaged ? workflows / engaged : 0,
    intensity: workflows ? tokens / workflows : 0,
    tokens: tokens / n,
  };
}

export function decompose(ix: PanelIndex, accountIds: readonly string[], startWeeks: readonly number[], endWeeks: readonly number[]): Decomposition {
  const ids = new Set(accountIds);
  const start = factorsFor(ix, ids, startWeeks);
  const end = factorsFor(ix, ids, endWeeks);
  const lg = (k: keyof Factors) => (start[k] > 0 && end[k] > 0 ? Math.log10(end[k] / start[k]) : 0);
  const weekly = [];
  for (let w = Math.min(...startWeeks); w <= Math.max(...endWeeks); w++) weekly.push({ week: w, ...factorsFor(ix, ids, [w]) });
  return { start, end, log10: { accounts: lg('accounts'), people: lg('people'), depth: lg('depth'), intensity: lg('intensity'), tokens: lg('tokens') }, weekly };
}
