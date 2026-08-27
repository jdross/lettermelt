create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create type public.room_status as enum ('waiting', 'countdown', 'playing', 'won', 'lost');
create type public.find_kind as enum ('required', 'bonus');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('easy', 'hard')),
  seed bigint not null check (seed between 0 and 4294967295),
  format_version integer not null default 1,
  status public.room_status not null default 'waiting',
  opening_puzzle jsonb not null,
  state jsonb not null,
  state_version bigint not null default 0,
  saved_ms integer not null default 0 check (saved_ms >= 0),
  countdown_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  final_elapsed_ms integer,
  invite_hash text not null unique,
  short_code text not null unique check (short_code ~ '^[A-Z2-9]{6}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  slot smallint not null check (slot in (1, 2)),
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (room_id, slot),
  unique (room_id, user_id)
);

create table public.room_finds (
  room_id uuid not null references public.rooms(id) on delete cascade,
  sequence bigint not null,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  word text not null check (word ~ '^[a-z]{4,11}$'),
  kind public.find_kind not null,
  trace_ids jsonb not null,
  elapsed_ms integer not null check (elapsed_ms >= 0),
  credited_ms integer not null default 0 check (credited_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (room_id, sequence)
);

create table public.submission_receipts (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, request_id)
);

create table public.account_merges (
  token_hash text primary key,
  source_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create table public.game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_result_id uuid not null,
  room_id uuid references public.rooms(id) on delete set null,
  source text not null check (source in ('local', 'multiplayer')),
  seed bigint not null,
  mode text not null check (mode in ('easy', 'hard')),
  main_word text,
  daily_date date,
  status text not null check (status in ('won', 'lost')),
  elapsed_ms integer not null check (elapsed_ms >= 0),
  stars smallint not null check (stars between 0 and 5),
  found_words jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_result_id)
);

create unique index game_results_daily_unique
  on public.game_results(user_id, daily_date, mode)
  where daily_date is not null;
create index room_players_user_idx on public.room_players(user_id, joined_at desc);
create index game_results_user_idx on public.game_results(user_id, created_at desc);
create index rooms_expiry_idx on public.rooms(status, expires_at);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_finds enable row level security;
alter table public.submission_receipts enable row level security;
alter table public.game_results enable row level security;
alter table public.account_merges enable row level security;

create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_players p
    where p.room_id = target_room and p.user_id = auth.uid()
  );
$$;

create policy "profiles read own" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "players read shared room" on public.room_players for select to authenticated
  using (public.is_room_member(room_id));
create policy "rooms read member" on public.rooms for select to authenticated
  using (public.is_room_member(id));
create policy "finds read member" on public.room_finds for select to authenticated
  using (public.is_room_member(room_id));
create policy "results read own" on public.game_results for select to authenticated using (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data ->> 'display_name', 24), ''), 'Player'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger auth_user_profile after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.can_access_room_topic(topic_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_players p
    where p.user_id = auth.uid()
      and topic_name = 'room:' || p.room_id::text
  );
$$;

create policy "room realtime receive" on realtime.messages for select to authenticated
  using (public.can_access_room_topic(realtime.topic()));
create policy "room realtime send" on realtime.messages for insert to authenticated
  with check (public.can_access_room_topic(realtime.topic()) and extension in ('broadcast', 'presence'));

select cron.schedule(
  'lettermelt-room-cleanup',
  '17 * * * *',
  $$delete from public.rooms where status = 'waiting' and expires_at < now()$$
);
