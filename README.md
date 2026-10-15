# growth-model-core

A small, dependency-free growth model for usage-based B2B products. It fits your weekly product data and tells you **where growth comes from** and **which lever to pull next**, for the whole business, a region, a group of accounts, or a single account.

Every week:

```
tokens = active accounts × engaged engineers per account × workflows per engineer × tokens per workflow
```

Each part has standard, testable math behind it:

| Part | Model | What moves it |
|---|---|---|
| Active accounts | Weekly account funnel (Markov chain): not live yet → active → quiet 1–12+ weeks → back | Activation, retention, win-back, new accounts |
| Engaged engineers per account | Bass diffusion with churn: people start through **outreach (p)** or **colleagues (q)**, up to the engineers the account can reach | p, q, churn, reach |
| Workflows per engineer | Learning curve over each person's weeks of use | Learning speed, usage at full experience |
| Tokens per workflow | Level plus a damped trend | Bigger jobs, batches, heavier workloads |

Because the parts multiply, past growth splits **exactly** into the four, and the forecast tells you which lever matters most **from where each account stands today**: retention barely matters for accounts that never get started; activation is worth nothing for accounts that are already live.

"Engineer" here means any person who holds a seat: the sample data come from an engineering tool, but nothing in the math is specific to it.

## Quick start

```bash
npm install
npm test                                                   # the math, checked: estimators, round trips, forecasts
npx tsx cli/fit.ts samples/review-networks --from 0 --out report.json
```

`fit` prints the fitted parameters with ranges, each account's growth stage, the levers ranked by their effect on 26-week tokens (overall and per region), and the four-part growth split from `--from` to the last week. In the samples, week 0 is the first week of the observed period; weeks −12 to −1 are history.

**Backtest.** `--backtest 12` fits all but the last 12 weeks and forecasts them. The forecast assumes no new launches, so on the samples (which grow through eight dated launches) it misses badly, as it should. To see the model's accuracy when nothing changes, simulate a steady world and backtest that:

```bash
npx tsx cli/simulate.ts worlds/review-networks.ts out/steady
npx tsx cli/fit.ts out/steady --backtest 12
```

## Use it on your data

1. Build three tables (see [DATA_CONTRACT.md](DATA_CONTRACT.md)): `accounts.csv`, `account_weeks.csv`, `engineer_weeks.csv`.
2. Run `npx tsx cli/fit.ts <folder> --backtest 12 --out report.json`. If the backtest misses by more than ±40%, find what changed in those weeks first.
3. Read the diagnostics before the rankings (see [MODEL.md](MODEL.md#limits)).

Working with an AI coding agent? Point it at [AGENT.md](AGENT.md): it has the steps, the checks, and the questions to ask you.

## Two sample worlds, and your own

`samples/` holds simulated data for two competing theses about what drives growth:

- **review-networks**: people check each other's work, so about half of new users start through a colleague, and use spreads through teams.
- **solo-power-users**: individual experts go deep on their own; few start through a colleague, and growth comes from each person doing far more.

The same model, fit to each, reads the thesis from the data. `worlds/` has both as parameter files, plus a template for your own (World C): `npx tsx cli/simulate.ts worlds/template.ts out/world-c`.

## Layout

```
src/        the model (TypeScript, no dependencies): fit, forecast, levers, stages, growth split, reference simulator
cli/        fit.ts (CSV → report), simulate.ts (world file → CSV)
worlds/     parameter files for the sample worlds and a template
samples/    simulated data in the contract format
```

Sample data are simulated; any resemblance to real organizations is unintended. Built as an independent portfolio project.
