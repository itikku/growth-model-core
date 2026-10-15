// A scope is a set of accounts plus the share of future new accounts that would land in it.
import type { GrowthStage, StageResult } from './stage';
import type { SimAccount } from './types';

export type ScopeFilter = { theatre?: string; country?: string; chain?: string; accountIds?: string[]; stage?: GrowthStage };
export type ResolvedScope = { accountIds: string[]; arrivalShare: number };

/**
 * New accounts count toward a scope only when the scope could receive them: everything, a region
 * (in proportion to the region's share of accounts), or the nascent stage. Named accounts and chains get none.
 */
export function resolveScope(accounts: readonly SimAccount[], stages: ReadonlyMap<string, StageResult>, f: ScopeFilter): ResolvedScope {
  const ids = accounts.filter((a) =>
    (!f.theatre || a.theatre === f.theatre) &&
    (!f.country || a.country === f.country) &&
    (!f.chain || (a.chains ?? []).includes(f.chain)) &&
    (!f.accountIds?.length || f.accountIds.includes(a.id)) &&
    (!f.stage || stages.get(a.id)?.stage === f.stage),
  ).map((a) => a.id);
  let arrivalShare = 0;
  if (!f.chain && !f.accountIds?.length && (!f.stage || f.stage === 'nascent')) {
    const inRegion = accounts.filter((a) => (!f.theatre || a.theatre === f.theatre) && (!f.country || a.country === f.country)).length;
    arrivalShare = accounts.length ? inRegion / accounts.length : 0;
  }
  return { accountIds: ids, arrivalShare };
}
