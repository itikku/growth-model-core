// The data contract as CSV files: accounts.csv, account_weeks.csv, engineer_weeks.csv (see DATA_CONTRACT.md).
import { join } from 'node:path';
import type { Panel } from '../src/index';
import { readCsv, writeCsv } from './csv';

const num = (s: string, what: string) => {
  const x = Number(s);
  if (!Number.isFinite(x)) throw new Error(`${what}: "${s}" is not a number`);
  return x;
};

export function readPanel(dir: string): Panel {
  const accounts = readCsv(join(dir, 'accounts.csv')).map((r) => ({
    id: r.id, name: r.name || undefined, seats: num(r.seats, `accounts.csv seats for ${r.id}`),
    provisionedWeek: num(r.provisioned_week, `accounts.csv provisioned_week for ${r.id}`),
    segment: r.segment || undefined, theatre: r.theatre || undefined, country: r.country || undefined,
    chains: r.chains ? r.chains.split(';').filter(Boolean) : undefined,
  }));
  const accountWeeks = readCsv(join(dir, 'account_weeks.csv')).map((r) => ({
    accountId: r.account_id, week: num(r.week, 'account_weeks.csv week'), workflows: num(r.workflows, 'account_weeks.csv workflows'), tokens: num(r.tokens || '0', 'account_weeks.csv tokens'),
  }));
  const engineerWeeks = readCsv(join(dir, 'engineer_weeks.csv')).map((r) => ({
    accountId: r.account_id, engineerId: r.engineer_id, week: num(r.week, 'engineer_weeks.csv week'), credited: num(r.credited || '0', 'engineer_weeks.csv credited'),
    ...(r.started_via === 'colleague' || r.started_via === 'outreach' ? { startedVia: r.started_via as 'colleague' | 'outreach' } : {}),
  }));
  const weeks = accountWeeks.map((r) => r.week);
  return {
    firstWeek: Math.min(...weeks, ...accounts.map((a) => a.provisionedWeek)),
    lastWeek: Math.max(...weeks),
    accounts, accountWeeks, engineerWeeks,
  };
}

export function writePanel(dir: string, panel: Panel): void {
  writeCsv(join(dir, 'accounts.csv'), ['id', 'name', 'seats', 'provisioned_week', 'segment', 'theatre', 'country', 'chains'],
    panel.accounts.map((a) => [a.id, a.name, a.seats, a.provisionedWeek, a.segment, a.theatre, a.country, a.chains?.join(';')]));
  writeCsv(join(dir, 'account_weeks.csv'), ['account_id', 'week', 'workflows', 'tokens'],
    panel.accountWeeks.map((r) => [r.accountId, r.week, r.workflows, Math.round(r.tokens)]));
  writeCsv(join(dir, 'engineer_weeks.csv'), ['account_id', 'engineer_id', 'week', 'credited', 'started_via'],
    panel.engineerWeeks.map((r) => [r.accountId, r.engineerId, r.week, r.credited, r.startedVia]));
}
