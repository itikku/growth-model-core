# Instructions for an AI coding agent

You are helping a team fit this growth model to their real product data and decide where to invest. Work in this order. Stop and ask the human where this file says **Ask**.

## 0. Set up

```bash
npm install && npm test                      # all tests must pass before you touch real data
npx tsx cli/fit.ts samples/review-networks   # see what a good report looks like
```

Read [MODEL.md](MODEL.md) and [DATA_CONTRACT.md](DATA_CONTRACT.md) end to end.

## 1. Map their data to the contract

1. Find the tables for accounts (contracts, seats, regions), product events, and units of usage or billing.
2. **Ask** which action counts as a *meaningful workflow* (value someone used, not a click). Propose one from the events you found, with counts.
3. **Ask** what `seats` should mean (licensed seats, or users in the target roles) and which date makes an account `provisioned`.
4. Find how people start: invites, shared links, review requests (= `colleague`); training, demos, campaigns, or direct sign-ups (= `outreach`). If nothing records it, say so: the model still runs, but the colleague-vs-outreach split will be inferred and less reliable. Suggest the event to add.
5. Write the SQL (see the sketch in DATA_CONTRACT.md) and export the three CSVs to a folder **outside this repo** (it may hold customer data).

Do not change a definition without asking. Write every definition you used into a short `MAPPING.md` next to the data.

## 2. Check the data

Run the checks at the end of DATA_CONTRACT.md and report the results. Also report: weeks of history, accounts, accounts that started inside the window, engaged user-weeks, and the share of starts with `started_via`. Fix mapping problems before fitting.

## 3. Fit and validate

```bash
npx tsx cli/fit.ts <data folder> --backtest 12 --out report.json
```

Before you interpret anything:

- Read every warning. Explain each one in plain words.
- Backtest: if the error is above ±40%, say the forecast is not reliable yet and why (often a launch or a definition change inside the window).
- Ranges: report each parameter with its range. Treat parameters whose range is wide (for example activation from a few accounts) as directional.
- If the colleague share is inferred (no labels) and p is near zero, do not claim "growth is all word of mouth"; say the data cannot separate p from q.

## 4. Report

Write a short report for a non-technical team:

1. **Where growth came from**: the four-part growth split, as multiples (for example "accounts ×1.4, users per account ×6, workflows per user ×12, tokens per workflow ×14").
2. **Where accounts stand**: counts per growth stage, and what share of recent usage each stage holds.
3. **What to do next**: the top 3 growth levers for the whole business, and for each region, with the size of each effect ("10% better adoption from colleagues adds X% tokens over 26 weeks"). Separate scale levers from growth levers.
4. **What would make this more reliable**: missing fields, short history, wide ranges.

Keep numbers to two significant figures. Do not present a lever ranking as a promise: it is the model's best estimate from where accounts stand today, with no new launches.

## 5. New theses (World C)

If neither sample world fits their story, copy `worlds/template.ts`, set the parameters to their hypothesis, and run:

```bash
npx tsx cli/simulate.ts worlds/my-world.ts out/my-world && npx tsx cli/fit.ts out/my-world
```

Compare the simulated report with their real one: the parameters that differ most are where their hypothesis is wrong.
