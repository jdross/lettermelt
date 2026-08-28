alter table public.profiles add column username text;

update public.profiles
set username = coalesce(
  nullif(trim(both '-' from left(regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g'), 23)), ''),
  'player'
  ) || '-' || substr(encode(digest(user_id::text, 'sha256'), 'hex'), 1, 6)
where username is null;

alter table public.profiles alter column username set default 'player-' || encode(gen_random_bytes(4), 'hex');
alter table public.profiles alter column username set not null;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9][a-z0-9-]{2,31}$');
create unique index profiles_username_idx on public.profiles(username);
