create table public.account_daily_streaks (
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('easy', 'hard')),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_daily_date date,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create index account_daily_streaks_user_idx on public.account_daily_streaks(user_id);

alter table public.account_daily_streaks enable row level security;

create policy "daily streaks read own" on public.account_daily_streaks
  for select to authenticated using (user_id = auth.uid());

-- Seed the account-scoped summary from existing daily results. A winning run
-- is a consecutive run of dates, while a loss on the latest date explicitly
-- breaks the live run. The game uses a fixed UTC-4 daily boundary.
with winning_dates as (
  select user_id, mode, daily_date,
    daily_date - (row_number() over (
      partition by user_id, mode order by daily_date
    ))::integer as run_key
  from public.game_results
  where daily_date is not null and status = 'won'
), winning_runs as (
  select user_id, mode, run_key, count(*)::integer as run_length,
    max(daily_date) as run_end
  from winning_dates
  group by user_id, mode, run_key
), latest_results as (
  select distinct on (user_id, mode)
    user_id, mode, daily_date, status
  from public.game_results
  where daily_date is not null
  order by user_id, mode, daily_date desc
), longest_runs as (
  select user_id, mode, max(run_length)::integer as longest_streak
  from winning_runs
  group by user_id, mode
)
insert into public.account_daily_streaks(
  user_id, mode, current_streak, longest_streak, last_daily_date
)
select latest.user_id,
  latest.mode,
  case when latest.status = 'won'
    and latest.daily_date >= (((now() at time zone 'UTC') - interval '4 hours')::date - 1)
    then coalesce(run.run_length, 0)
    else 0
  end,
  coalesce(longest.longest_streak, 0),
  latest.daily_date
from latest_results latest
left join winning_runs run
  on run.user_id = latest.user_id
  and run.mode = latest.mode
  and run.run_end = latest.daily_date
left join longest_runs longest
  on longest.user_id = latest.user_id and longest.mode = latest.mode
on conflict (user_id, mode) do update set
  current_streak = excluded.current_streak,
  longest_streak = excluded.longest_streak,
  last_daily_date = excluded.last_daily_date,
  updated_at = now();
