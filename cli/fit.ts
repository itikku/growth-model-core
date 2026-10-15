// Fit the model to a folder with the three contract CSVs, and report what it found.
//   npx tsx cli/fit.ts samples/review-networks [--from 0] [--out report.json] [--backtest 12]
// --from: first week of the growth split (default: the first week with any workflows).
import { writeFileSync } from 'node:fs';
import {
  classifyStages, decompose, elasticities, fitIndexed, fitModel, forecast, indexPanel, LEVER_BY_ID, resolveScope, STAGES,
  type FitResult, type Panel,
} from '../src/index';
import { readPanel } from './panel-io';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!dir) {
  console.error('Usage: npx tsx cli/fit.ts <folder with accounts.csv, account_weeks.csv, engineer_weeks.csv> [--from week] [--out report.json] [--backtest 12]');
  process.exit(1);
}

const panel = readPanel(dir);
const ix = indexPanel(panel);
const fit = fitIndexed(ix);
const stages = classifyStages(ix, fit);
const all = panel.accounts.map((a) => a.id);
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const g = fit.global, d = fit.diagnostics;

const ranked = (ids: string[], arrivalShare: number) => elasticities(fit, ids, arrivalShare)
  .sort((a, b) => Number(LEVER_BY_ID[a.lever].scale) - Number(LEVER_BY_ID[b.lever].scale) || b.tokens - a.tokens)
  .map((r) => ({ lever: r.lever, label: LEVER_BY_ID[r.lever].label, scale: LEVER_BY_ID[r.lever].scale, tokensPer10pct: r.tokens * 0.1, workflowsPer10pct: r.workflows * 0.1 }));
const theatres = [...new Set(panel.accounts.map((a) => a.theatre).filter(Boolean))] as string[];
const byTheatre = Object.fromEntries(theatres.map((t) => {
  const scope = resolveScope(panel.accounts, stages, { theatre: t });
  return [t, ranked(scope.accountIds, scope.arrivalShare)];
}));
const start = opt('from') !== undefined ? Number(opt('from')) : Math.max(panel.firstWeek, Math.min(...panel.accountWeeks.filter((r) => r.workflows > 0).map((r) => r.week)));
const split = decompose(ix, all, [start, start + 1, start + 2], [panel.lastWeek - 2, panel.lastWeek - 1, panel.lastWeek]);

let backtest: { weeks: number; predictedWorkflows: number; observedWorkflows: number; error: number } | undefined;
const bt = Number(opt('backtest') ?? 0);
if (bt > 0) {
  const cut = panel.lastWeek - bt;
  const train: Panel = { ...panel, lastWeek: cut, accountWeeks: panel.accountWeeks.filter((r) => r.week <= cut), engineerWeeks: panel.engineerWeeks.filter((r) => r.week <= cut) };
  const f2: FitResult = fitModel(train);
  const ids = panel.accounts.filter((a) => a.provisionedWeek <= cut).map((a) => a.id);
  const predicted = forecast(f2, ids, 1, {}, bt).workflows;
  const observed = panel.accountWeeks.filter((r) => r.week > cut).reduce((a, r) => a + r.workflows, 0);
  backtest = { weeks: bt, predictedWorkflows: Math.round(predicted), observedWorkflows: observed, error: predicted / observed - 1 };
}

const stageCounts = Object.fromEntries(STAGES.map((s) => [s, [...stages.values()].filter((x) => x.stage === s).length]));
const report = {
  data: { accounts: panel.accounts.length, weeks: [panel.firstWeek, panel.lastWeek], engineerWeeks: panel.engineerWeeks.length },
  fit, stages: Object.fromEntries(stages), stageCounts, levers: { all: ranked(all, 1), byTheatre }, growthSplit: split.log10, backtest,
};
if (opt('out')) writeFileSync(opt('out')!, JSON.stringify(report, null, 2));

console.log(`\nData: ${panel.accounts.length} accounts, weeks ${panel.firstWeek}–${panel.lastWeek}, ${panel.engineerWeeks.length} engaged engineer-weeks.`);
console.log('\nAccount funnel (weekly):');
for (const [k, v] of Object.entries(d.funnel)) console.log(`  ${k.padEnd(10)} ${pct(v.value)}  (95%: ${pct(v.lo, 0)}–${pct(v.hi, 0)}, n=${v.n})`);
console.log(`  new accounts per week: ${g.arrivalsPerWeek.toFixed(2)}; pilot team: ${g.startTeam.toFixed(1)} engineers`);
console.log('\nAdoption inside accounts (Bass):');
console.log(`  outreach p ${pct(g.p, 2)}/wk ±${pct(2 * d.bass.pSE, 2)}; colleagues q ${pct(g.q)}/wk ±${pct(2 * d.bass.qSE)}; churn c ${pct(g.c)}/wk; reachable ${pct(g.ceiling, 0)} of seats`);
console.log(`  new users who started through a colleague: ${pct(d.bass.colleagueShare, 0)} (${pct(d.bass.colleagueShareInterval[0], 0)}–${pct(d.bass.colleagueShareInterval[1], 0)}, ${d.bass.colleagueShareSource})`);
console.log(`\nLearning curve: ${g.d0.toFixed(2)} → ${g.dMax.toFixed(2)} workflows per engineer-week, λ ${g.lambda.toFixed(3)}/wk`);
console.log(`Tokens per workflow: ${Math.round(Math.exp(g.kLevel)).toLocaleString('en-US')} (trend ${pct(g.kTrend)}/wk, damped)`);
console.log(`\nGrowth stages: ${STAGES.map((s) => `${s} ${stageCounts[s]}`).join(', ')}`);
console.log(`\nGrowth split, weeks ${start}–${start + 2} vs. ${panel.lastWeek - 2}–${panel.lastWeek} (log10): accounts ${split.log10.accounts.toFixed(2)} + engineers ${split.log10.people.toFixed(2)} + depth ${split.log10.depth.toFixed(2)} + tokens/workflow ${split.log10.intensity.toFixed(2)} = ${split.log10.tokens.toFixed(2)}`);
console.log('\nLevers for the whole business (26-week tokens if the lever is 10% better):');
for (const r of report.levers.all) console.log(`  ${r.label.padEnd(32)} ${r.scale ? '(scale) ' : '        '}${pct(r.tokensPer10pct)}`);
if (backtest) {
  console.log(`\nBacktest: fit on all but the last ${bt} weeks, forecast them: ${backtest.predictedWorkflows} vs. ${backtest.observedWorkflows} workflows observed (${pct(backtest.error)}).`);
  if (Math.abs(backtest.error) > 0.4) console.log('  Outside ±40%: the forecast assumes no new launches or definition changes. Check what changed in those weeks.');
}
if (d.warnings.length) console.log(`\nWarnings:\n  - ${d.warnings.join('\n  - ')}`);
if (opt('out')) console.log(`\nFull report: ${opt('out')}`);
