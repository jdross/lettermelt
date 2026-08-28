alter table public.profiles
  add column account_score integer not null default 0 check (account_score >= 0);

alter table public.game_results
  add column points integer not null default 0 check (points >= 0);

-- Preserve the score an account already earned before scores became a stored
-- profile value. Older multiplayer rows did not retain per-player finds, so
-- their existing whole-game value is the closest available migration value.
update public.game_results
set points = case when status = 'won'
  then stars * case when mode = 'hard' then 2 else 1 end
  else 0 end;

update public.profiles profile
set account_score = coalesce((
  select sum(result.points)::integer
  from public.game_results result
  where result.user_id = profile.user_id
), 0);
