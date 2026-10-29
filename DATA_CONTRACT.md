# Data contract

Three CSV files (or tables) in one folder. Weeks are integers (for example ISO weeks since a start date); use the same week numbers in every file. The week an account or person is "active" is decided by these files, so build them carefully.

## accounts.csv — one row per customer account

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | Account ID. |
| `seats` | yes | Users the product could reach at this account (licensed seats, or headcount in the target roles). Sets the adoption ceiling. |
| `provisioned_week` | yes | First week the account could use the product (contract start, workspace created, or security approval). |
| `name` | no | For reports. |
| `segment` | no | For example Enterprise / Mid-market / Pilot. |
| `theatre`, `country` | no | Region filters (for example AMER / EMEA / APAC, ISO country code). |
| `chains` | no | Groups the account belongs to, `;`-separated (for example supply chains or parent companies). Groups may overlap. |

## account_weeks.csv — one row per account per week with any activity

| Column | Required | Meaning |
|---|---|---|
| `account_id`, `week` | yes | |
| `workflows` | yes | Meaningful workflows completed that week. The account is **active** that week when this is above 0. |
| `tokens` | yes | Usage units (what you bill on) consumed that week. Use the same week assignment as workflows (for example the week a job finished). |

**Meaningful workflow**: a unit of work that produced value someone used, not a click. In the sample data it is a finished job whose result a person viewed, a colleague reviewed, or a partner received. Define yours once and keep it fixed.

## engineer_weeks.csv — one row per engaged person per account per week

| Column | Required | Meaning |
|---|---|---|
| `account_id`, `engineer_id`, `week` | yes | Leave out weeks a person was not engaged. |
| `credited` | yes | Meaningful workflows credited to this person that week (0 is fine: they used the product but finished none). |
| `started_via` | strongly recommended | On the week a person starts (or restarts after stopping): `colleague` or `outreach`. Leave empty otherwise. |

**Engaged**: used the product at the account in an active week: configured, submitted, viewed or compared results, reviewed a colleague's work, saved or reused a setup, created a version, or handed work off. Logging in alone, automated jobs, and receiving a file from a partner do not count. If your users skip weeks without leaving, count a person as engaged for a short window after each use (for example 2 weeks), or churn will read high.

**Credited**: the person who submitted the work; for automated or batch work with no human submitter, the first person who looked at the result.

**started_via**: how a person came in.
- `colleague`: accepted a teammate's invite, opened a teammate's shared link or result, or was asked to review a teammate's work.
- `outreach`: anything else: training, a webinar, a sales demo, a marketing link (UTM), or on their own.

This one field lets the model count adoption from colleagues instead of inferring it, and it removes the main bias in the inferred split.

## SQL sketch

Adjust names to your warehouse. Assumes `events(user_id, account_id, event_type, occurred_at, run_id, actor_type, invited_by, signup_source)` and `runs(run_id, account_id, submitter_id, finished_at, status, tokens, used)`, where `used` marks runs someone viewed, reviewed, or handed off.

```sql
-- account_weeks
select r.account_id,
       floor(extract(epoch from r.finished_at - :start) / 604800) as week,
       count(*) filter (where r.status = 'success' and r.used)    as workflows,
       sum(r.tokens)                                              as tokens
from runs r
group by 1, 2;

-- engineer_weeks
with active_weeks as (
  select account_id, week from account_weeks where workflows > 0
), use as (
  select e.account_id, e.user_id as engineer_id,
         floor(extract(epoch from e.occurred_at - :start) / 604800) as week
  from events e
  where e.actor_type = 'human'
    and e.event_type in ('configure', 'submit', 'view_result', 'compare', 'annotate',
                         'request_review', 'complete_review', 'save_setup', 'reuse_setup',
                         'create_version', 'hand_off')
), credit as (
  select r.account_id, r.submitter_id as engineer_id,
         floor(extract(epoch from r.finished_at - :start) / 604800) as week,
         count(*) as credited
  from runs r where r.status = 'success' and r.used and r.submitter_id is not null
  group by 1, 2, 3
), starts as (
  select account_id, user_id as engineer_id,
         floor(extract(epoch from occurred_at - :start) / 604800) as week,
         case when signup_source in ('teammate_invite', 'shared_result') or invited_by is not null
              then 'colleague' else 'outreach' end as started_via
  from events where event_type = 'user_started'
)
select u.account_id, u.engineer_id, u.week,
       coalesce(c.credited, 0) as credited,
       s.started_via
from (select distinct * from use union select account_id, engineer_id, week from credit) u
join active_weeks a using (account_id, week)
left join credit c using (account_id, engineer_id, week)
left join starts s using (account_id, engineer_id, week);
```

## Checks before fitting

- Every `account_weeks` row with `workflows > 0` has at least one `engineer_weeks` row.
- `credited` sums to `workflows` per account-week (± batch work with no viewer).
- Engaged users per account-week ≤ `seats`.
- At least 20 weeks of history, and some accounts that started inside it (for activation and the pilot team).
