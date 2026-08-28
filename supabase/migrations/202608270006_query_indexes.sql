-- History pages sort by both timestamp and id. Keep the account lookup and
-- tie-breaker in the same index so pagination does not sort a user's full
-- result set on every request.
drop index if exists public.game_results_user_idx;
create index if not exists game_results_user_created_id_idx
  on public.game_results(user_id, created_at desc, id desc);

-- The streak primary key already starts with user_id, so this duplicate index
-- only adds write overhead.
drop index if exists public.account_daily_streaks_user_idx;
