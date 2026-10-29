# The model

Weekly panel: accounts × weeks, and engaged users × weeks. Notation: N = engaged users in an account, M = users it can reach, τ = a user's weeks of use so far.

## 1. Account funnel

Each week an account is in one of 14 states: not live yet; active; quiet for 1, 2, …, 11, or 12+ weeks. "Active" means at least one workflow that week. Transitions:

| From | To active, with probability |
|---|---|
| Not live yet | activation |
| Active | retention |
| Quiet 1–3 weeks | win-back (at risk) |
| Quiet 4–11 weeks | win-back (lapsed) |
| Quiet 12+ weeks | win-back (dormant) |

Otherwise the account moves one quiet week further. Rates are maximum-likelihood ratios (transitions ÷ exposures) over the last 12 weeks (activation: all weeks), with 95% Wilson intervals. Each account's rates are pulled toward the pool with 8 pseudo-observations. New accounts arrive at (accounts first usable in the last 26 weeks) ÷ 26 per week.

## 2. Adoption inside an account (Bass diffusion with churn)

Between two consecutive active weeks of an account:

```
expected new starts = θ · (p + q · N/M) · (M − N)        M = ceiling · seats
expected stops      = c · N
```

- **p** (outreach): a reachable user starts on their own, or through training, sales, or marketing.
- **q** (colleagues): a reachable user starts through a colleague; the pull grows with the share already using it.
- **c**: an engaged user stops.
- **θ**: the account's own adoption multiplier (observed ÷ expected starts, Poisson–gamma shrinkage with 5 pseudo-starts).

**With start labels** (`started_via` on most starts): outreach and colleague starts are separate Poisson counts, so `p = outreach starts ÷ Σ(M − N)` and `q = colleague starts ÷ Σ(N/M)(M − N)`. The colleague share is counted, with a Wilson interval.

**Without labels**: one Poisson count per pair, `E = p·a + q·b`, fit by EM (monotone; no optimizer library). p and q are then separated only by how N/M varies, so the fit reports their correlation and warns when it exceeds 0.9. Record how people start: it is the single most useful field to add.

**Ceiling**: profile likelihood over ceiling ∈ [max observed N/seats, 1] in steps of 0.05. If the best value is 1 (the top of the search), the ceiling is flagged as censored: the true value may be higher, so report it as "at least" the interval's lower end. Otherwise, if the likelihood-ratio interval is wider than 0.3, the data cannot pin it down; the ceiling is set to 1 and flagged, and ceiling effects become an upper bound.

**Pilot team**: the average number of users engaged in an account's first active week.

## 3. Learning curve (workflows per user)

```
E[workflows credited to a user in week t] = μ_account · m_t · g(τ)
g(τ) = Dmax − (Dmax − D0) · e^(−λτ)
```

τ counts the user's active weeks in their current spell. m_t absorbs everything that changed over calendar time (launches, seasons) and is normalized to 1 over the last 4 weeks; μ is an account multiplier (shrunk with 20 pseudo-workflows). Fit by block-coordinate Poisson maximum likelihood: (D0, Dmax) by EM on sufficient statistics by τ, λ on a log grid (0.01–3) plus golden-section search, then m_t and μ in closed form. Age and period are separately identified because users start at different times.

## 4. Tokens per workflow

ln K = account level + trend · week, with the trend pooled within accounts over the last 8 weeks (weighted by workflows) and levels shrunk toward the pool. The forecast damps the trend (φ = 0.8 per week), because step changes look like trends in a short window.

## Forecast

Deterministic expected values, 26 weeks, summed over the scope. For each account: the funnel state distribution moves one week at a time; engaged users are tracked **per funnel state** as a histogram over tenure (accounts that stay active also accumulate more users; averaging them separately understates growth by ~15%); Bass steps happen only in active weeks; the first active week brings the pilot team. New accounts arrive at the fitted rate when the scope can receive them (everything, a region in proportion to its share of accounts, or picked stages that include nascent). No new launches are assumed.

Accuracy: within ~4% of the mean of 120 stochastic runs on the same parameters; a 12-week backtest on a constant-parameter world lands within ±40% per seed (average +12%).

## Levers and elasticities

A lever is a parameter. "10% better" means: for weekly account probabilities, 10% fewer failures (stuck, going quiet, staying quiet); for user churn, 10% less; for everything else, 10% more. A negative value makes a weekly account probability worse by the gentler of "x% fewer successes" and "x% more failures", so a rate that mostly fails falls smoothly instead of hitting zero. Elasticity = (26-week tokens with the change ÷ baseline − 1) ÷ 10%.

Two kinds: **scale levers** (usage at full experience, tokens per workflow) multiply output and read about 1 everywhere; **growth levers** depend on where each account stands, and are the ones that tell you where to focus.

## Growth stages

From each account's last 8 weeks, checked in order:

1. **Nascent**: first active in the last 6 weeks, or provisioned under 8 weeks ago and not live yet.
2. **Stalled**: never active (older), quiet 4+ weeks, active under 4 of the last 8 weeks, or workflows growing under 2% a week.
3. **Compounding**: growing, and R = θ · q · (1 − N/M) / c ≥ 1 (each engaged user brings in more than one replacement before stopping).
4. **Linear**: growing, but R < 1: growth comes from outreach and learning, which level off.

## Growth split

For a set of weeks S: accounts = active account-weeks ÷ |S|; users = engaged ÷ active account-weeks; depth = workflows ÷ engaged; intensity = tokens ÷ workflows. The product is tokens per week, so log10 growth between two sets of weeks splits exactly into the four.

## Validation (in `npm test`)

- Estimators are exact on noiseless data (Poisson EM, learning curve, funnel ratios).
- Round trip: data drawn from known parameters by the reference simulator are fit back within tolerances of ≥ 3 standard deviations plus measured bias (over 20 seeds): p ±45%, q ±20%, c ±16%, Dmax ±11%, λ ±22% per seed; tighter on average. With start labels, p and q are pinned down tightly.
- The forecast matches Monte Carlo, conserves accounts, stays within reach, and never loses output from an improvement.
- Rankings depend on the scope (a not-live account: activation leads; a saturated account: reach beats outreach).

## Limits

- **Time-varying parameters.** Launches change rates; trailing windows trade bias for variance. Without start labels, a rising q inside the window pushes p toward zero.
- **Ceiling.** Only identified near saturation.
- **Team-level spread.** The model mixes at the account level; if adoption spreads team by team, q depends on account size. Check Bass residuals by account size; fit per team if you have team IDs.
- **Small samples.** Activation often rests on a few dozen accounts; read its rank as directional.
- **Intermittent use.** If people skip weeks without leaving, churn reads high. Define "engaged" over a short window (see DATA_CONTRACT.md).
- **Active ⇔ at least one workflow.** This floor biases D0 up slightly (~10% in tests).
